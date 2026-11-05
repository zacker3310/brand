import { describe, expect, it } from "vitest";
import { parseColor, isColorValue, toHex, toOklch, toOklchString, relativeLuminance, contrastRatio, checkContrast, inSrgbGamut, colorValueKind, toCssColor } from "@/lib/tokens/color";
import { formatTokenValue, dimensionToPx, durationToMs, parseDimension, formatNumber } from "@/lib/tokens/format";
import { validateTokenValue, fontWeightToNumber } from "@/lib/tokens/validate";

describe("color", () => {
  it("parses CSS colors and DTCG color objects", () => {
    expect(parseColor("  #FFF ")).toMatchObject({ mode: "rgb", r: 1, g: 1, b: 1 });
    expect(parseColor({ colorSpace: "srgb", components: [1, 0, 0] })).toMatchObject({ mode: "rgb", r: 1 });
    expect(parseColor({ colorSpace: "hsl", components: [120, 100, 50] })).toMatchObject({ mode: "hsl", s: 1, l: 0.5 });
    expect(parseColor({ colorSpace: "display-p3", components: [1, 0, 0] })!.mode).toBe("p3");
    expect(parseColor({ colorSpace: "oklch", components: [0.6, 0.1, "none"] })).toMatchObject({ mode: "oklch", h: 0 });
    expect(parseColor({ colorSpace: "unknown-space", components: [1, 2, 3], hex: "#123456" })).toMatchObject({ mode: "rgb" });
    expect(parseColor("#ggg")).toBeNull();
    expect(parseColor(42)).toBeNull();
    expect(parseColor({ colorSpace: "srgb", components: [1, "x", 0] })).toBeNull();
  });

  it("isColorValue accepts non-concrete CSS colors unless told otherwise", () => {
    expect(isColorValue("currentColor")).toBe(true);
    expect(isColorValue("CanvasText")).toBe(true);
    expect(isColorValue("color-mix(in srgb, red 50%, blue)")).toBe(true);
    expect(isColorValue("rgb(from var(--x) r g b / 50%)")).toBe(true);
    expect(isColorValue("currentColor", { allowNonConcrete: false })).toBe(false);
    expect(isColorValue("16px")).toBe(false);
    expect(colorValueKind("light-dark(#fff, #000)")).toBe("unevaluated");
    expect(colorValueKind("inherit")).toBe("keyword");
  });

  it("converts to hex (8-digit when translucent) and oklch", () => {
    expect(toHex("rgb(255 0 0)")).toBe("#ff0000");
    expect(toHex("rgba(0, 0, 0, 0.5)")).toBe("#00000080");
    expect(toHex({ colorSpace: "srgb", components: [0, 0, 0], alpha: 0.2 })).toBe("#00000033");
    expect(toHex("transparent")).toBe("#00000000");
    expect(toHex("not a color")).toBeNull();
    const o = toOklch("#ff0000")!;
    expect(o.l).toBeCloseTo(0.628, 3);
    expect(o.c).toBeCloseTo(0.2577, 3);
    expect(o.h).toBeCloseTo(29.23, 1);
    expect(toOklch("#808080")!.h).toBeNull(); // achromatic
    expect(toOklchString("#ff0000")).toBe("oklch(62.8% 0.258 29.23)");
    expect(toOklchString("#ff000080")).toMatch(/\/ 0\.502\)$/);
  });

  it("flags out-of-gamut colors and serializes wide-gamut DTCG colors", () => {
    expect(inSrgbGamut("#ff0000")).toBe(true);
    expect(inSrgbGamut("color(display-p3 1 0 0)")).toBe(false);
    expect(inSrgbGamut("nope")).toBeNull();
    expect(toCssColor({ colorSpace: "display-p3", components: [1, 0, 0] })).toBe("color(display-p3 1 0 0)");
  });

  it("computes WCAG 2.x luminance and contrast", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 6);
    expect(relativeLuminance("#000")).toBe(0);
    expect(contrastRatio("#000", "#fff")).toBe(21);
    expect(contrastRatio("#777777", "#ffffff")).toBe(4.48);
    expect(contrastRatio("x", "#fff")).toBeNull();
    // Known pair from Primer light: fgColor.default on bgColor.default
    const c = checkContrast("#1f2328", "#ffffff")!;
    expect(c.ratio).toBeGreaterThan(15);
    expect(c.aaa.normal).toBe(true);
  });

  it("applies AA/AAA thresholds at the boundaries (no rounding up)", () => {
    const c = checkContrast("#777777", "#ffffff")!; // 4.478:1
    expect(c.aa).toEqual({ normal: false, large: true });
    expect(c.aaa).toEqual({ normal: false, large: false });
    const d = checkContrast("#767676", "#ffffff")!; // 4.54:1
    expect(d.aa.normal).toBe(true);
    expect(d.aaa.large).toBe(true);
    expect(d.nonText).toBe(true);
  });

  it("composites translucent colors and flags the assumption", () => {
    const c = checkContrast("rgba(0,0,0,0.5)", "#ffffff")!;
    expect(c.fgComposited).toBe(true);
    expect(c.ratio).toBeCloseTo(contrastRatio("#808080", "#fff")!, 1);
    const d = checkContrast("#000", "rgba(255,255,255,0.5)", { backdrop: "#000" })!;
    expect(d.bgComposited).toBe(true);
    expect(d.backdrop).toBe("#000000");
  });
});

