import { describe, expect, it } from "vitest";
import { cellText, componentComparisonJson, componentComparisonRows } from "@/lib/scoring/export";
import { absentFrom, buildComponentMatrix, emptyField, PROPS_VISIBLE, tokenSwatches } from "@/lib/scoring/matrix";
import type { CompareTypeInfo, ComparisonColumn, ComponentDetail, MatrixRow } from "@/lib/scoring/types";

const TYPE: CompareTypeInfo = { id: "t", slug: "button", name: "Button", description: "Triggers an action.", ariaPattern: "button", group: "Actions", aliases: [], nearSynonyms: [] };

function detail(over: Partial<ComponentDetail> = {}): ComponentDetail {
  return {
    id: "c",
    slug: "button",
    name: "Button",
    aliases: [],
    description: "Starts an action.",
    docsUrl: "https://example.com/button",
    sourceCodeUrl: null,
    lifecycle: "stable",
    classification: { state: "inferred", method: "alias-exact:button", confidence: 0.9 },
    sizes: null,
    responsiveGuidance: null,
    coverage: {},
    variants: [],
    states: [],
    properties: [],
    accessibility: null,
    frameworks: [],
    examples: [],
    exampleCounts: {},
    tokens: [],
    evidence: { count: 3, sources: 2, lastRetrievedAt: "2026-11-05T04:00:00.000Z", methods: ["adapter:x:json"], hosts: ["example.com"] },
    ...over,
  };
}

function col(slug: string, component: ComponentDetail | null, missing: ComparisonColumn["missing"] = null): ComparisonColumn {
  return {
    system: { slug, name: slug.toUpperCase(), organization: null, category: "design-system", ingestionStatus: component ? "indexed" : "metadata_only", docsUrl: null, homepageUrl: null, lastIngestedAt: null },
    candidates: component ? [{ id: component.id, slug: component.slug, name: component.name, lifecycle: component.lifecycle, classificationState: "inferred", classificationMethod: null, confidence: 0.9 }] : [],
    component,
    missing: component ? null : (missing ?? "not-indexed"),
  };
}

const findRow = (m: ReturnType<typeof buildComponentMatrix>, id: string): MatrixRow => {
  for (const g of m.groups) for (const r of g.rows) if (r.id === id) return r;
  throw new Error(`row ${id} missing`);
};

describe("coverage helpers", () => {
  it("absent from a documented list is absent documentation, never absent capability", () => {
    expect(absentFrom("documented")).toBe("not-documented");
    expect(absentFrom("inferred")).toBe("not-documented");
    expect(absentFrom("documented-none")).toBe("documented-none");
    expect(absentFrom("not-extracted")).toBe("not-extracted");
  });
  it("an empty field claimed as documented is unknown", () => {
    expect(emptyField("documented")).toBe("not-extracted");
    expect(emptyField("not-documented")).toBe("not-documented");
    expect(emptyField("documented-none")).toBe("documented-none");
  });
});

