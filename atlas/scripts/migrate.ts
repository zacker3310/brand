/** Applies drizzle migrations, after ensuring required extensions exist. */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, getDb, getPool } from "../src/db/client";

async function main() {
  const pool = getPool();
  await pool.query("create extension if not exists pg_trgm");
  await pool.query("create extension if not exists unaccent");
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
