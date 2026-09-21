const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const REPORT_CATEGORIES = ["Construction", "Electrical", "Water Supply / Damage", "Road / Walkway", "Safety Hazard", "Other"];
const PROJECT_STATUSES = ["Planned", "In Progress", "Completed", "Delayed"];

app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "..", "frontend")));

const REPORT_IMAGE_TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
};
const reportPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, callback) => callback(null, `report-${crypto.randomUUID()}${REPORT_IMAGE_TYPES[file.mimetype]}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!REPORT_IMAGE_TYPES[file.mimetype]) return callback(new Error("Only JPEG, PNG, and WebP images are allowed."));
    callback(null, true);
  }
}).single("photo");

function uploadReportPhoto(req, res, next) {
  reportPhotoUpload(req, res, error => {
    if (!error) return next();
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Photo must be 5 MB or smaller."
      : error.message || "Photo upload failed.";
    res.status(400).json({ message });
  });
}

function deleteReportPhoto(report) {
  if (!report || typeof report.photoUrl !== "string" || !report.photoUrl.startsWith("/uploads/")) return;
  const filename = path.basename(report.photoUrl);
  const filePath = path.join(UPLOAD_DIR, filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    console.error("Could not delete report photo:", error.message);
  }
}

function uploadedFileMatchesType(file) {
  if (!file) return true;
  const buffer = Buffer.alloc(12);
  const descriptor = fs.openSync(file.path, "r");
  const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
  fs.closeSync(descriptor);
  if (bytesRead < 12) return false;

  if (file.mimetype === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (file.mimetype === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (file.mimetype === "image/webp") return buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  return false;
}

function readData(file) {
  const filePath = path.join(DATA_DIR, file);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeData(file, data) {
  const filePath = path.join(DATA_DIR, file);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  const users = readData("users.json");
  const user = users.find(u => u.email === email && u.password === password);

  if (!user) return res.status(401).json({ message: "Invalid email or password." });

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  });
});

app.get("/api/projects", (req, res) => {
  res.json(readData("projects.json"));
});

app.post("/api/projects", (req, res) => {
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();
  const location = String(req.body.location || "").trim();
  const status = String(req.body.status || "").trim();
  const latitude = req.body.latitude === "" || req.body.latitude == null ? null : Number(req.body.latitude);
  const longitude = req.body.longitude === "" || req.body.longitude == null ? null : Number(req.body.longitude);

  if (!name || !description || !location || !PROJECT_STATUSES.includes(status)) {
    return res.status(400).json({ message: "Project name, description, location, and status are required." });
  }

  if ((latitude !== null && !Number.isFinite(latitude)) || (longitude !== null && !Number.isFinite(longitude))) {
    return res.status(400).json({ message: "Project coordinates must be valid numbers." });
  }

  const projects = readData("projects.json");
  const project = {
    id: Date.now(),
    name,
    description,
    location,
    status,
    startDate: req.body.startDate || null,
    endDate: req.body.endDate || null,
    affectedArea: String(req.body.affectedArea || "").trim(),
    latitude,
    longitude
  };

  projects.unshift(project);
  writeData("projects.json", projects);
  res.status(201).json(project);
});

app.put("/api/projects/:id", (req, res) => {
  const projects = readData("projects.json");
  const index = projects.findIndex(p => p.id == req.params.id);

  if (index === -1) return res.status(404).json({ message: "Project not found." });

  const project = projects[index];
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();
  const location = String(req.body.location || "").trim();
  const status = String(req.body.status || "").trim();
  const latitude = req.body.latitude === "" || req.body.latitude == null ? null : Number(req.body.latitude);
  const longitude = req.body.longitude === "" || req.body.longitude == null ? null : Number(req.body.longitude);

  if (!name || !description || !location || !PROJECT_STATUSES.includes(status)) {
    return res.status(400).json({ message: "Project name, description, location, and status are required." });
  }

  if ((latitude !== null && !Number.isFinite(latitude)) || (longitude !== null && !Number.isFinite(longitude))) {
    return res.status(400).json({ message: "Project coordinates must be valid numbers." });
  }

  Object.assign(project, {
    name,
    description,
    location,
    status,
    startDate: req.body.startDate || null,
    endDate: req.body.endDate || null,
    affectedArea: String(req.body.affectedArea || "").trim(),
    latitude,
    longitude
  });

  if (project.sourceReportId) {
    const reports = readData("reports.json");
    const report = reports.find(item => item.id == project.sourceReportId);

    if (!report) {
      return res.status(409).json({ message: "The linked source report could not be found." });
    }

    report.publishedTitle = project.name;
    report.publishedCategory = "Construction";
    report.publishedLocation = project.location;
    report.publishedDescription = project.description;
    report.publishedAffectedArea = project.affectedArea;
    report.publishedStartDate = project.startDate || "";
    report.publishedEndDate = project.endDate || "";
    report.publishedType = "project";
    report.publishedItemId = project.id;
    delete report.publishedNoticeId;

    if (project.status === "Completed") report.status = "Completed";
    else if (report.status === "Completed") report.status = "Approved";

    writeData("reports.json", reports);
  }

  writeData("projects.json", projects);
  res.json(project);
});

app.delete("/api/projects/:id", (req, res) => {
  let projects = readData("projects.json");
  const project = projects.find(p => p.id == req.params.id);

  if (project && project.sourceReportId) {
    let reports = readData("reports.json");
    let announcements = readData("announcements.json");
    const linkedReport = reports.find(item => item.id == project.sourceReportId);
    deleteReportPhoto(linkedReport);

    projects = projects.filter(item => item.id != project.id);
    reports = reports.filter(item => item.id != project.sourceReportId);
    announcements = announcements.filter(item => item.sourceReportId != project.sourceReportId);

    writeData("projects.json", projects);
    writeData("reports.json", reports);
    writeData("announcements.json", announcements);
    return res.json({ message: "Project and linked report deleted." });
  }

  const originalLength = projects.length;
  projects = projects.filter(p => p.id != req.params.id);

  if (projects.length === originalLength)
    return res.status(404).json({ message: "Project not found." });

  writeData("projects.json", projects);
  res.json({ message: "Project deleted." });
});

app.get("/api/announcements", (req, res) => {
  res.json(readData("announcements.json"));
});

app.get("/api/campus-locations", (req, res) => {
  const locations = readData("campus-locations.json");
  res.json(locations.filter(location => location.type !== "Junction"));
});

app.get("/api/routes", (req, res) => {
  res.json(readData("routes.json"));
});

function normalizeRouteText(value) {
  return String(value || "").trim().toLowerCase();
}

function pointToSegmentDistanceMeters(point, start, end) {
  const averageLatitude = (point[0] + start[0] + end[0]) / 3;
  const longitudeScale = 111320 * Math.cos(averageLatitude * Math.PI / 180);
  const toPoint = coordinate => ({
    x: (coordinate[1] - point[1]) * longitudeScale,
    y: (coordinate[0] - point[0]) * 111320
  });
  const a = toPoint(start);
  const b = toPoint(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSquared));
  return Math.hypot(a.x + ratio * dx, a.y + ratio * dy);
}

function projectAffectsRoute(project, route) {
  const projectText = [project.location, project.affectedArea].map(normalizeRouteText).filter(Boolean);
  const affectedAreas = (route.affected_areas || []).map(normalizeRouteText);
  if (affectedAreas.some(area => projectText.some(text => text.includes(area) || area.includes(text)))) return true;

  const latitude = Number(project.latitude);
  const longitude = Number(project.longitude);
  const coordinates = route.path_coordinates;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Array.isArray(coordinates)) return false;

  for (let index = 1; index < coordinates.length; index += 1) {
    if (pointToSegmentDistanceMeters([latitude, longitude], coordinates[index - 1], coordinates[index]) <= 35) return true;
  }
  return false;
}

function shortestCampusPath(allRoutes, allLocations, startId, destinationId, mode, excludedRouteIds = new Set()) {
  const locationMap = Object.fromEntries(allLocations.map(location => [location.id, location]));
  const adjacency = {};

  allRoutes.forEach(route => {
    if (route.status === "Blocked" || excludedRouteIds.has(route.id)) return;
    if (mode === "walking" && !route.pedestrian_accessible) return;
    if (mode === "vehicle" && !route.vehicle_accessible) return;

    const weight = Number(route.estimated_minutes) + (route.status === "Restricted" ? 2 : 0);
    const forwardCoordinates = route.path_coordinates || [];
    const reverseCoordinates = forwardCoordinates.slice().reverse();
    if (!adjacency[route.start_location_id]) adjacency[route.start_location_id] = [];
    if (!adjacency[route.end_location_id]) adjacency[route.end_location_id] = [];
    adjacency[route.start_location_id].push({ route, to: route.end_location_id, weight, coordinates: forwardCoordinates });
    adjacency[route.end_location_id].push({ route, to: route.start_location_id, weight, coordinates: reverseCoordinates });
  });

  const distances = Object.fromEntries(allLocations.map(location => [location.id, Infinity]));
  const previous = {};
  const queue = [{ id: startId, distance: 0 }];
  const visited = new Set();
  distances[startId] = 0;

  while (queue.length) {
    queue.sort((left, right) => left.distance - right.distance);
    const current = queue.shift();
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    if (current.id === destinationId) break;

    for (const edge of adjacency[current.id] || []) {
      const distance = distances[current.id] + edge.weight;
      if (distance < distances[edge.to]) {
        distances[edge.to] = distance;
        previous[edge.to] = { from: current.id, edge };
        queue.push({ id: edge.to, distance });
      }
    }
  }

  if (distances[destinationId] === Infinity) return null;

  const segments = [];
  let currentId = destinationId;
  while (currentId !== startId) {
    const step = previous[currentId];
    if (!step) return null;
    segments.unshift(step.edge);
    currentId = step.from;
  }

  const pathCoordinates = [];
  segments.forEach(segment => {
    segment.coordinates.forEach(coordinate => {
      const previousCoordinate = pathCoordinates[pathCoordinates.length - 1];
      if (!previousCoordinate || previousCoordinate[0] !== coordinate[0] || previousCoordinate[1] !== coordinate[1]) {
        pathCoordinates.push(coordinate);
      }
    });
  });

  return {
    routeIds: segments.map(segment => segment.route.id),
    segments: segments.map(segment => ({
      id: segment.route.id,
      name: segment.route.route_name,
      status: segment.route.status,
      type: segment.route.route_type
    })),
    pathCoordinates,
    totalDistanceMeters: segments.reduce((total, segment) => total + Number(segment.route.distance_meters), 0),
    totalEstimatedMinutes: segments.reduce((total, segment) => total + Number(segment.route.estimated_minutes), 0),
    start: locationMap[startId],
    destination: locationMap[destinationId]
  };
}

app.get("/api/safe-route", (req, res) => {
  const startId = Number(req.query.start);
  const destinationId = Number(req.query.destination);
  const mode = String(req.query.mode || "walking").toLowerCase();
  const locations = readData("campus-locations.json");
  const routes = readData("routes.json");
  const projects = readData("projects.json");
  const selectableLocationIds = new Set(locations.filter(location => location.type !== "Junction").map(location => location.id));

  if (!selectableLocationIds.has(startId) || !selectableLocationIds.has(destinationId)) {
    return res.status(400).json({ found: false, message: "Please select valid campus locations." });
  }
  if (startId === destinationId) {
    return res.status(400).json({ found: false, message: "From and Destination must be different locations." });
  }
  if (!['walking', 'vehicle'].includes(mode)) {
    return res.status(400).json({ found: false, message: "Travel mode must be walking or vehicle." });
  }

  const activeProjects = projects.filter(project => project.status === "In Progress");
  const affectedRouteIds = new Set();
  const affectingProjects = [];
  activeProjects.forEach(project => {
    const affectedRoutes = routes.filter(route => projectAffectsRoute(project, route));
    if (affectedRoutes.length) affectingProjects.push(project);
    affectedRoutes.forEach(route => affectedRouteIds.add(route.id));
  });

  const normalRoute = shortestCampusPath(routes, locations, startId, destinationId, mode);
  const safeRoute = shortestCampusPath(routes, locations, startId, destinationId, mode, affectedRouteIds);
  if (!normalRoute) {
    return res.json({ found: false, message: `No ${mode} route is available between those locations.` });
  }
  if (!safeRoute) {
    return res.json({
      found: false,
      constructionAffected: normalRoute.routeIds.some(routeId => affectedRouteIds.has(routeId)),
      message: "No safe alternate route is currently available."
    });
  }

  const constructionAffected = normalRoute.routeIds.some(routeId => affectedRouteIds.has(routeId));
  const adjusted = constructionAffected && normalRoute.routeIds.join(',') !== safeRoute.routeIds.join(',');
  const affectingProject = affectingProjects.find(project =>
    routes.some(route => normalRoute.routeIds.includes(route.id) && projectAffectsRoute(project, route))
  );
  const area = affectingProject && (affectingProject.location || affectingProject.affectedArea || affectingProject.name);

  res.json({
    found: true,
    mode,
    adjusted,
    constructionAffected,
    message: adjusted
      ? `Route adjusted to avoid active construction near ${area}.`
      : "Your selected route is currently clear.",
    ...safeRoute
  });
});

app.post("/api/announcements", (req, res) => {
  const announcements = readData("announcements.json");
  const announcement = {
    id: Date.now(),
    title: req.body.title,
    message: req.body.message,
    date: new Date().toISOString().slice(0, 10)
  };

  announcements.unshift(announcement);
  writeData("announcements.json", announcements);
  res.status(201).json(announcement);
});

app.post("/api/reports", uploadReportPhoto, (req, res) => {
  const name = String(req.body.name || "").trim();
  const category = String(req.body.category || "").trim();
  const location = String(req.body.location || "").trim();
  const description = String(req.body.description || "").trim();
  const latitude = req.body.latitude === "" || req.body.latitude == null ? null : Number(req.body.latitude);
  const longitude = req.body.longitude === "" || req.body.longitude == null ? null : Number(req.body.longitude);

  function rejectReport(message) {
    if (req.file) deleteReportPhoto({ photoUrl: `/uploads/${req.file.filename}` });
    return res.status(400).json({ message });
  }

  if (!uploadedFileMatchesType(req.file)) {
    return rejectReport("The uploaded file is not a valid JPEG, PNG, or WebP image.");
  }

  if (name.length < 2 || !/^[a-zA-ZÀ-ÿ\s'-]+$/.test(name)) {
    return rejectReport("Please enter a valid name.");
  }

  if (location.length < 3 || !/^[a-zA-Z0-9À-ÿ\s.,'()#-]+$/.test(location)) {
    return rejectReport("Please enter a valid location.");
  }

  if (!REPORT_CATEGORIES.includes(category)) {
    return rejectReport("Please select a valid report category.");
  }

  if (description.length < 20 || !/[a-zA-Z]/.test(description)) {
    return rejectReport("Please provide a more detailed description.");
  }

  if ((latitude === null) !== (longitude === null) ||
      (latitude !== null && (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180))) {
    return rejectReport("The selected map location is invalid. Please choose it again.");
  }

  const reports = readData("reports.json");
  const report = {
    id: Date.now(),
    category,
    name,
    location,
    description,
    date: new Date().toISOString().slice(0, 10),
    status: "Pending",
    latitude,
    longitude,
    photoUrl: req.file ? `/uploads/${req.file.filename}` : null
  };

  reports.unshift(report);
  writeData("reports.json", reports);
  res.status(201).json(report);
});

app.get("/api/reports", (req, res) => {
  res.json(readData("reports.json"));
});
app.put("/api/reports/:id/status", (req, res) => {
  const reports = readData("reports.json");
  const index = reports.findIndex(r => r.id == req.params.id);

  if (index === -1) {
    return res.status(404).json({ message: "Report not found." });
  }

  const allowedStatuses = ["Approved", "Rejected", "Completed"];

  if (!allowedStatuses.includes(req.body.status)) {
    return res.status(400).json({ message: "Invalid report status." });
  }

  const report = reports[index];
  const hasPublishedFields = Object.prototype.hasOwnProperty.call(req.body, "publishedTitle");

  if (req.body.status === "Completed" && !hasPublishedFields) {
    if (report.status !== "Approved") {
      return res.status(409).json({ message: "Only an approved report can be marked complete." });
    }

    const projects = readData("projects.json");
    const linkedProject = projects.find(item => item.sourceReportId == report.id);
    if (linkedProject) linkedProject.status = "Completed";

    report.status = "Completed";
    writeData("projects.json", projects);
    writeData("reports.json", reports);
    return res.json(report);
  }

  const publishedFields = {
    publishedTitle: String(req.body.publishedTitle || "").trim(),
    publishedCategory: String(req.body.publishedCategory || "").trim(),
    publishedLocation: String(req.body.publishedLocation || "").trim(),
    publishedDescription: String(req.body.publishedDescription || "").trim(),
    publishedAffectedArea: String(req.body.publishedAffectedArea || "").trim(),
    publishedStartDate: String(req.body.publishedStartDate || "").trim(),
    publishedEndDate: String(req.body.publishedEndDate || "").trim()
  };

  Object.assign(report, publishedFields);

  if (req.body.status === "Rejected") {
    let projects = readData("projects.json");
    let announcements = readData("announcements.json");
    projects = projects.filter(item => item.sourceReportId != report.id);
    announcements = announcements.filter(item => item.sourceReportId != report.id);

    report.status = "Rejected";
    delete report.publishedType;
    delete report.publishedItemId;
    delete report.publishedNoticeId;

    writeData("projects.json", projects);
    writeData("announcements.json", announcements);
    writeData("reports.json", reports);
    return res.json(report);
  }

  if (report.publishedTitle.length < 3 || !REPORT_CATEGORIES.includes(report.publishedCategory) || report.publishedLocation.length < 3 || report.publishedDescription.length < 10) {
    return res.status(400).json({ message: "Complete the publishable title, category, location, and message." });
  }

  if (report.publishedStartDate && report.publishedEndDate && report.publishedEndDate < report.publishedStartDate) {
    return res.status(400).json({ message: "Expected end date cannot be before the start date." });
  }

  let projects = readData("projects.json");
  let announcements = readData("announcements.json");
  const targetType = report.publishedCategory === "Construction" ? "project" : "announcement";
  let publishedItem;

  if (targetType === "project") {
    announcements = announcements.filter(item => item.sourceReportId != report.id);

    const matches = projects.filter(item => item.sourceReportId == report.id);
    const existingProject = matches[0];
    projects = projects.filter(item => item.sourceReportId != report.id || item.id == existingProject?.id);

    if (existingProject) {
      Object.assign(existingProject, {
        name: report.publishedTitle,
        description: report.publishedDescription,
        location: report.publishedLocation,
        status: req.body.status === "Completed" ? "Completed" : "In Progress",
        startDate: report.publishedStartDate || null,
        endDate: report.publishedEndDate || null,
        affectedArea: report.publishedAffectedArea || "",
        latitude: report.latitude ?? existingProject.latitude ?? null,
        longitude: report.longitude ?? existingProject.longitude ?? null,
        photoUrl: report.photoUrl || existingProject.photoUrl || null
      });
      publishedItem = existingProject;
    } else {
      publishedItem = {
        id: Date.now(),
        name: report.publishedTitle,
        description: report.publishedDescription,
        location: report.publishedLocation,
        status: req.body.status === "Completed" ? "Completed" : "In Progress",
        startDate: report.publishedStartDate || null,
        endDate: report.publishedEndDate || null,
        affectedArea: report.publishedAffectedArea || "",
        latitude: report.latitude ?? null,
        longitude: report.longitude ?? null,
        photoUrl: report.photoUrl || null,
        sourceReportId: report.id
      };
      projects.unshift(publishedItem);
    }
  } else {
    projects = projects.filter(item => item.sourceReportId != report.id);

    const matches = announcements.filter(item => item.sourceReportId == report.id);
    const existingAnnouncement = matches[0];
    announcements = announcements.filter(item => item.sourceReportId != report.id || item.id == existingAnnouncement?.id);

    if (existingAnnouncement) {
      Object.assign(existingAnnouncement, {
        title: report.publishedTitle,
        category: report.publishedCategory,
        location: report.publishedLocation,
        message: report.publishedDescription,
        photoUrl: report.photoUrl || existingAnnouncement.photoUrl || null
      });
      publishedItem = existingAnnouncement;
    } else {
      publishedItem = {
        id: Date.now(),
        title: report.publishedTitle,
        category: report.publishedCategory,
        location: report.publishedLocation,
        message: report.publishedDescription,
        date: new Date().toISOString().slice(0, 10),
        photoUrl: report.photoUrl || null,
        sourceReportId: report.id
      };
      announcements.unshift(publishedItem);
    }
  }

  report.status = req.body.status;
  report.publishedType = targetType;
  report.publishedItemId = publishedItem.id;
  if (targetType === "announcement") report.publishedNoticeId = publishedItem.id;
  else delete report.publishedNoticeId;

  writeData("projects.json", projects);
  writeData("announcements.json", announcements);
  writeData("reports.json", reports);

  res.json(report);
});

app.delete("/api/reports/:id", (req, res) => {
  let reports = readData("reports.json");
  const report = reports.find(item => item.id == req.params.id);

  if (!report) {
    return res.status(404).json({ message: "Report not found." });
  }

  deleteReportPhoto(report);

  let projects = readData("projects.json");
  let announcements = readData("announcements.json");

  projects = projects.filter(item => item.sourceReportId != report.id);
  announcements = announcements.filter(item => item.sourceReportId != report.id);
  reports = reports.filter(item => item.id != report.id);

  writeData("projects.json", projects);
  writeData("announcements.json", announcements);
  writeData("reports.json", reports);

  res.json({ message: "Report deleted." });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

app.listen(PORT, () => {
  console.log(`UNIVEN Construction System running at http://localhost:${PORT}`);
});
