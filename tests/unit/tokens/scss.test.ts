import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseScssVariables, flattenScssVariables, findScssReferences, scssReferenceKey } from "@/lib/tokens/scss";

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, "fixtures", f), "utf8");

describe("parseScssVariables — Carbon themes excerpt", () => {
  const res = parseScssVariables(fx("carbon-themes-excerpt.scss"));

  it("records @use statements with namespaces", () => {
    expect(res.uses.map((u) => [u.path, u.namespace])).toEqual([
      ["sass:map", "map"],
      ["sass:string", "string"],
      ["@carbon/layout", "layout"],
      ["@carbon/type", "type"],
      ["../utilities", "utilities"],
    ]);
  });

  it("parses theme maps with !default", () => {
    const white = res.variables.find((v) => v.name === "white" && v.isMap)!;
    expect(white.flags.default).toBe(true);
    expect(white.line).toBe(16);
    expect(white.value.kind).toBe("map");
    if (white.value.kind !== "map") throw new Error("expected map");
    expect(white.value.entries.map((e) => e.key)).toEqual([
      "ai-aura-end",
      "ai-aura-hover-background",
      "background",
      "background-active",
      "background-brand",
      "border-subtle-00",
      "text-primary",
      "text-secondary",
      "color-scheme",
    ]);
    expect(white.value.entries[0]).toMatchObject({ value: { kind: "scalar", raw: "rgba(255, 255, 255, 0)" }, line: 17 });
  });

  it("keeps unevaluated function reassignments as scalars with references", () => {
    const merged = res.variables.filter((v) => v.name === "white");
    expect(merged).toHaveLength(2);
    const m = merged[1]!;
    expect(m.isMap).toBe(false);
    expect(m.rawValue).toBe("utilities.merge( $white, layout.$spacing, layout.$fluid-spacing, type.$tokens )");
    expect(m.references.map((r) => [r.namespace, r.name])).toEqual([
      [null, "white"],
      ["layout", "spacing"],
      ["layout", "fluid-spacing"],
      ["type", "tokens"],
    ]);
  });

  it("flattens maps into dotted entries keeping per-key lines", () => {
    const flat = flattenScssVariables(res);
    const bg = flat.find((e) => e.name === "white.background")!;
    expect(bg).toMatchObject({ rawValue: "#ffffff", path: ["white", "background"], line: 19, variable: "white" });
    const btn = flat.filter((e) => e.variable === "button-danger-secondary");
    expect(btn.map((e) => [e.path[1], e.rawValue])).toEqual([
      ["white-theme", "#da1e28"],
      ["g-10", "#da1e28"],
      ["g-90", "#ff8389"],
      ["g-100", "#fa4d56"],
    ]);
    expect(flat.find((e) => e.name === "white.color-scheme")!.rawValue).toBe("string.unquote('light')");
  });
});

describe("parseScssVariables — Material Web (latest sass_vars)", () => {
  const res = parseScssVariables(fx("material-sys-latest-excerpt.scss"));

  it("parses namespaced references and doc comments", () => {
    const bg = res.variables.find((v) => v.name === "background")!;
    expect(bg.rawValue).toBe("md-ref-palette.$neutral98");
    expect(bg.references).toEqual([{ raw: "md-ref-palette.$neutral98", kind: "variable", name: "neutral98", namespace: "md-ref-palette" }]);
    expect(bg.doc!.split("\n")[0]).toBe("md.sys.color.background (Add-ons / Add-on surface colors)");
    expect(scssReferenceKey(bg.references[0]!)).toBe("md-ref-palette.neutral98");
  });

  it("detects @deprecated in doc comments", () => {
    const h = res.variables.find((v) => v.name === "container-height")!;
    expect(h).toMatchObject({ rawValue: "56px", deprecated: true });
    expect(res.variables.find((v) => v.name === "container-elevation")!.deprecated).toBe(false);
  });

  it("does not attach a doc comment across a blank line", () => {
    const onError = res.variables.find((v) => v.name === "on-error")!;
    expect(onError.doc).toBe("md.sys.color.on-error (Error colors)");
  });

  it("keeps multi-value scalars", () => {
    expect(res.variables.find((v) => v.name === "corner-extra-large-top")!.rawValue).toBe("28px 28px 0px 0px");
  });
});

