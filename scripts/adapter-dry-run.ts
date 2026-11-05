/**
 * Runs an adapter end-to-end in memory (discover -> fetch -> parse -> normalize -> validate)
 * without touching the database. Writes the bundle to .cache/bundles/<system>.json.
 *
 *   npx tsx scripts/adapter-dry-run.ts <adapterId> <systemSlug> [--limit N] [--quiet]
 *
 * Exit code 1 if the bundle fails contract validation or contains error-severity issues.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { NormalizedBundle } from "../src/lib/contracts";
import { getAdapter } from "../src/ingestion/adapters";
import { PoliteFetcher } from "../src/ingestion/http";
import type { AdapterContext, ParsedFragment } from "../src/ingestion/types";

async function main() {
  const [adapterId, systemSlug, ...rest] = process.argv.slice(2);
  if (!adapterId || !systemSlug) throw new Error("usage: adapter-dry-run <adapterId> <systemSlug> [--limit N]");
  const limitIdx = rest.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(rest[limitIdx + 1]) : undefined;
  const quiet = rest.includes("--quiet");
  const adapter = getAdapter(adapterId);
  if (!adapter) throw new Error(`unknown adapter ${adapterId}`);
  if (!adapter.systems.includes(systemSlug)) throw new Error(`adapter ${adapterId} does not handle ${systemSlug} (handles: ${adapter.systems.join(", ")})`);
  const http = new PoliteFetcher();
  const log = {
    info: (m: string, e?: Record<string, unknown>) => !quiet && console.log(`[info] ${m}`, e ?? ""),
    warn: (m: string, e?: Record<string, unknown>) => console.warn(`[warn] ${m}`, e ?? ""),
    error: (m: string, e?: Record<string, unknown>) => console.error(`[error] ${m}`, e ?? ""),
  };
  const ctx: AdapterContext = { systemSlug, http, log, runStartedAt: new Date().toISOString(), limit };
  const t0 = Date.now();
  const docs = await adapter.discover(ctx);
  console.log(`discovered ${docs.length} documents`);
  const fragments: ParsedFragment[] = [];
  let fetchErrors = 0;
  let parseErrors = 0;
  const queue = [...docs].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  const workers = Array.from({ length: 6 }, async () => {
    for (let doc = queue.shift(); doc; doc = queue.shift()) {
      const result = adapter.fetch ? await adapter.fetch(ctx, doc, {}) : await http.get(doc.url);
      if (!result.ok || result.body === null) {
        fetchErrors++;
        log.warn(`fetch failed ${doc.url}: ${result.status} ${result.error ?? ""}`);
        continue;
      }
      try {
        const out = await adapter.parse(ctx, { doc, result });
        if (out) fragments.push(...(Array.isArray(out) ? out : [out]));
      } catch (e) {
        parseErrors++;
        log.error(`parse failed ${doc.url}: ${(e as Error).message}`);
      }
    }
  });
  await Promise.all(workers);
  const bundle = await adapter.normalize(ctx, fragments);
  const parsed = NormalizedBundle.safeParse(bundle);
  const issues = adapter.validate?.(ctx, bundle) ?? [];
  await mkdir(".cache/bundles", { recursive: true });
  await writeFile(`.cache/bundles/${systemSlug}.json`, JSON.stringify(bundle, null, 2));
  const tokens = bundle.tokenSets.reduce((n, s) => n + s.tokens.length, 0);
  const summary = {
    adapter: adapterId,
    system: systemSlug,
    documents: docs.length,
    fetchErrors,
    parseErrors,
    fragments: fragments.length,
    components: bundle.components.length,
    withVariants: bundle.components.filter((c) => c.variants.length).length,
    withStates: bundle.components.filter((c) => c.states.length).length,
    withProps: bundle.components.filter((c) => c.properties.length).length,
    withA11y: bundle.components.filter((c) => c.accessibility).length,
    classified: bundle.components.filter((c) => c.canonicalType).length,
    tokenSets: bundle.tokenSets.length,
    tokens,
    patterns: bundle.patterns.length,
    contractValid: parsed.success,
    issues: issues.length,
    errorIssues: issues.filter((i) => i.severity === "error").length,
    http: http.stats,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!parsed.success) {
    console.error(JSON.stringify(parsed.error.issues.slice(0, 20), null, 2));
    process.exit(1);
  }
  if (summary.errorIssues > 0) {
    console.error(JSON.stringify(issues.filter((i) => i.severity === "error").slice(0, 20), null, 2));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
