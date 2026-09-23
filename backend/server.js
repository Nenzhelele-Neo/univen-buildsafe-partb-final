const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const multer = require("multer");
const { pool, port } = require("./db");
const { createStore } = require("./store");
const validate = require("./validation");
const { verifySchema } = require("./database/setup");
const { shortestCampusPath, projectAffectsRoute } = require("./routing");

const REPORT_IMAGE_TYPES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const asyncRoute = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);

function uploadedFileMatchesType(file) {
  if (!file) return true;
  const buffer = Buffer.alloc(12);
  const descriptor = fs.openSync(file.path, "r");
  let bytesRead;
  try { bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0); }
  finally { fs.closeSync(descriptor); }
  if (bytesRead < 12) return false;
  if (file.mimetype === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (file.mimetype === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (file.mimetype === "image/webp") return buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  return false;
}

function createApp({ store = createStore(), uploadDir = path.join(__dirname, "uploads") } = {}) {
  const app = express();
  fs.mkdirSync(uploadDir, { recursive: true });
  app.use(express.json());
  app.use("/uploads", express.static(uploadDir));
  app.use(express.static(path.join(__dirname, "..", "frontend")));

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, callback) => callback(null, `report-${crypto.randomUUID()}${REPORT_IMAGE_TYPES[file.mimetype]}`)
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => {
      if (!REPORT_IMAGE_TYPES[file.mimetype]) return callback(new Error("Only JPEG, PNG, and WebP images are allowed."));
      callback(null, true);
    }
  }).single("photo");

  function uploadReportPhoto(req, res, next) {
    upload(req, res, error => {
      if (!error) return next();
      res.status(400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "Photo must be 5 MB or smaller." : error.message || "Photo upload failed." });
    });
  }

  function deletePhoto(photoUrl) {
    if (typeof photoUrl !== "string" || !photoUrl.startsWith("/uploads/")) return;
    try { fs.rmSync(path.join(uploadDir, path.basename(photoUrl)), { force: true }); }
    catch (error) { console.error("Could not delete report photo:", error.message); }
  }

  async function cleanupPhotos(urls) {
    // SQL commits first; a database rollback must never delete a live photo.
    for (const url of new Set(urls)) {
      try { if (!await store.photoInUse(url)) deletePhoto(url); }
      catch (error) { console.error("Could not check photo references:", error.message); }
    }
  }

  app.post("/api/login", asyncRoute(async (req, res) => {
    const email = validate.text(req.body?.email, 254);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password) validate.fail(400, "Email and password are required.");
    const user = await store.login(email, password);
    if (!user) validate.fail(401, "Invalid email or password.");
    res.json(user);
  }));

  app.get("/api/projects", asyncRoute(async (req, res) => res.json(await store.projects())));
  app.post("/api/projects", asyncRoute(async (req, res) => res.status(201).json(await store.createProject(validate.project(req.body || {})))));
  app.put("/api/projects/:id", asyncRoute(async (req, res) => {
    res.json(await store.updateProject(validate.id(req.params.id), validate.project(req.body || {})));
  }));
  app.delete("/api/projects/:id", asyncRoute(async (req, res) => {
    await cleanupPhotos(await store.deleteProject(validate.id(req.params.id)));
    res.json({ message: "Project deleted." });
  }));

  app.get("/api/announcements", asyncRoute(async (req, res) => res.json(await store.announcements())));
  app.post("/api/announcements", asyncRoute(async (req, res) => {
    const title = validate.text(req.body?.title, 255), message = validate.text(req.body?.message);
    if (!title || !message) validate.fail(400, "Announcement title and message are required.");
    res.status(201).json(await store.createAnnouncement({ title, message, date: new Date().toISOString().slice(0, 10) }));
  }));

  app.get("/api/campus-locations", asyncRoute(async (req, res) => res.json(await store.locations())));
  app.get("/api/routes", asyncRoute(async (req, res) => res.json(await store.routes())));
  app.get("/api/safe-route", asyncRoute(async (req, res) => {
    const startId = Number(req.query.start), destinationId = Number(req.query.destination);
    const mode = String(req.query.mode || "walking").toLowerCase();
    const { locations, routes, projects } = await store.routingData();
    const selectableLocationIds = new Set(locations.filter(location => location.type !== "Junction").map(location => location.id));
    if (!selectableLocationIds.has(startId) || !selectableLocationIds.has(destinationId)) {
      return res.status(400).json({ found: false, message: "Please select valid campus locations." });
    }
    if (startId === destinationId) return res.status(400).json({ found: false, message: "From and Destination must be different locations." });
    if (!["walking", "vehicle"].includes(mode)) return res.status(400).json({ found: false, message: "Travel mode must be walking or vehicle." });

    const affectedRouteIds = new Set(), affectingProjects = [];
    projects.filter(project => project.status === "In Progress").forEach(project => {
      const affectedRoutes = routes.filter(route => projectAffectsRoute(project, route));
      if (affectedRoutes.length) affectingProjects.push(project);
      affectedRoutes.forEach(route => affectedRouteIds.add(route.id));
    });
    const normalRoute = shortestCampusPath(routes, locations, startId, destinationId, mode);
    const safeRoute = shortestCampusPath(routes, locations, startId, destinationId, mode, affectedRouteIds);
    if (!normalRoute) return res.json({ found: false, message: `No ${mode} route is available between those locations.` });
    if (!safeRoute) return res.json({
      found: false, constructionAffected: normalRoute.routeIds.some(id => affectedRouteIds.has(id)),
      message: "No safe alternate route is currently available."
    });
    const constructionAffected = normalRoute.routeIds.some(id => affectedRouteIds.has(id));
    const adjusted = constructionAffected && normalRoute.routeIds.join(",") !== safeRoute.routeIds.join(",");
    const affectingProject = affectingProjects.find(project => routes.some(route => normalRoute.routeIds.includes(route.id) && projectAffectsRoute(project, route)));
    const area = affectingProject && (affectingProject.location || affectingProject.affectedArea || affectingProject.name);
    res.json({
      found: true, mode, adjusted, constructionAffected,
      message: adjusted ? `Route adjusted to avoid active construction near ${area}.` : "Your selected route is currently clear.",
      ...safeRoute
    });
  }));

  app.post("/api/reports", uploadReportPhoto, asyncRoute(async (req, res) => {
    const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;
    let committed = false;
    try {
      if (!uploadedFileMatchesType(req.file)) validate.fail(400, "The uploaded file is not a valid JPEG, PNG, or WebP image.");
      const body = req.body || {};
      const name = validate.text(body.name, 150), location = validate.text(body.location, 255);
      const description = validate.text(body.description), category = validate.text(body.category, 64);
      if (name.length < 2 || !/^[a-zA-ZÀ-ÿ\s'-]+$/.test(name)) validate.fail(400, "Please enter a valid name.");
      if (location.length < 3 || !/^[a-zA-Z0-9À-ÿ\s.,'()#-]+$/.test(location)) validate.fail(400, "Please enter a valid location.");
      if (!validate.REPORT_CATEGORIES.includes(category)) validate.fail(400, "Please select a valid report category.");
      if (description.length < 20 || !/[a-zA-Z]/.test(description)) validate.fail(400, "Please provide a more detailed description.");
      const report = await store.createReport({
        name, category, location, description, ...validate.coordinates(body), photoUrl,
        date: new Date().toISOString().slice(0, 10), status: "Pending"
      });
      committed = true;
      res.status(201).json(report);
    } catch (error) {
      if (!committed) deletePhoto(photoUrl);
      throw error;
    }
  }));
  app.get("/api/reports", asyncRoute(async (req, res) => res.json(await store.reports())));
  app.put("/api/reports/:id/status", asyncRoute(async (req, res) => {
    const body = req.body || {};
    const publication = body.status === "Completed" && !Object.hasOwn(body, "publishedTitle")
      ? { completeOnly: true } : validate.publication(body);
    res.json(await store.reviewReport(validate.id(req.params.id), publication));
  }));
  app.delete("/api/reports/:id", asyncRoute(async (req, res) => {
    await cleanupPhotos(await store.deleteReport(validate.id(req.params.id)));
    res.json({ message: "Report deleted." });
  }));

  app.use("/api", (req, res) => res.status(404).json({ message: "API endpoint not found." }));
  app.get("*", (req, res) => res.sendFile(path.join(__dirname, "..", "frontend", "index.html")));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status === 500) console.error("Request failed:", error.code || error.message);
    res.status(status).json({ message: status === 500 ? "The request could not be completed. Please try again." : error.message });
  });
  return app;
}

async function start() {
  await pool.execute("SELECT 1");
  await verifySchema(pool);
  const app = createApp();
  const server = app.listen(port, () => console.log(`UNIVEN BuildSafe running at http://localhost:${port}`));
  server.on("error", async error => {
    console.error("Could not start HTTP server:", error.code || error.message);
    await pool.end();
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
    server.close(() => pool.end().catch(console.error));
  });
}

if (require.main === module) start().catch(async error => {
  console.error("Startup failed. Check backend/.env and run npm run db:setup:", error.code || error.message);
  await pool.end();
  process.exitCode = 1;
});

module.exports = { createApp, uploadedFileMatchesType };
