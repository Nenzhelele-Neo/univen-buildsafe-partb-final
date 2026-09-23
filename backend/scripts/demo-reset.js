const fs = require("node:fs");
const path = require("node:path");
const { pool, transaction, config } = require("../db");
const { insert } = require("../store");
const { verifySchema } = require("../database/setup");

const ids = {
  pendingReport: 9100001000001,
  approvedWorkReport: 9100001000002,
  approvedNoticeReport: 9100001000003,
  rejectedReport: 9100001000004,
  libraryConstruction: 9100002000001,
  roadMaintenance: 9100002000002,
  electricalNotice: 9100003000001,
  waterNotice: 9100003000002,
  reportNotice: 9100003000003
};

const images = {
  construction: "/assets/demo/construction.svg",
  maintenance: "/assets/demo/road-maintenance.svg",
  electrical: "/assets/demo/electrical.svg",
  water: "/assets/demo/water.svg",
  walkway: "/assets/demo/damaged-walkway.svg"
};

const reports = [
  {
    id: ids.pendingReport,
    category: "Road / Walkway",
    name: "Lerato Mulaudzi",
    location: "Near Auditorium",
    description: "A section of the pedestrian walkway is damaged and may be unsafe during busy periods.",
    date: "2026-09-23",
    status: "Pending",
    latitude: -22.9760,
    longitude: 30.4443,
    photoUrl: images.walkway
  },
  {
    id: ids.approvedWorkReport,
    category: "Construction",
    name: "Tshilidzi Netshifhefhe",
    location: "Near UNIVEN Main Library",
    description: "Construction materials are blocking part of the walkway near a campus building.",
    date: "2026-09-21",
    status: "Approved",
    latitude: -22.97640546,
    longitude: 30.44304409,
    photoUrl: images.construction,
    publishedTitle: "Library Area Construction",
    publishedCategory: null,
    publishedWorkType: "Construction",
    publishedStatus: "In Progress",
    publishedLocation: "UNIVEN Main Library",
    publishedDescription: "Renovation work is taking place near the library. Students should use the marked alternative walkway while construction is active.",
    publishedAffectedArea: "Library pedestrian walkway",
    publishedStartDate: "2026-09-15",
    publishedEndDate: "2026-11-14",
    publishedLatitude: -22.97640546,
    publishedLongitude: 30.44304409,
    publishedShowOnMap: null,
    publishedType: "project",
    publishedItemId: ids.libraryConstruction,
    publishedNoticeId: null
  },
  {
    id: ids.approvedNoticeReport,
    category: "Electrical",
    name: "Rendani Ramabulana",
    location: "Near Science Faculty Building",
    description: "Exposed or damaged electrical infrastructure has been reported near a campus facility.",
    date: "2026-09-20",
    status: "Approved",
    latitude: -22.9775,
    longitude: 30.4385,
    photoUrl: images.electrical,
    publishedTitle: "Electrical Safety Notice",
    publishedCategory: "Electrical",
    publishedWorkType: null,
    publishedStatus: null,
    publishedLocation: "Science Faculty Building",
    publishedDescription: "Electrical infrastructure near the Science Faculty is under inspection. Follow the posted access instructions.",
    publishedAffectedArea: "",
    publishedStartDate: null,
    publishedEndDate: null,
    publishedLatitude: -22.9775,
    publishedLongitude: 30.4385,
    publishedShowOnMap: true,
    publishedType: "announcement",
    publishedItemId: ids.reportNotice,
    publishedNoticeId: ids.reportNotice
  },
  {
    id: ids.rejectedReport,
    category: "Other",
    name: "Mpho Mudau",
    location: "Main Gate Access Pathway",
    description: "A temporary delivery vehicle was reported near the gate but had already moved when the area was reviewed.",
    date: "2026-09-19",
    status: "Rejected",
    latitude: -22.9818,
    longitude: 30.4425,
    photoUrl: images.walkway
  }
];

