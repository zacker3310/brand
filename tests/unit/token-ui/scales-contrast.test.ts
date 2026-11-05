import { describe, expect, it } from "vitest";
import { compareScales, extractScale } from "@/lib/tokens/compare";
import { expandForContrast, manualContrast, resolveOperand } from "@/components/tokens/lib/contrast";
import { alignScales, buildScaleComparison, dedupeSteps, formatScaleValue } from "@/components/tokens/lib/scales";

describe("scale alignment", () => {
  const a = extractScale([{ name: "space.1", rawValue: "4px", category: "spacing" }, { name: "space.2", rawValue: "0.5rem", category: "spacing" }], "spacing");
  const b = extractScale([{ name: "spacing-02", rawValue: "8px", category: "spacing" }, { name: "spacing-05", rawValue: "16px", category: "spacing" }], "spacing");
  it("aligns by numeric value only", () => {
    const rows = alignScales([a, b]);
    expect(rows.map((r) => [r.value, r.sharedBy])).toEqual([
      [4, 1],
      [8, 2],
      [16, 1],
    ]);
    expect(rows[1]!.cells.map((c) => c.map((s) => s.name))).toEqual([["space.2"], ["spacing-02"]]);
  });
  it("builds per-scale views with overlap against the first system", () => {
    const views = buildScaleComparison("spacing", (i) => [a, b][i]!, 2, (x, y) => {
      const c = compareScales(x, y);
      return { exact: c.summary.exact, overlap: c.summary.overlap };
    });
    expect(views[0]!.overlapWithFirst[1]).toEqual({ exact: 1, overlap: 0.333 });
  });
  it("dedupes repeated steps and formats values", () => {
    expect(dedupeSteps([...a, ...a])).toHaveLength(2);
    expect(formatScaleValue(0.38, "ratio")).toBe("38%");
    expect(formatScaleValue(200, "ms")).toBe("200ms");
  });
});

describe("contrast inputs", () => {
  const cands = [
    { name: "md.sys.color.on-primary", setSlug: "light", rawValue: "#ffffff", resolvedValue: "#ffffff", aliasState: null },
    { name: "md.sys.color.primary", setSlug: "light", rawValue: "#6750a4", resolvedValue: "#6750a4", aliasState: null },
    { name: "comp.label", setSlug: "comp", rawValue: "{x}", resolvedValue: { $themes: { light: "#000000", dark: "#ffffff" } }, aliasState: "theme-dependent" },
    { name: "broken", setSlug: "comp", rawValue: "{nope}", resolvedValue: null, aliasState: "unresolved" },
  ];
  it("expands theme-dependent tokens per theme and skips unknown values", () => {
    const e = expandForContrast(cands);
    expect(e.filter((x) => x.name === "comp.label").map((x) => x.theme)).toEqual(["light", "dark"]);
    expect(e.some((x) => x.name === "broken")).toBe(false);
  });
  it("measures manual pairs within shared themes", () => {
    const r = manualContrast(resolveOperand("md.sys.color.on-primary", cands), resolveOperand("md.sys.color.primary", cands));
    expect(r).toHaveLength(1);
    expect(r[0]!.result.ratio).toBeCloseTo(6.44, 1);
    const lit = manualContrast(resolveOperand("comp.label", cands), resolveOperand("#ffffff", cands));
    expect(lit.map((x) => x.theme)).toEqual(["light", "dark"]);
    expect(resolveOperand("broken", cands).kind).toBe("invalid");
    expect(resolveOperand("not a color", cands).kind).toBe("invalid");
  });
});
