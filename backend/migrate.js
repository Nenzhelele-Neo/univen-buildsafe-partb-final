const { seed } = require("./database/seed");
const { pool } = require("./db");

// Backwards-compatible entry point; schema setup is a separate, explicit step.
seed().catch(error => {
  console.error("Migration failed; transaction rolled back:", error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
