/**
 * Database client (node-postgres + Drizzle). Server-only.
 * A single pool per process; Next.js dev HMR reuses it via globalThis.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __atlasPool?: pg.Pool; __atlasDb?: DB };

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/atlas";
}

export function getPool(): pg.Pool {
  if (!globalForDb.__atlasPool) {
    globalForDb.__atlasPool = new pg.Pool({
      connectionString: databaseUrl(),
      max: Number(process.env.ATLAS_DB_POOL ?? 10),
      idleTimeoutMillis: 30_000,
    });
  }
  return globalForDb.__atlasPool;
}

export function getDb(): DB {
  if (!globalForDb.__atlasDb) globalForDb.__atlasDb = drizzle(getPool(), { schema });
  return globalForDb.__atlasDb;
}

export const db = new Proxy({} as DB, {
  get(_t, prop) {
    return Reflect.get(getDb() as object, prop);
  },
});

export async function closeDb() {
  if (globalForDb.__atlasPool) {
    await globalForDb.__atlasPool.end();
    globalForDb.__atlasPool = undefined;
    globalForDb.__atlasDb = undefined;
  }
}

export { schema };