describe("buildComponentMatrix", () => {
  const a = detail({
    id: "a",
    coverage: { states: "documented", variants: "documented", sizes: "documented", properties: "documented", keyboard: "documented", tokens: "documented" },
    states: [
      { name: "Hover", canonical: "hover", description: null },
      { name: "Disabled", canonical: "disabled", description: null },
    ],
    variants: [{ axis: "variant", name: "Primary", description: null }],
    sizes: [],
    properties: Array.from({ length: PROPS_VISIBLE + 3 }, (_, i) => ({ implementation: "react", name: `prop${i}`, type: "string", defaultValue: null, required: null, deprecated: false })).concat([
      { implementation: "react", name: "tabIndex", type: "number", defaultValue: null, required: null, deprecated: false },
    ]),
    accessibility: {
      ariaPattern: "button",
      roles: null,
      keyboard: [{ keys: "Enter / Space", action: "Activates the button." }],
      guidance: null,
      screenReader: null,
      focusManagement: null,
      wcagCriteria: null,
      docsUrl: null,
      coverage: { keyboard: "documented", roles: "not-documented" },
    },
    tokens: [
      {
        name: "button.bg",
        category: "color",
        type: "color",
        properties: ["background"],
        values: [{ set: "comp", theme: null, valueText: "light: #fff", resolved: { $themes: { light: "#ffffff", dark: "#000000" } }, aliasState: "theme-dependent" }],
      },
    ],
  });
  const b = detail({
    id: "b",
    name: "Btn",
    coverage: { states: "inferred", variants: "not-extracted", sizes: "not-documented", properties: "documented", keyboard: "not-documented" },
    states: [{ name: "disabled", canonical: "disabled", description: null }],
    properties: [{ implementation: "web-components", name: "tab-index", type: "number", defaultValue: "0", required: null, deprecated: false }],
  });

  it("builds one cell per system per row with honest empty states", () => {
    const m = buildComponentMatrix(TYPE, [col("a", a), col("b", b)]);
    const hover = findRow(m, "state:hover");
    expect(hover.cells.a!.value).toMatchObject({ kind: "chips", items: [{ label: "Hover" }] });
    // b's states are inferred and do not include hover: absent documentation
    expect(hover.cells.b!.value).toEqual({ kind: "coverage", state: "not-documented" });
    expect(findRow(m, "state:disabled").same).toBe(true);
    expect(hover.same).toBe(false);
    // sizes: [] is documented none; b says not documented
    expect(findRow(m, "sizes").cells.a!.value).toEqual({ kind: "coverage", state: "documented-none" });
    expect(findRow(m, "sizes").cells.b!.value).toEqual({ kind: "coverage", state: "not-documented" });
    // variants not extracted for b
    expect(findRow(m, "axis:variant").cells.b!.value).toEqual({ kind: "coverage", state: "not-extracted" });
    // roles: a11y record says not documented; b has no a11y record -> component coverage fallback (absent -> not-extracted)
    expect(findRow(m, "roles").cells.a!.value).toEqual({ kind: "coverage", state: "not-documented" });
    expect(findRow(m, "roles").cells.b!.value).toEqual({ kind: "coverage", state: "not-extracted" });
  });

  it("aligns props by normalized name, marks alignment, and collapses the long tail", () => {
    const m = buildComponentMatrix(TYPE, [col("a", a), col("b", b)]);
    const tab = findRow(m, "prop:tabindex");
    expect(tab.alignment).toEqual({ method: "normalized", names: ["tab-index", "tabIndex"] });
    expect(tab.cells.b!.value).toMatchObject({ kind: "props", entries: [{ implementation: "web-components", name: "tab-index", defaultValue: "0" }] });
    const api = m.groups.find((g) => g.id === "api")!;
    expect(api.rows[1]!.id).toBe("prop:tabindex"); // shared props first
    expect(api.overflowCount).toBe(PROPS_VISIBLE + 4 - PROPS_VISIBLE);
    expect(findRow(m, "prop:prop0").cells.b!.value).toEqual({ kind: "coverage", state: "not-documented" });
    expect(api.note).toMatch(/inferred/);
  });

  it("aligns documented keys and adds the ATLAS APG reference as a spanning row", () => {
    const m = buildComponentMatrix(TYPE, [col("a", a), col("b", b)]);
    const apg = findRow(m, "apg");
    expect(apg.span).toMatchObject({ kind: "text", text: "button" });
    const enter = findRow(m, "key:Enter");
    expect(enter.cells.a!.value).toMatchObject({ kind: "keyboard", hideKeys: true });
    expect(enter.cells.b!.value).toEqual({ kind: "coverage", state: "not-documented" });
    expect(findRow(m, "key:Space")).toBeTruthy();
  });

  it("renders theme-dependent token values as per-theme swatches", () => {
    const sw = tokenSwatches(a.tokens[0]!);
    expect(sw).toEqual([
      { css: "#ffffff", label: "light" },
      { css: "#000000", label: "dark" },
    ]);
    const m = buildComponentMatrix(TYPE, [col("a", a), col("b", b)]);
    expect(findRow(m, "tokens:color").cells.b!.value).toEqual({ kind: "coverage", state: "not-extracted" });
  });

  it("treats missing columns as not extracted and compares sameness over columns with data", () => {
    const m = buildComponentMatrix(TYPE, [col("a", a), col("b", b), col("z", null, "not-indexed")]);
    expect(findRow(m, "state:disabled").cells.z!.value).toMatchObject({ kind: "coverage", state: "not-extracted" });
    expect(findRow(m, "state:disabled").same).toBe(true);
    expect(m.sameBasis).toBe("indexed");
    const onlyOne = buildComponentMatrix(TYPE, [col("a", a), col("z", null, "no-component")]);
    expect(findRow(onlyOne, "state:disabled").same).toBe(false);
    expect(onlyOne.sameBasis).toBe("all");
    expect(m.differingRowCount).toBeLessThan(m.rowCount);
  });

  it("projects cells to text and JSON for exports, keeping coverage separate from values", () => {
    const columns = [col("a", a), col("b", b)];
    const m = buildComponentMatrix(TYPE, columns);
    expect(cellText({ kind: "coverage", state: "not-documented" })).toBe("[not documented (absent documentation)]");
    expect(cellText({ kind: "props", entries: [{ implementation: "react", name: "size", type: "'s' | 'm'", defaultValue: "'m'", required: true, deprecated: false }] })).toBe(
      "react: size 's' | 'm' = 'm' (required)",
    );
    const rows = componentComparisonRows(columns, m);
    expect(rows.every((r) => r.length === 5)).toBe(true);
    expect(rows.at(-1)).toEqual(["Sources", "Component docs", "", "https://example.com/button", "https://example.com/button"]);
    const json = componentComparisonJson(TYPE, columns, m, { url: "https://atlas.test/compare?type=button", generatedAt: "2026-11-05T00:00:00.000Z" });
    expect(json.atlas.disclaimer).toMatch(/belong to their respective owners/);
    const hoverJson = json.groups.find((g) => g.id === "states")!.rows.find((r) => r.id === "state:hover")!;
    expect(hoverJson.cells).toEqual({ a: { coverage: null, value: "Hover" }, b: { coverage: "not-documented", value: null } });
  });
});
