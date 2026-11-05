/**
 * Shared integration-test database bootstrap. Creates the named test database (cloned from
 * atlas_template when present, otherwise empty) and applies every pending drizzle migration, so a
 * test database created before a schema change never silently runs against an old schema.
 * Refuses the dev database.
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const FORBIDDEN = new Set(["atlas", "atlas_template", "postgres", "template0", "template1"]);

export async function ensureMigratedTestDatabase(url: string): Promise<void> {
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName || FORBIDDEN.has(dbName)) throw new Error(`refusing to use database "${dbName}" for integration tests`);
  if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`unexpected test database name ${dbName}`);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query("select pg_advisory_lock(hashtext($1))", [`atlas:test-db:create:${dbName}`]);
    const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
    if (!rowCount) {
      const { rowCount: hasTemplate } = await admin.query("select 1 from pg_database where datname = 'atlas_template'");
      await admin.query(`create database "${dbName}"${hasTemplate ? " template atlas_template" : ""}`);
    }
  } finally {
    await admin.end();
  }
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    // Several test files may bootstrap the same database concurrently: serialize migrations.
    await c.query("select pg_advisory_lock(hashtext('atlas:test-db:migrate'))");
    await c.query("create extension if not exists pg_trgm");
    await c.query("create extension if not exists unaccent");
    await migrate(drizzle(c), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  } finally {
    await c.end();
  }
}