describe("parseScssVariables — Material Web v0_192 function-return maps", () => {
  const res = parseScssVariables(fx("material-sys-v0_192-excerpt.scss"));

  it("emits @function @return maps with context and map.get references", () => {
    const fn = res.variables.find((v) => v.context === "@function values-dark")!;
    expect(fn.name).toBe("values-dark");
    expect(fn.isMap).toBe(true);
    const flat = flattenScssVariables(res).filter((e) => e.variable === "values-dark");
    expect(flat.map((e) => e.name)).toEqual(["values-dark.background", "values-dark.error", "values-dark.on-primary", "values-dark.shadow"]);
    const r = flat[0]!.references[0]!;
    expect(r).toMatchObject({ kind: "map-get", name: "deps", keys: ["md-ref-palette", "neutral6"] });
    expect(scssReferenceKey(r)).toBe("md-ref-palette.neutral6");
  });

  it("parses lists (with line comments inside) and private maps", () => {
    const list = res.variables.find((v) => v.name === "supported-tokens")!;
    expect(list.value.kind).toBe("list");
    if (list.value.kind !== "list") throw new Error("expected list");
    expect(list.value.items.map((i) => (i.kind === "scalar" ? i.raw : "?"))).toEqual(["'background'", "'error'"]);
    const priv = res.variables.find((v) => v.name === "_default-dark")!;
    expect(priv.private).toBe(true);
    expect(parseScssVariables(fx("material-sys-v0_192-excerpt.scss"), { includePrivate: false }).variables.some((v) => v.private)).toBe(false);
  });

  it("skips variables inside selectors and mixins (reported, not guessed)", () => {
    expect(res.variables.some((v) => v.name === "local" || v.name === "resolved")).toBe(false);
    expect(res.skipped.map((s) => s.reason)).toEqual(["selector-block", "@mixin-block"]);
  });
});

describe("parseScssVariables — edge cases", () => {
  it("handles strings with semicolons, URLs, interpolation and nested maps", () => {
    const res = parseScssVariables(`
$font: "Helvetica; Neue", sans-serif;
$url: url(https://example.com/a.png);
$sel: #{$prefix}-button;
$nested: (
  layer: (
    01: #f4f4f4,
    'two': $base,
  ),
  plain: 1px,
);
$global: red !global;
`);
    const byName = Object.fromEntries(res.variables.map((v) => [v.name, v]));
    expect(byName.font!.rawValue).toBe('"Helvetica; Neue", sans-serif');
    expect(byName.url!.rawValue).toBe("url(https://example.com/a.png)");
    expect(byName.sel!.references.map((r) => r.name)).toEqual(["prefix"]);
    expect(byName.global!.flags).toEqual({ default: false, global: true });
    const flat = flattenScssVariables(res).filter((e) => e.variable === "nested");
    expect(flat.map((e) => [e.name, e.rawValue])).toEqual([
      ["nested.layer.01", "#f4f4f4"],
      ["nested.layer.two", "$base"],
      ["nested.plain", "1px"],
    ]);
  });

  it("findScssReferences ignores $ inside quotes and handles map-get()", () => {
    expect(findScssReferences("'$not-a-var' $real").map((r) => r.name)).toEqual(["real"]);
    expect(findScssReferences("map-get($theme, primary)")[0]).toMatchObject({ kind: "map-get", name: "theme", keys: ["primary"] });
    expect(scssReferenceKey(findScssReferences("map-get($theme, primary)")[0]!)).toBe("theme.primary");
  });

  it("never throws on malformed input", () => {
    for (const b of ["$a: (", "$a: (b: c", "@function f() { @return (", "$: 1;", "}}}}", "/* unterminated", ""]) {
      expect(() => parseScssVariables(b)).not.toThrow();
    }
    expect(parseScssVariables(undefined as unknown as string).variables).toEqual([]);
  });
});
