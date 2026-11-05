import { describe, it, expect, vi } from "vitest";
vi.mock("@/server/queries/db", async () => {
  const { getDb } = await import("@/db/client");
  return { readDb: async () => getDb() };
});
import { getCatalogFacets, getCatalogComponents, getCatalogTypes, getComponentType, getComponentDetail } from "@/server/queries/components";
import { parseCatalogParams } from "@/components/catalog/lib/params";

describe("smoke", () => {
  it("runs", async () => {
    const t0 = Date.now();
    const p = parseCatalogParams({ q: "button" });
    const facets = await getCatalogFacets(p);
    console.log("facets", Date.now() - t0, JSON.stringify(facets).slice(0, 1500));
    const rows = await getCatalogComponents(parseCatalogParams({ view: "components", q: "menu" }));
    console.log("rows", rows.length, rows.slice(0, 3).map((r) => `${r.name} ${r.systemSlug} ${r.typeSlug} ${r.propsCount}`));
    const types = await getCatalogTypes(parseCatalogParams({}));
    console.log("types", types.typesShown, types.emptyShown, types.unclassified.length, types.groups.map((g) => g.slug + ":" + g.types.length + "/" + g.empty.length).join(" "));
    const ct = await getComponentType("combobox");
    console.log("type", ct?.name, ct?.implementations.map((i) => i.name + "@" + i.systemSlug + " " + i.docShare.toFixed(2)), ct?.notFoundIn);
    const t1 = Date.now();
    const d = await getComponentDetail("github-primer", "action-menu");
    console.log("detail", Date.now() - t1, d?.component.name, d?.props.length, d?.tokens.length, d?.evidence.length, d?.relationships.length, d?.comparable.length, d?.changes.length, d?.examples.length);
    const d2 = await getComponentDetail("material-design", "buttons");
    console.log("detail2", d2?.tokens.slice(0, 2).map((t) => JSON.stringify(t)));
    expect(facets.universe).toBeGreaterThan(0);
  });
});
