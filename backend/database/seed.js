const fs = require("node:fs");
const path = require("node:path");
const { pool, transaction } = require("../db");
const { fields, insert } = require("../store");
const validate = require("../validation");
const { verifySchema } = require("./setup");

const seedFiles = {
  users: "users.json", campus_locations: "campus-locations.json", reports: "reports.json",
  projects: "projects.json", announcements: "announcements.json", routes: "routes.json"
};
const required = {
  users: ["name", "email", "password", "role"], campus_locations: ["name"],
  reports: ["name", "location", "description", "date", "status"],
  projects: ["name", "description", "location", "status"],
  announcements: ["title", "message", "date"], routes: ["route_name", "route_type", "status"]
};

function normalizeSeed(table, input) {
  const record = Object.fromEntries(Object.keys(fields[table]).map(key => [key, input[key] ?? null]));
  record.id = validate.id(input.id);
  for (const key of required[table]) {
    if (typeof record[key] !== "string" || !record[key].trim()) throw new Error(`${table} ${record.id}: missing ${key}.`);
  }
  for (const key of ["date", "startDate", "endDate", "publishedStartDate", "publishedEndDate"]) {
    if (key in record) record[key] = validate.date(record[key]);
  }
  for (const key of ["sourceReportId", "publishedItemId", "publishedNoticeId", "start_location_id", "end_location_id"]) {
    if (record[key] != null) record[key] = validate.id(record[key]);
  }
  if ("latitude" in record) Object.assign(record, validate.coordinates(record));
  if (table === "campus_locations" && record.latitude == null) throw new Error(`Location ${record.id} needs coordinates.`);
  if (table === "projects") record.affectedArea ??= "";
  if (table === "routes") {
    for (const key of ["start_location_id", "end_location_id"]) record[key] = validate.id(record[key]);
    for (const key of ["distance_meters", "estimated_minutes"]) {
      if (record[key] == null || !Number.isFinite(Number(record[key])) || Number(record[key]) < 0) throw new Error(`Route ${record.id}: invalid ${key}.`);
      record[key] = Number(record[key]);
    }
    for (const key of ["pedestrian_accessible", "vehicle_accessible"]) {
      if (![true, false, 0, 1].includes(record[key])) throw new Error(`Route ${record.id}: invalid ${key}.`);
      record[key] = Number(record[key]);
    }
    const geometry = input.path_coordinates;
    if (!Array.isArray(geometry) || geometry.length < 2 || geometry.some(point => !Array.isArray(point) || point.length !== 2 ||
        !point.every(Number.isFinite) || Math.abs(point[0]) > 90 || Math.abs(point[1]) > 180)) {
      throw new Error(`Route ${record.id}: invalid path_coordinates.`);
    }
    const areas = input.affected_areas ?? [];
    if (!Array.isArray(areas) || areas.some(area => typeof area !== "string")) throw new Error(`Route ${record.id}: invalid affected_areas.`);
    record.path_coordinates = JSON.stringify(geometry);
    record.affected_areas = JSON.stringify(areas);
  }
  return record;
}

function loadSeeds(directory = path.join(__dirname, "..", "data"), log = console) {
  return Object.fromEntries(Object.entries(seedFiles).map(([table, filename]) => {
    const input = JSON.parse(fs.readFileSync(path.join(directory, filename), "utf8"));
    if (!Array.isArray(input)) throw new Error(`${filename} must contain an array.`);
    const records = [], seen = new Set();
    for (const [index, record] of input.entries()) {
      if (record && typeof record === "object" && !Array.isArray(record) && Object.keys(record).length === 0) {
        log.warn(`Skipping empty ${filename} record at index ${index}.`);
        continue;
      }
      if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`Invalid ${filename} record at index ${index}.`);
      const normalized = normalizeSeed(table, record);
      if (seen.has(normalized.id)) throw new Error(`Duplicate ID ${normalized.id} in ${filename}.`);
      seen.add(normalized.id);
      records.push(normalized);
    }
    return [table, records];
  }));
}

async function seed({ database = pool, directory, log = console } = {}) {
  const seeds = loadSeeds(directory, log);
  const counts = await transaction(async connection => {
    const [[selected]] = await connection.query("SELECT DATABASE() AS name");
    await verifySchema(connection, selected.name);
    const counts = {};
    for (const [table, records] of Object.entries(seeds)) {
      counts[table] = { inserted: 0, existing: 0 };
      for (const record of records) {
        const [existing] = await connection.execute(`SELECT id FROM \`${table}\` WHERE id = ? FOR UPDATE`, [record.id]);
        if (existing.length) {
          counts[table].existing += 1;
          continue; // Never overwrite a member's subsequent edits when rerunning seeds.
        }
        await insert(connection, table, record);
        counts[table].inserted += 1;
      }
    }

    // Reject contradictory publication references, but retain incomplete legacy reports for review.
    const [reports] = await connection.execute("SELECT id, status, published_type, published_item_id, published_notice_id FROM reports");
    for (const report of reports) {
      const [projects] = await connection.execute("SELECT id FROM projects WHERE source_report_id = ?", [report.id]);
      const [notices] = await connection.execute("SELECT id FROM announcements WHERE source_report_id = ?", [report.id]);
      if (projects.length + notices.length > 1) throw new Error(`Report ${report.id} has multiple publications.`);
      const target = report.published_type === "project" ? projects[0] : report.published_type === "announcement" ? notices[0] : null;
      if ((report.published_item_id != null && target?.id !== report.published_item_id) ||
          (report.published_type != null && !target) ||
          ((projects.length || notices.length) && !target) ||
          (report.published_notice_id != null && notices[0]?.id !== report.published_notice_id)) {
        throw new Error(`Report ${report.id} has an inconsistent publication reference.`);
      }
      if (["Approved", "Completed"].includes(report.status) && !target) {
        log.warn(`Legacy report ${report.id} is ${report.status} without a publication. Review and publish it in Admin; no content was invented.`);
      }
    }
    return counts;
  }, database);
  log.log("Seed committed:", counts);
  return counts;
}

if (require.main === module) seed().catch(error => {
  console.error("Seed failed; transaction rolled back:", error.message);
  process.exitCode = 1;
}).finally(() => pool.end());

module.exports = { seed, loadSeeds, normalizeSeed };
