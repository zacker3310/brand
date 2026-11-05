import { describe, expect, it } from "vitest";
import { colorLabel, dimensionOf, easingOf, isUnevaluated, motionOf, opacityOf, safeCss, shadowCss, swatchColor, themeLabels, themeValues, typographyFieldOf, typographySpec } from "@/components/tokens/lib/values";

describe("safeCss", () => {
  it("rejects resource loads and declaration breakouts", () => {
    expect(safeCss("url(https://evil.example/x.png)")).toBeNull();
    expect(safeCss("red; background: blue")).toBeNull();
    expect(safeCss("image-set('a.png' 1x)")).toBeNull();
    expect(safeCss("0 1px 2px rgba(0,0,0,.2)")).toBe("0 1px 2px rgba(0,0,0,.2)");
  });
});

describe("colors", () => {
  it("renders DTCG color objects and refuses references", () => {
    expect(swatchColor({ hex: "#1f2328", colorSpace: "hsl", components: [213, 12.7, 13.9] })).toBeTruthy();
    expect(swatchColor("{base.color.neutral.13}")).toBeNull();
    expect(swatchColor(null)).toBeNull();
  });
  it("labels sRGB colors as hex", () => {
    expect(colorLabel("rgb(255, 0, 0)")).toBe("#ff0000");
  });
  it("orders and labels theme-dependent values", () => {
    const tv = themeValues({ $themes: { dark: "#000", light: "#fff" } }, ["light", "dark"]);
    expect(tv.map((v) => v.setSlug)).toEqual(["light", "dark"]);
    const labels = themeLabels(["a", "b", "c"], (k) => ({ a: { name: "Gray 10", theme: "light" }, b: { name: "White", theme: "light" }, c: { name: "G100", theme: "dark" } })[k]);
    expect([...labels.values()]).toEqual(["Gray 10", "White", "Dark"]);
  });
});

describe("typography", () => {
  it("builds a spec from DTCG and kebab-case composites and flags unevaluated fields", () => {
    const s = typographySpec({ fontFamily: ["Mona Sans", "sans-serif"], fontSize: { unit: "rem", value: 1 }, fontWeight: 600, lineHeight: 1.5 })!;
    expect(s).toMatchObject({ fontSize: "1rem", fontSizePx: 16, fontWeight: "600", lineHeight: "1.5" });
    const c = typographySpec({ "font-size": "scale.type-scale(8)", "font-weight": "font-family.font-weight('light')" })!;
    expect(c.unevaluated).toEqual(["font-size", "font-weight"]);
    expect(isUnevaluated("$body-long-02")).toBe(true);
  });
  it("finds the property from the type, the last segment or an ancestor", () => {
    expect(typographyFieldOf("size", null)).toBe("fontSize");
    expect(typographyFieldOf("loose", "number", ["base", "text", "lineHeight", "loose"])).toBe("lineHeight");
    expect(typographyFieldOf("x", "fontWeight")).toBe("fontWeight");
  });
});

describe("motion, dimensions, shadows, opacity", () => {
  it("parses easing and durations", () => {
    expect(easingOf([0.4, 0, 0.2, 1])?.points).toEqual([0.4, 0, 0.2, 1]);
    expect(easingOf("ease-in-out")?.points).toEqual([0.42, 0, 0.58, 1]);
    expect(motionOf("200ms", "duration")).toEqual({ durationMs: 200, easing: null, delayMs: null });
    expect(motionOf({ duration: "240ms", timingFunction: [0.2, 0, 0.38, 0.9] }, "transition")?.durationMs).toBe(240);
  });
  it("converts dimensions and flags assumptions", () => {
    expect(dimensionOf("1.5rem")).toMatchObject({ px: 24, converted: true, unitless: false });
    expect(dimensionOf(5)).toMatchObject({ px: 5, unitless: true });
    expect(dimensionOf("calc(100% - 8px)")).toMatchObject({ px: null });
  });
  it("formats shadows and rejects unevaluated ones", () => {
    expect(shadowCss([{ offsetX: "0px", offsetY: "1px", blur: "2px", spread: "0px", color: "#0000001a" }])).toContain("1px 2px");
    expect(shadowCss("{shadow.small}")).toBeNull();
  });
  it("reads opacity as a ratio", () => {
    expect(opacityOf(0.38)).toBe(0.38);
    expect(opacityOf("16%")).toBe(0.16);
    expect(opacityOf(2)).toBeNull();
  });
});
