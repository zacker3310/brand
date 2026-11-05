/**
 * Broken-link check for published source URLs (source table: homepage/docs/repository/figma/...).
 * Updates source.last_checked_at / last_status / last_error. Polite: robots-aware, rate-limited.
 *
 *   npm run links                 # all sources
 *   npm run links -- --system carbon --limit 50
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/db/client";
import { designSystems, sources } from "../src/db/schema";
import { PoliteFetcher } from "../src/ingestion/http";

async function main() {
  const args = process.argv.slice(2);
  const sys = args.includes("--system") ? args[args.indexOf("--system") + 1] : undefined;
  const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : 5000;
  const db = getDb();
  const rows = await db
    .select({ id: sources.id, url: sources.url, kind: sources.kind, slug: designSystems.slug })
    .from(sources)
    .innerJoin(designSystems, eq(designSystems.id, sources.designSystemId))
    .where(and(sys ? eq(designSystems.slug, sys) : sql`true`, inArray(sources.kind, ["homepage", "docs", "repository", "figma", "storybook", "package"])))
    .limit(limit);
  const http = new PoliteFetcher({ hostDelayMs: 400, cacheDir: null });
  let ok = 0;
  let bad = 0;
  let blocked = 0;
  const queue = [...rows];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        // HEAD first (cheap); some servers reject HEAD, so fall back to GET.
        let res = await http.get(r.url, { method: "HEAD", timeoutMs: 15_000, maxRetries: 1 });
        if (!res.blockedByRobots && (res.status === 405 || res.status === 403 || res.status === 0 || res.status >= 500))
          res = await http.get(r.url, { timeoutMs: 20_000, maxRetries: 1, maxBytes: 5 * 1024 * 1024 });
        const robots = res.blockedByRobots;
        const error = robots ? "ROBOTS_DISALLOWED" : res.ok ? null : (res.error ?? `HTTP_${res.status}`);
        await db
          .update(sources)
          .set({ lastCheckedAt: new Date(), lastStatus: robots ? null : res.status, lastError: error, robotsAllowed: !robots })
          .where(eq(sources.id, r.id));
        if (robots) blocked++;
        else if (res.ok) ok++;
        else {
          bad++;
          console.log(`BROKEN ${r.slug} ${r.kind} ${r.url} -> ${res.status} ${error}`);
        }
      }
    }),
  );
  console.log(JSON.stringify({ checked: rows.length, ok, broken: bad, robotsBlocked: blocked }));
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