describe("formatTokenValue", () => {
  it("colors", () => {
    expect(formatTokenValue("#0969DA", "color")).toBe("#0969DA");
    expect(formatTokenValue("#0969DA", "color", { colorFormat: "hex" })).toBe("#0969da");
    expect(formatTokenValue({ colorSpace: "srgb", components: [1, 1, 1], hex: "#ffffff" }, "color")).toBe("#ffffff");
    expect(formatTokenValue({ colorSpace: "srgb", components: [0, 0, 0], alpha: 0.2, hex: "#000000" }, "color")).toBe("#00000033");
    expect(formatTokenValue({ colorSpace: "oklch", components: [0.62, 0.19, 255] }, "color")).toBe("oklch(0.62 0.19 255)");
    expect(formatTokenValue({ colorSpace: "srgb", components: [1, 0, 0] })).toBe("#ff0000");
  });

  it("dimensions, durations, numbers", () => {
    expect(formatTokenValue({ value: 16, unit: "px" }, "dimension")).toBe("16px");
    expect(formatTokenValue({ value: 0.30000000000000004, unit: "rem" }, "dimension")).toBe("0.3rem");
    expect(formatTokenValue("1.5rem", "dimension")).toBe("1.5rem");
    expect(formatTokenValue({ value: 120, unit: "ms" }, "duration")).toBe("120ms");
    expect(formatTokenValue(1.5, "number")).toBe("1.5");
    expect(formatTokenValue(700, "fontWeight")).toBe("700");
    expect(formatNumber(1 / 3)).toBe("0.3333333333");
  });

  it("cubicBezier, fontFamily", () => {
    expect(formatTokenValue([0.2, 0, 0, 1], "cubicBezier")).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(formatTokenValue([0.4, 0, 0.2, 1])).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
    expect(formatTokenValue(["Inter", "Helvetica Neue", "sans-serif"], "fontFamily")).toBe('Inter, "Helvetica Neue", sans-serif');
    expect(formatTokenValue("'Roboto', sans-serif", "fontFamily")).toBe("'Roboto', sans-serif");
  });

  it("shadows (single, layered, inset, legacy x/y)", () => {
    const layer = { color: "#00000033", offsetX: { value: 0, unit: "px" }, offsetY: { value: 1, unit: "px" }, blur: { value: 2, unit: "px" }, spread: { value: 0, unit: "px" } };
    expect(formatTokenValue(layer, "shadow")).toBe("0px 1px 2px 0px #00000033");
    expect(formatTokenValue([layer, { ...layer, inset: true }], "shadow")).toBe("0px 1px 2px 0px #00000033, inset 0px 1px 2px 0px #00000033");
    expect(formatTokenValue({ x: "0", y: "4", blur: "8", spread: "0", color: "#000", type: "innerShadow" }, "boxShadow")).toBe("inset 0 4 8 0 #000");
    expect(formatTokenValue({ offsetX: "1px", offsetY: "2px", color: { colorSpace: "srgb", components: [0, 0, 0], hex: "#000000" } })).toBe("1px 2px 0 0 #000000");
  });

  it("typography, border, transition, gradient, strokeStyle", () => {
    expect(formatTokenValue({ fontFamily: ["Inter", "sans-serif"], fontSize: { value: 16, unit: "px" }, fontWeight: 600, lineHeight: 1.5, letterSpacing: { value: 0.5, unit: "px" } }, "typography")).toBe(
      "600 16px/1.5 Inter, sans-serif; letter-spacing 0.5px",
    );
    expect(formatTokenValue({ fontFamily: "Roboto", fontSize: "14px", fontWeight: 400, textCase: "uppercase", fontStyle: "italic" })).toBe("italic 400 14px Roboto; text-transform uppercase");
    expect(formatTokenValue({ color: "#d0d7de", width: { value: 1, unit: "px" }, style: "solid" }, "border")).toBe("1px solid #d0d7de");
    expect(formatTokenValue({ color: "#000", width: "2px", style: { dashArray: ["4px", "2px"], lineCap: "round" } }, "border")).toBe("2px dashed (4px 2px, round) #000");
    expect(formatTokenValue({ duration: { value: 200, unit: "ms" }, delay: { value: 0, unit: "ms" }, timingFunction: [0.5, 0, 1, 1] }, "transition")).toBe("200ms cubic-bezier(0.5, 0, 1, 1) 0ms");
    expect(formatTokenValue([{ color: "#ff0000", position: 0 }, { color: "#0000ff", position: 1 }], "gradient")).toBe("#ff0000 0%, #0000ff 100%");
    expect(formatTokenValue("dashed", "strokeStyle")).toBe("dashed");
  });

  it("references, unknown objects, null, truncation", () => {
    expect(formatTokenValue("{color.blue.500}", "color")).toBe("{color.blue.500}");
    expect(formatTokenValue({ foo: 1 })).toBe('{"foo":1}');
    expect(formatTokenValue(null)).toBeNull();
    expect(formatTokenValue(undefined, "color")).toBeNull();
    expect(formatTokenValue("x".repeat(500), null, { maxLength: 20 })).toHaveLength(20);
    expect(formatTokenValue(true)).toBe("true");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => formatTokenValue(circular)).not.toThrow();
  });
});

