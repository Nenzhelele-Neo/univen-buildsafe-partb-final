const { pool, transaction } = require("./db");
const { loadSeeds } = require("./database/seed");

async function migrateRoutes() {
  const routes = loadSeeds().routes;
  await transaction(async connection => {
    for (const route of routes) {
      const [existing] = await connection.execute("SELECT id FROM routes WHERE id = ? FOR UPDATE", [route.id]);
      if (!existing.length) throw new Error(`Route ${route.id} is missing. Run npm run db:seed first.`);
      await connection.execute("UPDATE routes SET path_coordinates = ?, affected_areas = ? WHERE id = ?",
        [route.path_coordinates, route.affected_areas, route.id]);
    }
  });
  console.log(`Updated geometry for ${routes.length} routes.`);
}

migrateRoutes().catch(error => {
  console.error("Route migration failed; transaction rolled back:", error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
