/** Drops and recreates the public schema, then migrates. Dev only. */
import { closeDb, getPool } from "../src/db/client";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("refusing to reset in production");
  const pool = getPool();
  await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await closeDb();
  console.log("schema dropped; run npm run db:migrate");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