describe("units", () => {
  it("dimensionToPx", () => {
    expect(dimensionToPx("16px")).toBe(16);
    expect(dimensionToPx("1.5rem")).toBe(24);
    expect(dimensionToPx("1rem", { remBase: 10 })).toBe(10);
    expect(dimensionToPx({ value: 2, unit: "rem" })).toBe(32);
    expect(dimensionToPx("12pt")).toBe(16);
    expect(dimensionToPx("-4px")).toBe(-4);
    expect(dimensionToPx("0")).toBe(0);
    expect(dimensionToPx(8)).toBe(8);
    expect(dimensionToPx(8, { unitless: "null" })).toBeNull();
    expect(dimensionToPx("50%")).toBeNull();
    expect(dimensionToPx("100vw")).toBeNull();
    expect(dimensionToPx("calc(1px + 2px)")).toBeNull();
    expect(dimensionToPx("4px 8px")).toBeNull();
  });

  it("parseDimension / durationToMs", () => {
    expect(parseDimension(".5EM")).toEqual({ value: 0.5, unit: "em" });
    expect(parseDimension("1e2px")).toEqual({ value: 100, unit: "px" });
    expect(parseDimension("px")).toBeNull();
    expect(durationToMs("0.2s")).toBe(200);
    expect(durationToMs({ value: 150, unit: "ms" })).toBe(150);
    expect(durationToMs("1px")).toBeNull();
  });
});

