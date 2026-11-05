// TEMP scratch (deleted after use): perf + EXPLAIN on atlas_search with a synthetic stress system.
process.env.DATABASE_URL = "postgres://postgres:postgres@localhost:5432/atlas_search";
const { getPool, closeDb } = await import("../src/db/client");
const fx = await import("../tests/integration/search/fixtures");
const { reindexAll, search, suggest } = await import("../src/server/search");
const { parseQuery } = await import("../src/server/search/query");
const { buildSearchSql } = await import("../src/server/search/providers/postgres");
const { COMPONENT_TYPES } = await import("../src/lib/taxonomy");
const pool = getPool();
const tax = await fx.seedFixtures(pool);
const comps = Array.from({ length: 300 }, (_, i) => {
  const t = COMPONENT_TYPES[i % COMPONENT_TYPES.length]!;
  return { slug: `stress-${i}`, name: `${t.name} ${i}`, type: t.slug, description: `Synthetic ${t.name.toLowerCase()} number ${i} for load testing.` };
});
const cats = ["color", "spacing", "typography", "shape", "motion"];
const mk = (theme: string) => Array.from({ length: Number(process.env.PERF_TOKENS ?? 2000) }, (_, i) => ({ name: `stress.${cats[i % 5]}.${theme}.item${i}`, category: cats[i % 5]!, tier: (i % 3 === 0 ? "primitive" : "semantic") as "primitive" | "semantic", value: `${i}px` }));
await fx.insertSystem(pool, tax, { slug: "stress", name: "Stress Fixture", org: "Stress Org", summary: "Synthetic stress-test system with many records.", frameworks: ["react"], components: comps, tokenSets: [ { slug: "light", name: "Light", theme: "light", tokens: mk("light") }, { slug: "dark", name: "Dark", theme: "dark", tokens: mk("dark") } ] });
console.log("reindexAll", await reindexAll());
console.log("reindexAll again", await reindexAll());
await pool.query("analyze search_document");
console.log("docs", (await pool.query("select entity_type, count(*) from search_document group by 1 order by 2 desc")).rows);
const qs = ["Accessible date picker", "Enterprise data table", "Dark mode tokens", "React combobox", "Government design systems", "Button with loading state", "comobox", "pagin", "snackbar", "color", "button", "tokens", "primer buton"];
for (const q of qs) await search({ q, limit: 20, offset: 0 }); // warm
const rows: string[] = [];
for (const q of qs) {
  const t: number[] = [];
  let total = 0;
  for (let i = 0; i < 15; i++) { const s = performance.now(); const r = await search({ q, limit: 20, offset: 0 }); t.push(performance.now() - s); total = r.total; }
  t.sort((a, b) => a - b);
  rows.push(`${q.padEnd(28)} total=${String(total).padStart(5)}  p50=${t[7]!.toFixed(1)}ms  max=${t[14]!.toFixed(1)}ms`);
}
console.log(rows.join("\n"));
const st: number[] = [];
for (let i = 0; i < 15; i++) { const s = performance.now(); await suggest("pagin"); st.push(performance.now() - s); }
st.sort((a, b) => a - b);
console.log(`suggest("pagin") p50=${st[7]!.toFixed(1)}ms max=${st[14]!.toFixed(1)}ms`);
for (const q of ["React combobox", "comobox", "color"]) {
  const { text, values } = buildSearchSql(parseQuery({ q, limit: 20, offset: 0 }));
  const plan = await pool.query(`explain (analyze, costs off, timing off) ${text}`, values);
  console.log(`\n--- EXPLAIN ${q}\n` + plan.rows.map((r: any) => r["QUERY PLAN"]).filter((l: string) => /Scan|Bitmap|Index|Execution|Planning/.test(l)).join("\n"));
}
await closeDb();
