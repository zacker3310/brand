import { getComponentComparison, getCompareOptions, getSystemComparison, suggestComparisons } from "@/server/queries/compare";
import { buildComponentMatrix } from "@/lib/scoring/matrix";
import { scoreSystem } from "@/lib/scoring/rubrics";
import { CRITERIA } from "@/lib/scoring/types";
import { closeDb } from "@/db/client";
import { vi, it } from "vitest"; vi.mock("next/server", () => ({ connection: async () => {} }));
it("probe", async () => {
const t0 = Date.now();
const opts = await getCompareOptions();
console.log("types", opts.types.length, "systems", opts.systems.length, Date.now() - t0, "ms");
console.log(suggestComparisons(opts.types).map((s) => `${s.type}:${s.systemCount}`).join(" "));
const t1 = Date.now();
const d = await getComponentComparison({ type: "button", systems: ["github-primer", "carbon", "material-web", "material-design", "shadcn-ui"], picks: {} });
console.log("cmp ms", Date.now() - t1);
for (const c of d!.columns) console.log(c.system.slug, c.missing, c.component?.slug, c.candidates.map((x) => x.slug), c.component?.tokens.length, c.component?.exampleCounts);
const m = buildComponentMatrix(d!.type, d!.columns);
console.log("rows", m.rowCount, "diff", m.differingRowCount);
for (const g of m.groups) console.log(g.id, g.rows.length, g.rows.slice(0, 3).map((r) => r.id).join(","));
const t2 = Date.now();
const s = await getSystemComparison(["carbon", "github-primer", "material-web", "material-design", "apple-hig"]);
console.log("sys ms", Date.now() - t2);
for (const e of s.entries) {
  const res = scoreSystem(e.metrics, CRITERIA, { asOf: new Date(), taxonomySize: s.taxonomySize });
  console.log(e.info.slug, res.map((r) => `${r.criterion}=${r.score ?? r.status}/${r.confidence}/${r.evidenceCoverage}`).join("  "));
}
console.log(JSON.stringify(s.entries[0]!.metrics.tokens), JSON.stringify(s.entries[0]!.metrics.components.coverage.accessibility));

});
