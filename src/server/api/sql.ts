import { sql, type SQL } from "drizzle-orm";

/** `where a and b ...` or empty. */
export function whereAll(conds: (SQL | null | undefined | false)[]): SQL {
  const c = conds.filter((x): x is SQL => !!x);
  return c.length ? sql`where ${sql.join(c, sql` and `)}` : sql``;
}

/** ILIKE pattern with %, _ and \ escaped; matches anywhere. */
export function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export const iso = (d: Date | string | null | undefined): string | null => (d ? (d instanceof Date ? d : new Date(d)).toISOString() : null);

export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
