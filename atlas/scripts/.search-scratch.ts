// TEMP scratch (deleted after use): seed fixtures into atlas_search and print rankings.
process.env.DATABASE_URL = "postgres://postgres:postgres@localhost:5432/atlas_search";
const { getPool, closeDb } = await import("../src/db/client");
const fx = await import("../tests/integration/search/fixtures");
const { reindexAll, search, suggest } = await import("../src/server/search");
const pool = getPool();
await fx.seedFixtures(pool);
console.log("reindex", await reindexAll());
console.log("reindex again", await reindexAll());
const qs = process.argv.slice(2).length ? process.argv.slice(2) : ["Accessible date picker", "Enterprise data table", "Dark mode tokens", "React combobox", "Government design systems", "Button with loading state", "comobox", "pagin", "snackbar", "button"];
for (const q of qs) {
  const r = await search({ q, limit: 8, offset: 0 });
  console.log(`\n=== ${q}  total=${r.total} took=${r.tookMs}ms interp=${JSON.stringify(r.interpretedFilters)} exp=${JSON.stringify(r.expansions)}`);
  for (const h of r.hits) console.log(`  ${h.score.toFixed(3).padStart(7)} ${h.entityType.padEnd(14)} ${h.title.padEnd(26)} ${h.subtitle ?? ""}  ${h.url}${h.highlight ? "  | " + h.highlight : ""}`);
  console.log("  facets:", JSON.stringify(r.facets));
}
console.log("\nsuggest pagin", await suggest("pagin"));
console.log("suggest snack", await suggest("snack"));
await closeDb();
