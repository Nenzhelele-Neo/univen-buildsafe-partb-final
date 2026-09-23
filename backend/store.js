const { pool, transaction } = require("./db");
const { fail } = require("./validation");

// Explicit mappings preserve the existing browser API's camelCase fields.
const fields = {
  users: { id: "id", name: "name", email: "email", password: "password", role: "role" },
  projects: {
    id: "id", name: "name", description: "description", location: "location", status: "status",
    workType: "work_type", startDate: "start_date", endDate: "end_date", affectedArea: "affected_area",
    latitude: "latitude", longitude: "longitude", sourceReportId: "source_report_id", photoUrl: "photo_url"
  },
  reports: {
    id: "id", category: "category", name: "name", location: "location", description: "description",
    date: "date", status: "status", latitude: "latitude", longitude: "longitude", photoUrl: "photo_url",
    publishedTitle: "published_title", publishedCategory: "published_category", publishedLocation: "published_location",
    publishedWorkType: "published_work_type", publishedStatus: "published_status",
    publishedDescription: "published_description", publishedAffectedArea: "published_affected_area",
    publishedStartDate: "published_start_date", publishedEndDate: "published_end_date", publishedType: "published_type",
    publishedLatitude: "published_latitude", publishedLongitude: "published_longitude",
    publishedShowOnMap: "published_show_on_map",
    publishedItemId: "published_item_id", publishedNoticeId: "published_notice_id"
  },
  announcements: {
    id: "id", title: "title", category: "category", location: "location", message: "message",
    date: "date", latitude: "latitude", longitude: "longitude", showOnMap: "show_on_map",
    photoUrl: "photo_url", sourceReportId: "source_report_id"
  },
  campus_locations: { id: "id", name: "name", type: "type", latitude: "latitude", longitude: "longitude" },
  routes: Object.fromEntries([
    "id", "route_name", "start_location_id", "end_location_id", "route_type", "distance_meters",
    "estimated_minutes", "status", "pedestrian_accessible", "vehicle_accessible", "path_coordinates", "affected_areas"
  ].map(name => [name, name]))
};

function select(table) {
  return `SELECT ${Object.entries(fields[table]).map(([key, column]) => `\`${column}\` AS \`${key}\``).join(", ")} FROM \`${table}\``;
}

async function rows(connection, table, suffix = "", values = []) {
  const [result] = await connection.execute(`${select(table)} ${suffix}`, values);
  return result;
}

async function insert(connection, table, record) {
  const keys = Object.keys(record);
  const columns = keys.map(key => `\`${fields[table][key]}\``).join(", ");
  const [result] = await connection.execute(
    `INSERT INTO \`${table}\` (${columns}) VALUES (${keys.map(() => "?").join(", ")})`,
    keys.map(key => record[key])
  );
  return record.id ?? result.insertId;
}

