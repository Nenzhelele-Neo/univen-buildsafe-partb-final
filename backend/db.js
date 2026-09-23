const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

// Resolve configuration relative to this module, regardless of the shell's cwd.
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

function port(value, fallback, name) {
  const number = Number(value || fallback);
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return number;
}

const config = {
  host: process.env.DB_HOST || "localhost",
  port: port(process.env.DB_PORT, 3306, "DB_PORT"),
  user: process.env.DB_USER || "buildsafe",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "buildDB",
  charset: "utf8mb4",
  dateStrings: true,
  decimalNumbers: true,
  supportBigNumbers: true,
  bigNumberStrings: false,
  connectTimeout: 10000
};

if (!/^[a-zA-Z0-9_]+$/.test(config.database)) {
  throw new Error("DB_NAME may contain only letters, numbers, and underscores.");
}

const pool = mysql.createPool({ ...config, waitForConnections: true, connectionLimit: 10 });

async function transaction(work, database = pool) {
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch { /* Preserve the original error. */ }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { pool, config, transaction, port: port(process.env.PORT, 3000, "PORT") };
