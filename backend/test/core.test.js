const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { shortestCampusPath, projectAffectsRoute } = require("../routing");
const { loadSeeds, normalizeSeed } = require("../database/seed");
const { decodeRoutes } = require("../store");
const { transaction } = require("../db");
const validate = require("../validation");
const read = filename => JSON.parse(fs.readFileSync(path.join(__dirname, "../data", filename), "utf8"));

test("seeds retain geometry, junctions, timestamp links, and safely skip the empty object", () => {
  const warnings = [];
  const seeds = loadSeeds(undefined, { warn: text => warnings.push(text) });
  assert.equal(seeds.projects.length, 2);
  assert.equal(seeds.campus_locations.filter(item => item.type === "Junction").length, 6);
  assert.equal(seeds.routes.length, 40);
  assert.equal(seeds.announcements.find(item => item.sourceReportId).sourceReportId, 1789639726288);
  assert.ok(warnings.some(text => text.includes("empty projects.json")));
  assert.ok(JSON.parse(seeds.routes[5].affected_areas).length);
  assert.throws(() => normalizeSeed("projects", { id: 99 }), /missing name/);
  const report = normalizeSeed("reports", { id: 99, name: "Student", location: "Library", description: "Hazard", date: "2026-09-23", status: "Pending", category: "Construction", latitude: 0, longitude: 0, photoUrl: "/uploads/test.png" });
  assert.equal(report.latitude, 0);
  assert.equal(report.photoUrl, "/uploads/test.png");
  assert.equal(report.category, "Construction");
});

test("walking fixtures connect all public locations and vehicle accessibility remains distinct", () => {
  const routes = read("routes.json"), locations = read("campus-locations.json");
  const publicLocations = locations.filter(item => item.type !== "Junction");
  let walking = 0, vehicle = 0;
  for (const start of publicLocations) for (const end of publicLocations) if (start.id !== end.id) {
    if (shortestCampusPath(routes, locations, start.id, end.id, "walking")) walking++;
    if (shortestCampusPath(routes, locations, start.id, end.id, "vehicle")) vehicle++;
  }
  assert.equal(walking, 42);
  assert.equal(vehicle, 30);
});

test("routing retains blocked exclusions, restricted penalties, reverse geometry, and construction detours", () => {
  const locations = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const base = { pedestrian_accessible: true, vehicle_accessible: false, distance_meters: 10, status: "Open" };
  const routes = [
    { ...base, id: 1, start_location_id: 1, end_location_id: 2, estimated_minutes: 1, status: "Restricted", path_coordinates: [[0, 0], [0, 1]] },
    { ...base, id: 2, start_location_id: 1, end_location_id: 3, estimated_minutes: 1, path_coordinates: [[0, 0], [1, 1]] },
    { ...base, id: 3, start_location_id: 3, end_location_id: 2, estimated_minutes: 1, path_coordinates: [[1, 1], [0, 1]] },
    { ...base, id: 4, start_location_id: 1, end_location_id: 2, estimated_minutes: 0, status: "Blocked", path_coordinates: [[0, 0], [0, 1]] }
  ];
  assert.deepEqual(shortestCampusPath(routes, locations, 1, 2, "walking").routeIds, [2, 3]);
  assert.deepEqual(shortestCampusPath(routes, locations, 2, 1, "walking").pathCoordinates, [[0, 1], [1, 1], [0, 0]]);
  assert.deepEqual(shortestCampusPath(routes, locations, 1, 2, "walking", new Set([2])).routeIds, [1]);
  assert.equal(shortestCampusPath(routes, locations, 1, 2, "vehicle"), null);
  const segment = { path_coordinates: [[-23, 30], [-23, 30.01]], affected_areas: [] };
  assert.equal(projectAffectsRoute({ latitude: -23 + 34 / 111320, longitude: 30.005 }, segment), true);
  assert.equal(projectAffectsRoute({ latitude: -23 + 36 / 111320, longitude: 30.005 }, segment), false);
  assert.equal(projectAffectsRoute({ location: "Library entrance" }, { affected_areas: ["Library"] }), true);
});

test("SQL route values and frontend dates normalize without losing zeros", () => {
  const [route] = decodeRoutes([{ id: 1, pedestrian_accessible: "0", vehicle_accessible: 1, path_coordinates: "[[0,0],[1,1]]", affected_areas: "[]" }]);
  assert.equal(route.pedestrian_accessible, false);
  assert.equal(route.vehicle_accessible, true);
  assert.ok(Array.isArray(route.path_coordinates));
  assert.equal(validate.date("2028-02-29"), "2028-02-29");
  assert.throws(() => validate.date("2026-02-29"));
  assert.throws(() => validate.date("2026-09-23T00:00:00.000Z"));
  assert.deepEqual(validate.coordinates({ latitude: 0, longitude: 0 }), { latitude: 0, longitude: 0 });
});

test("failed multi-record operations roll back and release their connection", async () => {
  const events = [];
  const connection = Object.fromEntries(["beginTransaction", "commit", "rollback", "release"].map(name => [name, async () => events.push(name)]));
  await assert.rejects(transaction(async () => { events.push("write"); throw Error("injected failure"); }, { getConnection: async () => connection }), /injected failure/);
  assert.deepEqual(events, ["beginTransaction", "write", "rollback", "release"]);
});
