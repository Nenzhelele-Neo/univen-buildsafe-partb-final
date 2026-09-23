const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const mysql = require("mysql2/promise");
const { config, pool: defaultPool } = require("../db");
const { applySchema, verifySchema } = require("../database/setup");
const { seed } = require("../database/seed");
const { createStore } = require("../store");
const { createApp } = require("../server");
const validate = require("../validation");

test("MySQL schema, seeds, HTTP contracts, uploads, moderation, and routing", { timeout: 60000 }, async t => {
  // A freshly generated database is the only database this suite may drop.
  const databaseName = `buildsafe_test_${crypto.randomBytes(8).toString("hex")}`;
  const uploads = fs.mkdtempSync(path.join(os.tmpdir(), "buildsafe-uploads-"));
  let administrator, database, server, created = false;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (database) await database.end();
    if (administrator) {
      if (created && /^buildsafe_test_[a-f0-9]{16}$/.test(databaseName)) await administrator.query(`DROP DATABASE \`${databaseName}\``);
      await administrator.end();
    }
    await defaultPool.end();
    for (const file of fs.readdirSync(uploads)) fs.unlinkSync(path.join(uploads, file));
    fs.rmdirSync(uploads);
  });
  administrator = await mysql.createConnection({ ...config, database: undefined });
  await administrator.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  created = true;
  await administrator.changeUser({ database: databaseName });
  await applySchema(administrator);
  await applySchema(administrator);
  await verifySchema(administrator, databaseName);
  database = mysql.createPool({ ...config, database: databaseName, connectionLimit: 5 });
  const warnings = [], log = { log() {}, warn(message) { warnings.push(message); } };
  const first = await seed({ database, log });
  const store = createStore(database);
  server = createApp({ store, uploadDir: uploads }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(method, url, body, expected = 200) {
    const form = body instanceof FormData;
    const response = await fetch(base + url, {
      method, headers: body && !form ? { "Content-Type": "application/json" } : undefined,
      body: body ? form ? body : JSON.stringify(body) : undefined
    });
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(result)}`);
    return result;
  }
  const reportBody = { name: "Test Student", category: "Construction", location: "Library Area", description: "Construction blocks the library entrance walkway.", latitude: -22.97640546, longitude: 30.44304409 };
  const review = { status: "Approved", publishedTitle: "Library walkway repairs", publishedCategory: "Construction", publishedLocation: "Library Area", publishedDescription: "Construction blocks the library entrance walkway.", publishedAffectedArea: "Library entrance and nearby walkway", publishedStartDate: "2026-09-23", publishedEndDate: "2026-10-30" };
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ioAAAAASUVORK5CYII=", "base64");
  function reportForm(photo = png, type = "image/png") {
    const form = new FormData();
    for (const [key, value] of Object.entries(reportBody)) form.append(key, value);
    form.append("photo", new Blob([photo], { type }), "report.png");
    return form;
  }

  await t.test("schema/seed repeatability, BIGINT IDs, complete fields, and preservation of edits", async () => {
    assert.equal(first.projects.inserted, 2);
    assert.equal(first.routes.inserted, 40);
    const projects = await store.projects();
    const project = projects.find(item => item.id === 1);
    await store.updateProject(1, validate.project({ ...project, name: "A member's edited project" }));
    const second = await seed({ database, log });
    assert.ok(Object.values(second).every(count => count.inserted === 0));
    assert.equal((await store.projects()).find(item => item.id === 1).name, "A member's edited project");
    await store.updateProject(1, validate.project(project));
    assert.ok(warnings.some(message => message.includes("without a publication")));
    assert.equal((await store.announcements()).find(item => item.sourceReportId).sourceReportId, 1789639726288);
    assert.equal((await store.locations()).length, 7);
    assert.equal((await store.routes())[5].affected_areas[0], "Library Area");
  });

  await t.test("a failed seed rolls back earlier inserts and the legacy entry point exits nonzero", async () => {
    const seedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "buildsafe-seed-"));
    try {
      const original = path.join(__dirname, "../data");
      for (const file of fs.readdirSync(original)) fs.copyFileSync(path.join(original, file), path.join(seedDirectory, file));
      const usersPath = path.join(seedDirectory, "users.json"), projectsPath = path.join(seedDirectory, "projects.json");
      const users = JSON.parse(fs.readFileSync(usersPath));
      users.push({ id: 99123, name: "Rollback Test", email: "rollback@example.test", password: "demo", role: "student" });
      fs.writeFileSync(usersPath, JSON.stringify(users));
      const projects = JSON.parse(fs.readFileSync(projectsPath));
      projects.push({ id: 99123, name: "Orphan", location: "Library", description: "Invalid report reference", status: "Planned", sourceReportId: 9912399123 });
      fs.writeFileSync(projectsPath, JSON.stringify(projects));
      await assert.rejects(seed({ database, directory: seedDirectory, log }), /foreign key/i);
      const [inserted] = await database.execute("SELECT id FROM users WHERE id = 99123");
      assert.equal(inserted.length, 0);
    } finally {
      for (const file of fs.readdirSync(seedDirectory)) fs.unlinkSync(path.join(seedDirectory, file));
      fs.rmdirSync(seedDirectory);
    }
    const failed = spawnSync(process.execPath, [path.join(__dirname, "../migrate.js")], {
      env: { ...process.env, DB_HOST: config.host, DB_PORT: String(config.port), DB_USER: config.user, DB_PASSWORD: config.password, DB_NAME: databaseName + "_missing" },
      encoding: "utf8", timeout: 15000, windowsHide: true
    });
    assert.equal(failed.status, 1, failed.stderr);
    assert.match(failed.stderr, /Migration failed/);
  });

  await t.test("both logins and every read contract", async () => {
    for (const [name, role] of [["admin", "admin"], ["student", "student"]]) {
      const user = await request("POST", "/api/login", { email: `${name}@univen.ac.za`, password: `${name}123` });
      assert.equal(user.role, role);
      assert.equal(user.password, undefined);
    }
    await request("POST", "/api/login", { email: "admin@univen.ac.za", password: "ADMIN123" }, 401);
    await request("POST", "/api/login", {}, 400);
    for (const endpoint of ["projects", "announcements", "reports", "campus-locations", "routes"]) assert.ok(Array.isArray(await request("GET", `/api/${endpoint}`)));
    const project = (await request("GET", "/api/projects")).find(item => item.id === 1);
    assert.equal(project.startDate, "2026-08-10");
    assert.equal(typeof project.latitude, "number");
    await request("GET", "/api/missing", undefined, 404);
  });

  await t.test("direct project CRUD, generated IDs, dates, and direct notice creation", async () => {
    const body = { name: "New project", description: "A directly created project", location: "Library", status: "Planned", latitude: -22.9764, longitude: 30.4422, startDate: "2026-09-23", endDate: "2026-10-01" };
    const project = await request("POST", "/api/projects", body, 201);
    assert.ok(Number.isSafeInteger(project.id));
    const edited = await request("PUT", `/api/projects/${project.id}`, { ...body, status: "Completed" });
    assert.equal(edited.startDate, body.startDate);
    assert.equal(edited.status, "Completed");
    await request("DELETE", `/api/projects/${project.id}`);
    await request("DELETE", `/api/projects/${project.id}`, undefined, 404);
    await request("POST", "/api/projects", { ...body, startDate: "2026-02-30" }, 400);
    const notice = await request("POST", "/api/announcements", { title: "Direct notice", message: "Use the alternative campus walkway." }, 201);
    assert.ok(notice.id > 1790001700061);
    assert.match(notice.date, /^\d{4}-\d{2}-\d{2}$/);
  });

  await t.test("walking/vehicle modes, route geometry, junction and query validation", async () => {
    const walking = await request("GET", "/api/safe-route?start=7&destination=1&mode=walking");
    assert.equal(walking.found, true);
    assert.equal(walking.adjusted, true);
    assert.ok(walking.pathCoordinates.length > 1);
    const vehicle = await request("GET", "/api/safe-route?start=4&destination=2&mode=vehicle");
    assert.equal(vehicle.mode, "vehicle");
    assert.equal(vehicle.found, true);
    for (const query of ["start=8&destination=1", "start=1&destination=1", "start=1&destination=2&mode=flying"]) await request("GET", `/api/safe-route?${query}`, undefined, 400);
  });

  await t.test("invalid uploads leave no files and optional coordinates are validated", async () => {
    const before = fs.readdirSync(uploads).length;
    await request("POST", "/api/reports", reportForm(Buffer.from("this is not an image")), 400);
    await request("POST", "/api/reports", reportForm(png, "text/plain"), 400);
    await request("POST", "/api/reports", reportForm(Buffer.alloc(5 * 1024 * 1024 + 1)), 400);
    await request("POST", "/api/reports", { ...reportBody, longitude: null }, 400);
    assert.equal(fs.readdirSync(uploads).length, before);
  });

  await t.test("full report lifecycle publishes to SQL, detours, synchronizes edits, and removes photos", async () => {
    const oldProject = (await store.projects()).find(item => item.id === 1);
    await request("PUT", "/api/projects/1", { ...oldProject, status: "Completed" });
    assert.equal((await request("GET", "/api/safe-route?start=7&destination=1")).adjusted, false);
    const report = await request("POST", "/api/reports", reportForm(), 201);
    assert.equal(report.status, "Pending");
    assert.equal(report.latitude, reportBody.latitude);
    const photoPath = path.join(uploads, path.basename(report.photoUrl));
    assert.ok(fs.existsSync(photoPath));
    assert.equal((await fetch(base + report.photoUrl)).status, 200);
    await request("PUT", `/api/reports/${report.id}/status`, { status: "Completed" }, 409);
    const approved = await request("PUT", `/api/reports/${report.id}/status`, review);
    await Promise.all([request("PUT", `/api/reports/${report.id}/status`, review), request("PUT", `/api/reports/${report.id}/status`, review)]);
    let linked = (await store.projects()).filter(item => item.sourceReportId === report.id);
    assert.equal(linked.length, 1);
    assert.equal(linked[0].id, approved.publishedItemId);
    assert.equal(linked[0].photoUrl, report.photoUrl);
    assert.equal(linked[0].startDate, review.publishedStartDate);
    assert.equal((await request("GET", "/api/safe-route?start=7&destination=1")).adjusted, true);
    await request("PUT", `/api/projects/${linked[0].id}`, { ...linked[0], name: "Edited linked project", status: "Completed" });
    let storedReport = (await store.reports()).find(item => item.id === report.id);
    assert.equal(storedReport.publishedTitle, "Edited linked project");
    assert.equal(storedReport.status, "Completed");
    await request("PUT", `/api/projects/${linked[0].id}`, { ...linked[0], status: "In Progress" });
    assert.equal((await store.reports()).find(item => item.id === report.id).status, "Approved");
    await request("PUT", `/api/reports/${report.id}/status`, { status: "Completed" });
    assert.equal((await store.projects()).find(item => item.sourceReportId === report.id).status, "Completed");
    assert.equal((await request("GET", "/api/safe-route?start=7&destination=1")).adjusted, false);
    const noticeReview = { ...review, publishedCategory: "Water Supply / Damage", publishedTitle: "Water repair notice" };
    const publishedNotice = await request("PUT", `/api/reports/${report.id}/status`, noticeReview);
    assert.equal((await store.projects()).some(item => item.sourceReportId === report.id), false);
    let notice = (await store.announcements()).find(item => item.sourceReportId === report.id);
    assert.equal(notice.id, publishedNotice.publishedNoticeId);
    assert.equal(notice.category, noticeReview.publishedCategory);
    assert.equal(notice.location, review.publishedLocation);
    assert.equal(notice.photoUrl, report.photoUrl);
    await request("PUT", `/api/reports/${report.id}/status`, { ...noticeReview, publishedTitle: "Updated notice" });
    assert.equal((await store.announcements()).find(item => item.sourceReportId === report.id).title, "Updated notice");
    await request("PUT", `/api/reports/${report.id}/status`, { ...noticeReview, status: "Rejected" });
    assert.equal((await store.announcements()).some(item => item.sourceReportId === report.id), false);
    assert.ok(fs.existsSync(photoPath));
    await request("PUT", `/api/reports/${report.id}/status`, noticeReview);
    await request("DELETE", `/api/reports/${report.id}`);
    assert.equal((await store.reports()).some(item => item.id === report.id), false);
    assert.equal((await store.announcements()).some(item => item.sourceReportId === report.id), false);
    assert.equal(fs.existsSync(photoPath), false);
  });

  await t.test("deleting a linked project also deletes its report and photo", async () => {
    const report = await request("POST", "/api/reports", reportForm(), 201);
    const published = await request("PUT", `/api/reports/${report.id}/status`, review);
    await request("DELETE", `/api/projects/${published.publishedItemId}`);
    assert.equal((await store.reports()).some(item => item.id === report.id), false);
    assert.equal(fs.existsSync(path.join(uploads, path.basename(report.photoUrl))), false);
  });

  await t.test("publication failure rolls back the inserted project and report status together", async () => {
    const report = await request("POST", "/api/reports", reportBody, 201);
    const failingStore = createStore({ async getConnection() {
      const connection = await database.getConnection();
      return {
        beginTransaction: () => connection.beginTransaction(), commit: () => connection.commit(),
        rollback: () => connection.rollback(), release: () => connection.release(),
        execute(sql, values) {
          if (sql.startsWith("UPDATE `reports`")) throw Error("Injected publication failure");
          return connection.execute(sql, values);
        }
      };
    } });
    await assert.rejects(failingStore.reviewReport(report.id, validate.publication(review)), /Injected/);
    assert.equal((await store.projects()).some(item => item.sourceReportId === report.id), false);
    assert.equal((await store.reports()).find(item => item.id === report.id).status, "Pending");
    await request("DELETE", `/api/reports/${report.id}`);
  });

  await t.test("failed report insertion cleans an uploaded file and returns JSON", async () => {
    const badServer = createApp({ store: { createReport: async () => { throw Error("Injected database failure"); } }, uploadDir: uploads }).listen(0, "127.0.0.1");
    await new Promise(resolve => badServer.once("listening", resolve));
    try {
      const before = fs.readdirSync(uploads).length;
      const response = await fetch(`http://127.0.0.1:${badServer.address().port}/api/reports`, { method: "POST", body: reportForm() });
      assert.equal(response.status, 500);
      assert.ok((await response.json()).message);
      assert.equal(fs.readdirSync(uploads).length, before);
    } finally { await new Promise(resolve => badServer.close(resolve)); }
  });
});
