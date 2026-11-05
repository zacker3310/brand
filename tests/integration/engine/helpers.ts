/**
 * Integration test DB helpers. Uses a dedicated database (default atlas_engine_test, created from
 * atlas_template when missing) — never the integrator's dev database.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

export const TEST_DB_URL = process.env.ATLAS_ENGINE_TEST_DB ?? "postgres://postgres:postgres@localhost:5432/atlas_engine_test";

let prepared = false;

/** Point the app DB client at the test database (must run before the first getDb() call). */
export async function prepareTestDb() {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.ATLAS_ENGINE_QUIET = "1";
  if (prepared) return;
  const dbName = new URL(TEST_DB_URL).pathname.slice(1);
  if (dbName === "atlas") throw new Error("refusing to run engine tests against the dev database");
  const admin = new pg.Client({ connectionString: TEST_DB_URL.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  try {
    const { rows } = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
    if (!rows.length) await admin.query(`create database "${dbName}" template atlas_template`);
  } finally {
    await admin.end();
  }
  prepared = true;
}

/** Empty every table in the public schema. */
export async function truncateAll() {
  const c = new pg.Client({ connectionString: TEST_DB_URL });
  await c.connect();
  try {
    const { rows } = await c.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
    if (rows.length) await c.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
  } finally {
    await c.end();
  }
}

export function tempCacheDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "atlas-engine-cache-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const silentLog = { info: () => {}, warn: () => {}, error: () => {} };