async function update(connection, table, id, record) {
  const keys = Object.keys(record);
  await connection.execute(
    `UPDATE \`${table}\` SET ${keys.map(key => `\`${fields[table][key]}\` = ?`).join(", ")} WHERE id = ?`,
    [...keys.map(key => record[key]), id]
  );
}

function decodeRoutes(routes) {
  return routes.map(route => ({
    ...route,
    pedestrian_accessible: Boolean(Number(route.pedestrian_accessible)),
    vehicle_accessible: Boolean(Number(route.vehicle_accessible)),
    ...Object.fromEntries(["path_coordinates", "affected_areas"].map(key => {
      const value = typeof route[key] === "string" ? JSON.parse(route[key]) : route[key];
      if (!Array.isArray(value)) throw new Error(`Route ${route.id} has invalid ${key}.`);
      return [key, value];
    }))
  }));
}

function createStore(database = pool) {
  const transact = work => transaction(work, database);
  const one = async (connection, table, id, lock = false) => {
    const [record] = await rows(connection, table, `WHERE id = ?${lock ? " FOR UPDATE" : ""}`, [id]);
    if (!record) fail(404, `${table === "reports" ? "Report" : "Project"} not found.`);
    return record;
  };

  async function lockProject(connection, id) {
    // All linked workflows lock the report before its publication.
    const initial = await one(connection, "projects", id);
    const report = initial.sourceReportId ? await one(connection, "reports", initial.sourceReportId, true) : null;
    return { project: await one(connection, "projects", id, true), report };
  }

  async function removeReport(connection, report) {
    const publications = [
      ...await rows(connection, "projects", "WHERE source_report_id = ? FOR UPDATE", [report.id]),
      ...await rows(connection, "announcements", "WHERE source_report_id = ? FOR UPDATE", [report.id])
    ];
    await connection.execute("DELETE FROM projects WHERE source_report_id = ?", [report.id]);
    await connection.execute("DELETE FROM announcements WHERE source_report_id = ?", [report.id]);
    await connection.execute("DELETE FROM reports WHERE id = ?", [report.id]);
    return [report.photoUrl, ...publications.map(item => item.photoUrl)].filter(Boolean);
  }

  return {
    async login(email, password) {
      const [users] = await database.execute(
        "SELECT id, name, email, role FROM users WHERE email = ? AND BINARY password = ?", [email, password]
      );
      return users[0];
    },
    projects: () => rows(database, "projects", "ORDER BY id DESC"),
    async announcements() {
      return (await rows(database, "announcements", "ORDER BY date DESC, id DESC"))
        .map(item => ({ ...item, showOnMap: Boolean(Number(item.showOnMap)) }));
    },
    reports: () => rows(database, "reports", "ORDER BY date DESC, id DESC"),
    report: id => one(database, "reports", id),
    locations: () => rows(database, "campus_locations", "WHERE type <> 'Junction' OR type IS NULL ORDER BY id"),
    async routes() { return decodeRoutes(await rows(database, "routes", "ORDER BY id")); },
    async routingData() {
      // One transaction gives all three reads the same committed snapshot.
      return transact(async connection => ({
        locations: await rows(connection, "campus_locations", "ORDER BY id"),
        routes: decodeRoutes(await rows(connection, "routes", "ORDER BY id")),
        projects: await rows(connection, "projects", "WHERE status = 'In Progress' ORDER BY id")
      }));
    },
    async createProject(project) {
      return transact(async connection => one(connection, "projects", await insert(connection, "projects", project)));
    },
    async updateProject(id, project) {
      return transact(async connection => {
        const { project: existing, report } = await lockProject(connection, id);
        await update(connection, "projects", id, project);
        if (existing.sourceReportId) {
          await update(connection, "reports", report.id, {
            publishedTitle: project.name, publishedCategory: null, publishedWorkType: project.workType,
            publishedStatus: project.status,
            publishedLocation: project.location, publishedDescription: project.description,
            publishedAffectedArea: project.affectedArea, publishedStartDate: project.startDate,
            publishedEndDate: project.endDate, publishedLatitude: project.latitude,
            publishedLongitude: project.longitude, publishedShowOnMap: null,
            publishedType: "project", publishedItemId: id, publishedNoticeId: null,
            status: project.status === "Completed" ? "Completed" : report.status === "Completed" ? "Approved" : report.status
          });
        }
        return one(connection, "projects", id);
      });
    },
    async deleteProject(id) {
      return transact(async connection => {
        const { project, report } = await lockProject(connection, id);
        if (report) return removeReport(connection, report);
        await connection.execute("DELETE FROM projects WHERE id = ?", [id]);
        return project.photoUrl ? [project.photoUrl] : [];
      });
    },
    async createAnnouncement(announcement) {
      return transact(async connection => {
        const id = await insert(connection, "announcements", announcement);
        const item = (await rows(connection, "announcements", "WHERE id = ?", [id]))[0];
        return { ...item, showOnMap: Boolean(Number(item.showOnMap)) };
      });
    },
    async createReport(report) {
      return transact(async connection => one(connection, "reports", await insert(connection, "reports", report)));
    },
    async reviewReport(id, publication) {
      return transact(async connection => {
        const report = await one(connection, "reports", id, true);
        if (publication.completeOnly) {
          if (report.status !== "Approved" || report.publishedType !== "project") fail(409, "Only approved campus work can be marked complete.");
          await connection.execute("UPDATE projects SET status = 'Completed' WHERE source_report_id = ?", [id]);
          await update(connection, "reports", id, { status: "Completed" });
          return one(connection, "reports", id);
        }
        if (publication.status === "Rejected") {
          await connection.execute("DELETE FROM projects WHERE source_report_id = ?", [id]);
          await connection.execute("DELETE FROM announcements WHERE source_report_id = ?", [id]);
          await update(connection, "reports", id, {
            ...publication, publishedType: null, publishedItemId: null, publishedNoticeId: null
          });
          return one(connection, "reports", id);
        }

        const isWork = publication.publishedType === "project";
        const table = isWork ? "projects" : "announcements";
        const otherTable = isWork ? "announcements" : "projects";
        await connection.execute(`DELETE FROM ${otherTable} WHERE source_report_id = ?`, [id]);
        const [existing] = await rows(connection, table, "WHERE source_report_id = ? FOR UPDATE", [id]);
        const common = { sourceReportId: id, photoUrl: report.photoUrl || existing?.photoUrl || null };
        const latitude = publication.publishedLatitude ?? existing?.latitude ?? report.latitude;
        const longitude = publication.publishedLongitude ?? existing?.longitude ?? report.longitude;
        const item = isWork ? {
          ...common, name: publication.publishedTitle, description: publication.publishedDescription,
          location: publication.publishedLocation, affectedArea: publication.publishedAffectedArea,
          startDate: publication.publishedStartDate, endDate: publication.publishedEndDate,
          status: publication.status === "Completed" ? "Completed" : publication.publishedStatus,
          workType: publication.publishedWorkType, latitude, longitude
        } : {
          ...common, title: publication.publishedTitle, category: publication.publishedCategory,
          location: publication.publishedLocation, message: publication.publishedDescription,
          date: existing?.date || new Date().toISOString().slice(0, 10),
          latitude, longitude, showOnMap: publication.publishedShowOnMap
        };
        let itemId;
        if (existing) {
          itemId = existing.id;
          await update(connection, table, itemId, item);
        } else {
          itemId = await insert(connection, table, item);
        }
        await update(connection, "reports", id, {
          ...publication, publishedItemId: itemId, publishedNoticeId: isWork ? null : itemId
        });
        return one(connection, "reports", id);
      });
    },
    async deleteReport(id) {
      return transact(async connection => removeReport(connection, await one(connection, "reports", id, true)));
    },
    async photoInUse(photoUrl) {
      const [result] = await database.execute(
        `SELECT photo_url FROM reports WHERE photo_url = ?
         UNION ALL SELECT photo_url FROM projects WHERE photo_url = ?
         UNION ALL SELECT photo_url FROM announcements WHERE photo_url = ? LIMIT 1`,
        [photoUrl, photoUrl, photoUrl]
      );
      return result.length > 0;
    }
  };
}

module.exports = { createStore, fields, rows, insert, update, decodeRoutes };