const projects = [
  {
    id: ids.libraryConstruction,
    name: "Library Area Construction",
    description: "Renovation work is taking place near the library. Students should use the marked alternative walkway while construction is active.",
    location: "UNIVEN Main Library",
    status: "In Progress",
    workType: "Construction",
    startDate: "2026-09-15",
    endDate: "2026-11-14",
    affectedArea: "Library pedestrian walkway",
    latitude: -22.97640546,
    longitude: 30.44304409,
    sourceReportId: ids.approvedWorkReport,
    photoUrl: images.construction
  },
  {
    id: ids.roadMaintenance,
    name: "Main Campus Road Maintenance",
    description: "Scheduled maintenance is being carried out on the campus road surface.",
    location: "Main Gate Access Pathway",
    status: "Planned",
    workType: "Maintenance",
    startDate: "2026-10-01",
    endDate: "2026-10-12",
    affectedArea: "Main campus road",
    latitude: -22.9818,
    longitude: 30.4425,
    sourceReportId: null,
    photoUrl: images.maintenance
  }
];

const announcements = [
  {
    id: ids.electricalNotice,
    title: "Temporary Electrical Maintenance",
    category: "Electrical",
    location: "Faculty of Health Sciences",
    message: "Electrical maintenance is scheduled in this area. Students and staff should use caution and follow posted access instructions.",
    date: "2026-09-23",
    latitude: -22.9753,
    longitude: 30.4465,
    showOnMap: true,
    photoUrl: images.electrical,
    sourceReportId: null
  },
  {
    id: ids.waterNotice,
    title: "Campus Water Supply Update",
    category: "Water Supply / Damage",
    location: "Selected campus buildings",
    message: "Water supply may be temporarily interrupted in selected campus buildings during scheduled maintenance.",
    date: "2026-09-23",
    latitude: null,
    longitude: null,
    showOnMap: false,
    photoUrl: images.water,
    sourceReportId: null
  },
  {
    id: ids.reportNotice,
    title: "Electrical Safety Notice",
    category: "Electrical",
    location: "Science Faculty Building",
    message: "Electrical infrastructure near the Science Faculty is under inspection. Follow the posted access instructions.",
    date: "2026-09-20",
    latitude: -22.9775,
    longitude: 30.4385,
    showOnMap: true,
    photoUrl: images.electrical,
    sourceReportId: ids.approvedNoticeReport
  }
];

async function cleanupOrphanUploads(database = pool) {
  const [references] = await database.execute(
    `SELECT photo_url FROM reports WHERE photo_url LIKE '/uploads/%'
     UNION SELECT photo_url FROM projects WHERE photo_url LIKE '/uploads/%'
     UNION SELECT photo_url FROM announcements WHERE photo_url LIKE '/uploads/%'`
  );
  const inUse = new Set(references.map(item => path.basename(item.photo_url)));
  const uploadDirectory = path.join(__dirname, "..", "uploads");
  if (!fs.existsSync(uploadDirectory)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(uploadDirectory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name !== ".gitkeep" && !inUse.has(entry.name)) {
      fs.rmSync(path.join(uploadDirectory, entry.name));
      removed += 1;
    }
  }
  return removed;
}

async function resetDemo({ database = pool, log = console } = {}) {
  await verifySchema(database, config.database);
  const [[before]] = await database.execute(
    "SELECT (SELECT COUNT(*) FROM campus_locations) AS locations, (SELECT COUNT(*) FROM routes) AS routes"
  );
  const [demoUsers] = await database.execute(
    "SELECT email, role FROM users WHERE (email = ? AND role = 'admin') OR (email = ? AND role = 'student')",
    ["admin@univen.ac.za", "student@univen.ac.za"]
  );
  if (demoUsers.length !== 2) throw new Error("Demo users are missing. Run npm run db:seed before demo:reset.");

  await transaction(async connection => {
    await connection.execute("DELETE FROM projects");
    await connection.execute("DELETE FROM announcements");
    await connection.execute("DELETE FROM reports");
    for (const report of reports) await insert(connection, "reports", report);
    for (const project of projects) await insert(connection, "projects", project);
    for (const announcement of announcements) await insert(connection, "announcements", announcement);
  }, database);

  const [[after]] = await database.execute(
    "SELECT (SELECT COUNT(*) FROM campus_locations) AS locations, (SELECT COUNT(*) FROM routes) AS routes"
  );
  if (before.locations !== after.locations || before.routes !== after.routes) {
    throw new Error("Demo reset changed campus locations or routes.");
  }
  const removedUploads = await cleanupOrphanUploads(database);
  const result = { projects: projects.length, announcements: announcements.length, reports: reports.length, removedUploads };
  log.log("Demo data ready:", result);
  return result;
}

if (require.main === module) resetDemo().catch(error => {
  console.error("Demo reset failed:", error.message);
  process.exitCode = 1;
}).finally(() => pool.end());

module.exports = { resetDemo, cleanupOrphanUploads, ids };
