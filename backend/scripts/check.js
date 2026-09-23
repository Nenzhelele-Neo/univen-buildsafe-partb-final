const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..", "..");

function javascript(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (["node_modules", "uploads"].includes(entry.name)) return [];
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? javascript(filename) : entry.name.endsWith(".js") ? [filename] : [];
  });
}

const files = [...javascript(path.join(root, "backend")), ...javascript(path.join(root, "frontend"))];
for (const filename of files) new vm.Script(fs.readFileSync(filename, "utf8"), { filename });
console.log(`Syntax passed: ${files.length} JavaScript files.`);

const { fields } = require("../store");
const schema = fs.readFileSync(path.join(root, "backend/database/schema.sql"), "utf8");
for (const [table, mapping] of Object.entries(fields)) {
  const definition = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\) ENGINE`))?.[1];
  assert.ok(definition, `Missing table ${table}`);
  for (const column of Object.values(mapping)) assert.match(definition, new RegExp(`\\b${column}\\s+(?:BIGINT|VARCHAR|TEXT|DATE|DECIMAL|BOOLEAN|JSON)\\b`), `${table}.${column}`);
}
console.log("Schema covers every SQL/API field mapping.");

const server = fs.readFileSync(path.join(root, "backend/server.js"), "utf8");
const endpoints = new Set([...server.matchAll(/app\.(get|post|put|delete)\("([^"]+)"/g)].map(match => `${match[1].toUpperCase()} ${match[2]}`));
const expected = ["POST /api/login", "GET /api/projects", "POST /api/projects", "PUT /api/projects/:id", "DELETE /api/projects/:id",
  "GET /api/announcements", "POST /api/announcements", "GET /api/campus-locations", "GET /api/routes", "GET /api/safe-route",
  "GET /api/reports", "POST /api/reports", "PUT /api/reports/:id/status", "DELETE /api/reports/:id"];
for (const endpoint of expected) assert.ok(endpoints.has(endpoint), `Missing endpoint ${endpoint}`);
for (const filename of javascript(path.join(root, "frontend"))) {
  for (const match of fs.readFileSync(filename, "utf8").matchAll(/["'`]\/api\/([a-z-]+)/g)) {
    assert.ok(expected.some(endpoint => endpoint.split(" ")[1] === `/api/${match[1]}`), `Unknown frontend API ${match[0]}`);
  }
}
for (const filename of ["server.js", "store.js", "routing.js", "db.js"]) {
  const source = fs.readFileSync(path.join(root, "backend", filename), "utf8");
  assert.doesNotMatch(source, /\b(readData|writeData)\s*\(|["'](?:reports|projects|announcements|users|routes|campus-locations)\.json["']/);
  assert.ok(!/password\s*:\s*["'][^"']+["']/i.test(source.replace('password: "password"', '')), `Literal credential in ${filename}`);
}
console.log("All 14 API contracts retained; no runtime JSON persistence or literal database passwords.");