describe("validateTokenValue", () => {
  const v = validateTokenValue;
  it("colors", () => {
    expect(v("color", "#0969da")).toEqual({ ok: true });
    expect(v("color", "#ggg")).toMatchObject({ ok: false, code: "INVALID_COLOR" });
    expect(v("color", "currentColor")).toMatchObject({ ok: true, code: "NON_CONCRETE" });
    expect(v("color", "color-mix(in srgb, red, blue)")).toMatchObject({ ok: true, code: "UNEVALUATED" });
    expect(v("color", { colorSpace: "srgb", components: [1, 0, 0] })).toEqual({ ok: true });
    expect(v("color", { colorSpace: "srgb", components: [1, 0] })).toMatchObject({ ok: false });
    expect(v("color", { colorSpace: "srgb", components: [1, 0, 0], alpha: 2 })).toMatchObject({ ok: false });
    expect(v("color", 12)).toMatchObject({ ok: false, code: "INVALID_COLOR" });
  });

  it("references are never invalid", () => {
    expect(v("color", "{color.missing}")).toMatchObject({ ok: true, code: "REFERENCE" });
    expect(v("dimension", "var(--x)")).toMatchObject({ ok: true, code: "REFERENCE" });
    expect(v("dimension", "{size.1} {size.2}")).toMatchObject({ ok: true, code: "REFERENCE" });
    expect(v("shadow", { offsetX: "{size.1}", offsetY: "1px", color: "{color.x}" })).toEqual({ ok: true });
    expect(v("color", { $ref: "#/color/blue" })).toMatchObject({ ok: true, code: "REFERENCE" });
  });

  it("dimensions", () => {
    expect(v("dimension", "16px")).toEqual({ ok: true });
    expect(v("dimension", { value: 16, unit: "px" })).toEqual({ ok: true });
    expect(v("dimension", { value: 1, unit: "em" })).toMatchObject({ ok: true, code: "NON_STANDARD_UNIT" });
    expect(v("dimension", { value: "16", unit: "px" })).toMatchObject({ ok: false, code: "INVALID_DIMENSION" });
    expect(v("dimension", { value: 1, unit: "parsecs" })).toMatchObject({ ok: false, code: "INVALID_UNIT" });
    expect(v("dimension", "12pxx")).toMatchObject({ ok: false, code: "INVALID_UNIT" });
    expect(v("dimension", "abc")).toMatchObject({ ok: false, code: "INVALID_DIMENSION" });
    expect(v("dimension", "calc(100% - 8px)")).toMatchObject({ ok: true, code: "UNEVALUATED" });
    expect(v("dimension", 4)).toMatchObject({ ok: true, code: "UNITLESS" });
    expect(v("dimension", "0")).toEqual({ ok: true });
    expect(v("borderRadius", "4px 4px 0px 0px")).toEqual({ ok: true });
    expect(v("spacing", "1rem")).toEqual({ ok: true });
  });

  it("durations and cubicBezier", () => {
    expect(v("duration", "200ms")).toEqual({ ok: true });
    expect(v("duration", { value: 0.2, unit: "s" })).toEqual({ ok: true });
    expect(v("duration", "200px")).toMatchObject({ ok: false, code: "INVALID_UNIT" });
    expect(v("duration", "-1s")).toMatchObject({ ok: false, code: "INVALID_DURATION" });
    expect(v("cubicBezier", [0.4, 0, 0.2, 1])).toEqual({ ok: true });
    expect(v("cubicBezier", [0.4, -2, 0.2, 3])).toEqual({ ok: true }); // y may overshoot
    expect(v("cubicBezier", [1.2, 0, 0.2, 1])).toMatchObject({ ok: false, code: "INVALID_CUBIC_BEZIER" });
    expect(v("cubicBezier", [0.4, 0, 0.2])).toMatchObject({ ok: false });
    expect(v("cubicBezier", "cubic-bezier(0.2, 0, 0, 1)")).toEqual({ ok: true });
    expect(v("cubicBezier", "cubic-bezier(0.2, 0, 1.5, 1)")).toMatchObject({ ok: false });
    expect(v("cubicBezier", "ease-in-out")).toEqual({ ok: true });
  });

  it("fontWeight and fontFamily", () => {
    expect(v("fontWeight", 600)).toEqual({ ok: true });
    expect(v("fontWeight", 0)).toMatchObject({ ok: false });
    expect(v("fontWeight", 1001)).toMatchObject({ ok: false });
    expect(v("fontWeight", "semi-bold")).toEqual({ ok: true });
    expect(v("fontWeight", "SemiBold")).toEqual({ ok: true });
    expect(v("fontWeight", "Bold Italic")).toEqual({ ok: true });
    expect(v("fontWeight", "heavyish")).toMatchObject({ ok: false, code: "INVALID_FONT_WEIGHT" });
    expect(v("fontFamily", ["Inter", "sans-serif"])).toEqual({ ok: true });
    expect(v("fontFamily", [])).toMatchObject({ ok: false });
    expect(fontWeightToNumber("extra-bold")).toBe(800);
    expect(fontWeightToNumber("SemiBold")).toBe(600);
    expect(fontWeightToNumber("bolder")).toBeNull();
  });

  it("composites", () => {
    const layer = { color: "#00000033", offsetX: { value: 0, unit: "px" }, offsetY: { value: 1, unit: "px" }, blur: { value: 2, unit: "px" }, spread: { value: 0, unit: "px" } };
    expect(v("shadow", layer)).toEqual({ ok: true });
    expect(v("shadow", [layer, { ...layer, inset: true }])).toEqual({ ok: true });
    expect(v("shadow", { color: "#000", blur: "2px" })).toMatchObject({ ok: false, code: "INVALID_SHADOW" });
    expect(v("shadow", [layer, { ...layer, color: "#zz" }])).toMatchObject({ ok: false, code: "INVALID_SHADOW" });
    expect(v("shadow", "0 1px 2px rgba(0,0,0,.2), inset 0 0 0 1px #000")).toEqual({ ok: true });
    expect(v("shadow", "none")).toEqual({ ok: true });
    expect(v("shadow", "big")).toMatchObject({ ok: false });
    expect(v("typography", { fontFamily: "Inter", fontSize: "16px", fontWeight: 400, lineHeight: 1.5 })).toEqual({ ok: true });
    expect(v("typography", { fontFamily: "Inter", fontWeight: 5000 })).toMatchObject({ ok: false, code: "INVALID_TYPOGRAPHY" });
    expect(v("typography", { foo: 1 })).toMatchObject({ ok: false });
    expect(v("border", { color: "#000", width: "1px", style: "solid" })).toEqual({ ok: true });
    expect(v("border", { color: "#000", width: "1px", style: "wobbly" })).toMatchObject({ ok: false });
    expect(v("transition", { duration: "200ms", timingFunction: [0.5, 0, 1, 1], delay: "0ms" })).toEqual({ ok: true });
    expect(v("gradient", [{ color: "#fff", position: 0 }, { color: "#000", position: 1 }])).toEqual({ ok: true });
    expect(v("gradient", [{ color: "#fff", position: 2 }])).toMatchObject({ ok: false });
    expect(v("strokeStyle", { dashArray: ["4px", "2px"], lineCap: "round" })).toEqual({ ok: true });
  });

  it("opacity, number, lineHeight, unknown types, categories, empty values", () => {
    expect(v("opacity", 0.5)).toEqual({ ok: true });
    expect(v("opacity", "50%")).toEqual({ ok: true });
    expect(v("opacity", 1.5)).toMatchObject({ ok: false, code: "INVALID_OPACITY" });
    expect(v("number", "1.25")).toEqual({ ok: true });
    expect(v("number", "x")).toMatchObject({ ok: false });
    expect(v("lineHeight", 1.5)).toEqual({ ok: true });
    expect(v("lineHeight", "24px")).toEqual({ ok: true });
    expect(v("asset", "x.svg")).toMatchObject({ ok: true, code: "UNCHECKED" });
    expect(v(null, "anything")).toMatchObject({ ok: true, code: "UNCHECKED" });
    expect(v("spacing", "1rem")).toEqual({ ok: true });
    expect(v("typography", "16px/1.5 Inter")).toMatchObject({ ok: true, code: "UNCHECKED" });
    expect(v("color", "")).toMatchObject({ ok: false, code: "EMPTY_VALUE" });
    expect(v("color", null)).toMatchObject({ ok: false, code: "EMPTY_VALUE" });
    expect(v("elevation", { a: 1 })).toMatchObject({ ok: true, code: "UNCHECKED" });
  });
});

