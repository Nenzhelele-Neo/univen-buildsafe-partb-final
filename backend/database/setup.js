const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { config, pool } = require("../db");
const { fields } = require("../store");

async function verifySchema(connection, database = config.database) {
  const [columns] = await connection.execute(
    "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?", [database]
  );
  const problems = [];
  const expectedTypes = {
    latitude: "decimal", longitude: "decimal", date: "date", start_date: "date", end_date: "date",
    published_start_date: "date", published_end_date: "date", path_coordinates: "json", affected_areas: "json"
  };
  for (const [table, mapping] of Object.entries(fields)) {
    for (const column of Object.values(mapping)) {
      const actual = columns.find(item => item.TABLE_NAME === table && item.COLUMN_NAME === column);
      if (!actual) problems.push(`${table}.${column} is missing`);
      else if ((column === "id" || column.endsWith("_id")) && actual.COLUMN_TYPE.toLowerCase() !== "bigint unsigned") {
        problems.push(`${table}.${column} must be BIGINT UNSIGNED`);
      } else if (column === "id" && !actual.EXTRA.includes("auto_increment")) problems.push(`${table}.id must generate IDs`);
      else if (expectedTypes[column] && !actual.COLUMN_TYPE.toLowerCase().startsWith(expectedTypes[column])) {
        problems.push(`${table}.${column} must use ${expectedTypes[column].toUpperCase()}`);
      }
    }
  }
  const [tables] = await connection.execute(
    "SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]
  );
  for (const table of tables.filter(item => fields[item.TABLE_NAME])) {
    if (table.ENGINE !== "InnoDB") problems.push(`${table.TABLE_NAME} must use InnoDB transactions`);
  }
  const [indexes] = await connection.execute(
    "SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_list FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE", [database]
  );
  for (const [table, column] of [["users", "email"], ["projects", "source_report_id"], ["announcements", "source_report_id"]]) {
    if (!indexes.some(index => index.TABLE_NAME === table && Number(index.NON_UNIQUE) === 0 && index.columns_list === column)) {
      problems.push(`${table}.${column} requires a unique index`);
    }
  }
  const [foreignKeys] = await connection.execute(
    `SELECT k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE
     FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.TABLE_SCHEMA = ?`, [database]
  );
  for (const [table, column, target] of [["projects", "source_report_id", "reports"], ["announcements", "source_report_id", "reports"],
    ["routes", "start_location_id", "campus_locations"], ["routes", "end_location_id", "campus_locations"]]) {
    if (!foreignKeys.some(key => key.TABLE_NAME === table && key.COLUMN_NAME === column && key.REFERENCED_TABLE_NAME === target &&
        key.REFERENCED_COLUMN_NAME === "id" && (target !== "reports" || key.DELETE_RULE === "CASCADE"))) {
      problems.push(`${table}.${column} requires its schema-defined foreign key`);
    }
  }
  if (problems.length) throw new Error(
    `Incompatible database schema: ${problems.join("; ")}. Use a new DB_NAME for a fresh setup or explicitly upgrade a backed-up database. Existing tables are never dropped or rebuilt automatically.`
  );
}

async function upgradeSchema(connection) {
  const [[selected]] = await connection.query("SELECT DATABASE() AS name");
  if (!selected?.name) throw new Error("No database selected for schema upgrade.");
  const [columns] = await connection.execute(
    "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?", [selected.name]
  );
  const existing = table => new Set(columns.filter(column => column.TABLE_NAME === table).map(column => column.COLUMN_NAME));
  const additions = {
    reports: {
      published_work_type: "VARCHAR(20) NULL AFTER published_category",
      published_status: "VARCHAR(20) NULL AFTER published_work_type",
      published_latitude: "DECIMAL(11,8) NULL AFTER published_end_date",
      published_longitude: "DECIMAL(11,8) NULL AFTER published_latitude",
      published_show_on_map: "BOOLEAN NULL AFTER published_longitude"
    },
    projects: { work_type: "VARCHAR(20) NOT NULL DEFAULT 'Construction' AFTER status" },
    announcements: {
      latitude: "DECIMAL(11,8) NULL AFTER date",
      longitude: "DECIMAL(11,8) NULL AFTER latitude",
      show_on_map: "BOOLEAN NOT NULL DEFAULT FALSE AFTER longitude"
    }
  };
  const added = new Set();
  for (const [table, definitions] of Object.entries(additions)) {
    const tableColumns = existing(table);
    for (const [column, definition] of Object.entries(definitions)) {
      if (!tableColumns.has(column)) {
        await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
        added.add(`${table}.${column}`);
      }
    }
  }
  if (added.has("projects.work_type")) {
    await connection.execute("UPDATE projects SET work_type = 'Maintenance' WHERE name = 'Road Maintenance'");
    await connection.execute("UPDATE projects SET work_type = 'Construction' WHERE name = 'Library Area Construction'");
  }
  if (added.has("announcements.show_on_map")) {
    await connection.execute("UPDATE announcements SET show_on_map = TRUE WHERE latitude IS NOT NULL AND longitude IS NOT NULL");
  }
  await connection.query(
    `UPDATE reports r JOIN projects p ON p.source_report_id = r.id
     SET r.published_category = NULL, r.published_work_type = p.work_type, r.published_status = p.status,
         r.published_latitude = p.latitude, r.published_longitude = p.longitude,
         r.published_show_on_map = NULL
     WHERE r.published_type = 'project'`
  );
  await connection.query(
    `UPDATE reports r JOIN announcements a ON a.source_report_id = r.id
     SET r.published_work_type = NULL, r.published_status = NULL,
         r.published_latitude = a.latitude, r.published_longitude = a.longitude,
         r.published_show_on_map = a.show_on_map
     WHERE r.published_type = 'announcement'`
  );
}

async function applySchema(connection) {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  const statements = schema.replace(/^\s*--.*$/gm, "").split(";").map(value => value.trim()).filter(Boolean);
  for (const statement of statements) await connection.query(statement);
  await upgradeSchema(connection);
}

async function setup() {
  const connection = await mysql.createConnection({ ...config, database: undefined });
  try {
    // DB_NAME is restricted to an identifier-safe alphabet by db.js.
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.changeUser({ database: config.database });
    await applySchema(connection);
    await verifySchema(connection);
    console.log(`Schema ready in ${config.database}.`);
  } finally {
    await connection.end();
  }
}

if (require.main === module) setup().catch(error => {
  console.error("Schema setup failed:", error.message);
  process.exitCode = 1;
}).finally(() => pool.end());

module.exports = { setup, applySchema, upgradeSchema, verifySchema };
