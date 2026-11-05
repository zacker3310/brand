import { describe, expect, it } from "vitest";
import { buildExportCss, buildExportJson, cssValueOf, cssVarName, exportDecision, exportFileName, licenseHref, type ExportSetMeta, type ExportToken } from "@/components/tokens/lib/export";

const meta: ExportSetMeta = {
  systemSlug: "demo",
  systemName: "Demo",
  setSlug: "light",
  setName: "Light",
  theme: "light",
  format: "dtcg",
  sourceUrl: "https://example.com/tokens.json",
  packageName: "@demo/tokens",
  packageVersion: "1.2.3",
  redistribution: "permitted",
  license: { slug: "mit", name: "MIT License", spdxId: "MIT", url: null },
  retrievedAt: "2026-11-05T04:00:00.000Z",
};
const tok = (o: Partial<ExportToken>): ExportToken => ({
  name: "fg.default",
  path: ["fg", "default"],
  cssVar: null,
  type: "color",
  category: "color",
  tier: null,
  tierState: "inferred",
  rawValue: "#000",
  resolvedValue: "#000",
  valueText: "#000",
  aliasState: null,
  description: null,
  deprecated: false,
  location: null,
  ...o,
});

describe("export decision", () => {
  it("allows only permitted sets", () => {
    expect(exportDecision("permitted").allowed).toBe(true);
    for (const r of ["conditional", "restricted", "unknown", null, "weird"]) {
      const d = exportDecision(r);
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.reason.length).toBeGreaterThan(20);
    }
  });
  it("names files and links SPDX licenses canonically", () => {
    expect(exportFileName(meta, "json")).toBe("demo-light-1.2.3.tokens.json");
    expect(licenseHref({ spdxId: "Apache-2.0", url: "https://elsewhere" })).toBe("https://spdx.org/licenses/Apache-2.0.html");
  });
});

describe("CSS export", () => {
  it("keeps authored variable names or derives them from the path", () => {
    expect(cssVarName(tok({ cssVar: "--fgColor-default" }))).toBe("--fgColor-default");
    expect(cssVarName(tok({}))).toBe("--fg-default");
  });
  it("never invents values for unresolved, external, cycle or theme-dependent tokens", () => {
    expect(cssValueOf(tok({ aliasState: "unresolved", resolvedValue: null, rawValue: "{x}" }))).toHaveProperty("skip");
    expect(cssValueOf(tok({ aliasState: "external", resolvedValue: null }))).toHaveProperty("skip");
    expect(cssValueOf(tok({ aliasState: "theme-dependent", resolvedValue: { $themes: { a: "#000" } } }))).toHaveProperty("skip");
    expect(cssValueOf(tok({ type: "typography", rawValue: { breakpoints: { lg: 1 } }, resolvedValue: null }))).toHaveProperty("skip");
  });
  it("writes attribution, values and comments for skipped tokens", () => {
    const css = buildExportCss(meta, [tok({}), tok({ name: "x", path: ["x"], aliasState: "unresolved", resolvedValue: null, rawValue: "{nope}" })], "2026-11-05T05:00:00Z");
    expect(css).toContain("Demo · Light · @demo/tokens@1.2.3 · MIT");
    expect(css).toContain("--fg-default: #000;");
    expect(css).toContain("/* --x: not exported (unresolved reference {nope}) */");
    expect(css).toContain("1 of 2 tokens have no static CSS value");
  });
  it("cannot be broken out of with crafted comments", () => {
    const css = buildExportCss({ ...meta, setName: "evil */ body{}" }, [], "now");
    expect(css).not.toContain("evil */");
  });
});

describe("JSON export", () => {
  it("includes provenance metadata and the stored values", () => {
    const doc = JSON.parse(buildExportJson(meta, [tok({})], "now"));
    expect(doc.$atlas).toMatchObject({ source: meta.sourceUrl, redistribution: "permitted", tokenCount: 1 });
    expect(doc.tokens[0]).toMatchObject({ name: "fg.default", value: "#000", aliasState: "literal" });
  });
});