describe("alpha-modifier colors ({ value, alpha }, as emitted by the Primer adapter)", () => {
  it("parses, formats, validates and categorizes", async () => {
    const { resolveTokenGraph } = await import("@/lib/tokens/resolve");
    const { categorizeToken } = await import("@/lib/tokens/categorize");
    const r = resolveTokenGraph([
      { name: "base.color.blue.5", rawValue: "#0969da", references: [] },
      { name: "bgColor.accent.muted", rawValue: { value: "{base.color.blue.5}", alpha: 0.4 }, references: ["base.color.blue.5"] },
      { name: "shadow.inset", rawValue: "inset 0 0 0 1px {bgColor.accent.muted}", references: [] },
    ]);
    const muted = r.get("bgColor.accent.muted")!;
    expect(muted).toMatchObject({ state: "resolved", resolvedValue: { value: "#0969da", alpha: 0.4 } });
    expect(r.get("shadow.inset")!.resolvedValue).toBe("inset 0 0 0 1px #0969da66");
    expect(toHex(muted.resolvedValue)).toBe("#0969da66");
    expect(formatTokenValue(muted.resolvedValue, "color")).toBe("#0969da66");
    expect(formatTokenValue(muted.resolvedValue)).toBe("#0969da66");
    expect(validateTokenValue("color", muted.resolvedValue)).toEqual({ ok: true });
    expect(validateTokenValue("color", { value: "{base.color.blue.5}", alpha: 0.4 })).toMatchObject({ ok: true, code: "REFERENCE" });
    expect(validateTokenValue("color", { value: "#0969da", alpha: 4 })).toMatchObject({ ok: false, code: "INVALID_COLOR" });
    expect(validateTokenValue("color", { value: "nope", alpha: 0.5 })).toMatchObject({ ok: false, code: "INVALID_COLOR" });
    expect(categorizeToken("x", null, { value: "#fff", alpha: 0.5 }).category).toBe("color");
    expect(checkContrast({ value: "#000", alpha: 0.5 }, "#fff")!.fgComposited).toBe(true);
  });
});
