/**
 * Regression tests for claims refuted by the deep-2 data-integrity audit (docs/audit/deep-2.md).
 * Each case reproduces a published claim that did not match the live official source; inputs are
 * short excerpts of the real sources (Apache-2.0 / MIT). No network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { a11yUsageBlocks } from "@/ingestion/adapters/mui/normalize-base";
import { parseBaseTypes } from "@/ingestion/adapters/mui/baseui";
import { parseMuiMarkdown } from "@/ingestion/adapters/mui/markdown";
import { literalUnion, topLevelUnion } from "@/ingestion/adapters/mui/shared";
import { mobileCssVarOwner } from "@/ingestion/adapters/antd/normalize";
import { unextractedStateProps, type DocProp } from "@/ingestion/adapters/antd/props";
import type { SpectrumFragment } from "@/ingestion/adapters/spectrum/fragments";
import { normalizeDesign } from "@/ingestion/adapters/spectrum/normalize-design";
import { compactPage, normalizeReact } from "@/ingestion/adapters/spectrum/normalize-react";
import { inlineAlerts, parseDocsMd } from "@/ingestion/adapters/spectrum/docs-md";
import { parseComponentSchema } from "@/ingestion/adapters/spectrum/schema";
import type { Ev } from "@/ingestion/adapters/spectrum/shared";
import { parseA11yFragment, parseSitePage, templatedA11yFragments, type A11yFragment } from "@/ingestion/adapters/spectrum/site";
import { parseTokenFile } from "@/ingestion/adapters/spectrum/tokens";

const SPECTRUM_FX = path.resolve(import.meta.dirname, "../../fixtures/adapters/spectrum");
const sfx = (f: string) => readFileSync(path.join(SPECTRUM_FX, f), "utf8");
const ev = (sourceUrl: string, location: string): Ev => ({ sourceUrl, retrievedAt: "2026-11-05T00:00:00.000Z", contentHash: "abc", location });

describe("spectrum: templated accessibility fragments", () => {
  // spectrum.adobe.com serves Button's tables byte for byte as the accessibility fragment of Meter,
  // Help text, Search field, Progress bar (...): "Tab: Moves focus onto or off of the button."
  const button = parseA11yFragment(sfx("site-button-accessibility.plain.html"));
  const tooltipLike: A11yFragment = {
    keyboard: [
      { keys: "Tab", action: "Tabbing into an item that has a tooltip associated with it (e.g., an icon) shows the tooltip." },
      { keys: "Esc", action: "Hides the tooltip." },
    ],
    keyboardSection: true,
    wcag: [],
    sections: ["Keyboard interactions"],
    links: [],
  };
  const own: A11yFragment = { keyboard: [{ keys: "Arrow keys", action: "Moves the thumb." }], keyboardSection: true, wcag: [], sections: [], links: [] };

  it("maps verbatim copies to the component the copied text is about", () => {
    const m = templatedA11yFragments([
      { slug: "button", a11y: button },
      { slug: "meter", a11y: button },
      { slug: "help-text", a11y: button },
      { slug: "table", a11y: tooltipLike },
      { slug: "tooltip", a11y: tooltipLike },
      { slug: "slider", a11y: own },
    ]);
    expect([...m.entries()].sort()).toEqual([
      ["help-text", "button"],
      ["meter", "button"],
      ["table", "tooltip"],
    ]);
  });

  it("leaves shared fragments alone when no single member owns the text", () => {
    const shared: A11yFragment = { keyboard: [{ keys: "Space", action: "Toggles the selection." }], keyboardSection: true, wcag: [], sections: [], links: [] };
    expect(templatedA11yFragments([{ slug: "checkbox", a11y: shared }, { slug: "switch", a11y: shared }]).size).toBe(0);
  });

  it("does not publish Button's keyboard table as Meter's; token evidence names the file that holds the tokens", () => {
    const file = (n: string) => `src/${n}.json`;
    const tok = (n: string) => ({ t: "tokens" as const, file: file(n), tokens: parseTokenFile(sfx(`tokens-${n}.json`), file(n)).tokens, ev: ev(`https://cdn.jsdelivr.net/npm/@adobe/spectrum-tokens@15.6.0/${file(n)}`, file(n)) });
    const schema = (name: string, displayName: string) => ({ t: "schema" as const, name, schema: parseComponentSchema(JSON.stringify({ name, displayName, options: {} }))!, ev: ev(`https://cdn.jsdelivr.net/npm/@adobe/spectrum-design-data@3.8.2/components/${name}.json`, `components/${name}.json`) });
    const a11yFrag = (slug: string): SpectrumFragment => ({ t: "site-fragment", slug, section: "accessibility", states: null, a11y: button, links: [], ev: ev(`https://spectrum.adobe.com/web/rsp/components/${slug}`, `/fragments/components/${slug}/accessibility.plain.html`) });
    const frs: SpectrumFragment[] = [schema("button", "Button"), schema("meter", "Meter"), a11yFrag("button"), a11yFrag("meter"), tok("accordion"), tok("button")];
    const { templatedA11y, components } = normalizeDesign(frs.map((data) => ({ data })));
    expect([...templatedA11y]).toEqual([["meter", "button"]]);
    const b = components.find((c) => c.slug === "button")!;
    const meter = components.find((c) => c.slug === "meter")!;
    expect(b.accessibility?.keyboard?.[0]).toMatchObject({ keys: "Tab", action: "Moves focus onto or off of the button." });
    expect(meter.accessibility?.keyboard ?? null).toBeNull();
    expect(meter.coverage.keyboard).toBe("not-extracted");
    expect(meter.evidence.some((e) => e.field === "keyboard")).toBe(false);
    // Before the fix every component's "tokens" evidence pointed at the first file of the package (accordion.json).
    const tokenEv = b.evidence.filter((e) => e.field === "tokens" && e.extractionMethod === "adapter:spectrum:tokens-json");
    expect(tokenEv.map((e) => e.sourceUrl)).toEqual(["https://cdn.jsdelivr.net/npm/@adobe/spectrum-tokens@15.6.0/src/button.json"]);
  });
});

describe("react-spectrum: templated site accessibility fragments", () => {
  it("does not publish Button's keyboard table on Meter's React Spectrum page", () => {
    const origin = "https://react-spectrum.adobe.com";
    const site = "https://spectrum.adobe.com";
    const page = parseSitePage(sfx("site-button-rsp.plain.html"));
    const a11y = parseA11yFragment(sfx("site-button-accessibility.plain.html"));
    const meterMd = ["# Meter", "", "Meters are visual representations of a quantity or an achievement.", "", "## API", "", "### Meter", "", "| Name | Type | Default | Description |", "|------|------|---------|-------------|", "| `value` | `number | undefined` | — | The current value. |", ""].join("\n");
    const frs: SpectrumFragment[] = [
      { t: "md", page: "Button", md: compactPage(parseDocsMd(sfx("rsp-Button.md"))), docsUrl: `${origin}/Button`, ev: ev(`${origin}/Button`, "Button.md") },
      { t: "md", page: "Meter", md: compactPage(parseDocsMd(meterMd)), docsUrl: `${origin}/Meter`, ev: ev(`${origin}/Meter`, "Meter.md") },
      { t: "site-page", slug: "button", impl: "rsp", path: "/web/rsp/components/button", page, data: null, dataEv: null, ev: ev(`${site}/web/rsp/components/button`, "/web/rsp/components/button.plain.html") },
      { t: "site-page", slug: "meter", impl: "rsp", path: "/web/rsp/components/meter", page: { ...page, dataPath: "/deps/rsp/data/Meter.json", dataName: "Meter" }, data: null, dataEv: null, ev: ev(`${site}/web/rsp/components/meter`, "/web/rsp/components/meter.plain.html") },
      { t: "site-fragment", slug: "button", section: "accessibility", states: null, a11y, links: [], ev: ev(`${site}/web/rsp/components/button`, "/fragments/components/button/accessibility.plain.html") },
      { t: "site-fragment", slug: "meter", section: "accessibility", states: null, a11y, links: [], ev: ev(`${site}/web/rsp/components/meter`, "/fragments/components/meter/accessibility.plain.html") },
    ];
    const bundle = normalizeReact("react-spectrum", frs.map((data) => ({ data })));
    const button = bundle.components.find((c) => c.slug === "button")!;
    const meter = bundle.components.find((c) => c.slug === "meter")!;
    expect(button.accessibility?.keyboard?.[0]?.keys).toBe("Tab");
    // Published before the fix: Meter keyboard = "Tab: Moves focus onto or off of the button."
    expect(meter.accessibility).toBeNull();
    expect(meter.coverage.keyboard).toBe("not-extracted");
    expect(meter.coverage.accessibility).toBe("not-extracted");
  });
});

describe("mui: allowed values come from top-level literal alternatives only", () => {
  it("splits unions outside object shapes, generics, tuples and function signatures", () => {
    expect(topLevelUnion("'a' | { b: 'c' | 'd' } | Array<'e' | 'f'> | ((x: 'g' | 'h') => void)")).toEqual(["'a'", "{ b: 'c' | 'd' }", "Array<'e' | 'f'>", "((x: 'g' | 'h') => void)"]);
  });

  it("does not turn a shape's nested literal into the prop's only allowed value (Snackbar anchorOrigin)", () => {
    // Published before the fix: allowedValues = ["left"] for a shape type.
    expect(literalUnion("{ horizontal: 'center' | 'left' | 'right', vertical: 'bottom' | 'top' }")).toBeNull();
    expect(literalUnion("{ horizontal: 'center' | 'left' | 'right' | number, vertical: 'bottom' | 'center' | 'top' | number }")).toBeNull();
  });

  it("keeps the literal alternatives of real unions", () => {
    expect(literalUnion("'column-reverse' | 'column' | 'row-reverse' | 'row' | Array<'column-reverse' | 'column' | 'row-reverse' | 'row'> | object")).toEqual(["column-reverse", "column", "row-reverse", "row"]);
    expect(literalUnion("'auto' | number | { appear?: number, enter?: number, exit?: number }")).toEqual(["auto"]);
    expect(literalUnion("'up' | 'down' | 'left' | 'right' | ('left' | 'right' | 'up' | 'down')[]")).toEqual(["up", "down", "left", "right"]);
    expect(literalUnion("Array<(e: Event) => void> | 'none'")).toEqual(["none"]);
    expect(literalUnion("'sm' | 'md' | 'lg' | string")).toEqual(["sm", "md", "lg"]);
  });
});

describe("base-ui: generated API tables", () => {
  it("reads the trailing * as the required marker, not part of the prop name (Meter Root value*)", () => {
    const md = [
      "# Meter",
      "",
      "## API Reference",
      "",
      "### Root",
      "",
      "Groups all parts of the meter and provides the value for screen readers.",
      "",
      "**Root Props:**",
      "",
      "| Prop | Type | Default | Description |",
      "| :--- | :--- | :------ | :---------- |",
      "| value\\* | `number` | - | The current value. |",
      "| min | `number` | `0` | The minimum value |",
      "",
    ].join("\n");
    const [root] = parseBaseTypes(md);
    expect(root!.props.map((p) => [p.name, p.required, p.defaultValue])).toEqual([
      ["value", true, null],
      ["min", null, "0"],
    ]);
  });

  it("keeps the guidelines an accessibility lead-in introduces (Toolbar usage guidelines)", () => {
    const blocks = [
      "To ensure that toolbars are accessible and helpful, follow these guidelines:",
      "Use inputs sparingly: Left and right arrow keys are used to both move the text insertion cursor in an input, and to navigate among controls in horizontal toolbars.",
    ];
    expect(a11yUsageBlocks(blocks)).toEqual(blocks);
    expect(a11yUsageBlocks(["Keep labels short.", "Provide an accessible name for the trigger: it must have an aria-label."])).toEqual(["Provide an accessible name for the trigger: it must have an aria-label."]);
  });
});

describe("mui: keyboard interactions documented in accessibility prose", () => {
  it("extracts 'dismiss Snackbars by pressing Escape' when there is no Keyboard subsection", () => {
    const md = [
      "# Snackbar",
      "",
      '<p class="description">Snackbars (also known as toasts) are used for brief notifications of processes that have been or will be performed.</p>',
      "",
      "## Accessibility",
      "",
      'The user should be able to dismiss Snackbars by pressing <kbd class="key">Escape</kbd>. If there are multiple instances appearing at the same time and you want <kbd class="key">Escape</kbd> to dismiss only the oldest one that\'s currently open, call `event.preventDefault` in the `onClose` prop.',
      "",
      "## Anatomy",
      "",
      "The Snackbar component is composed of a root `<div>`.",
    ].join("\n");
    const a = parseMuiMarkdown(md).a11y!;
    expect(a.keyboard[0]).toMatchObject({ keys: "Escape" });
    expect(a.keyboard[0]!.action).toContain("dismiss Snackbars by pressing Escape");
    expect(a.keyboardAnchor).toBe("accessibility");
  });

  it("does not read a capitalized word as a key without a key-press context", () => {
    const md = ["# X", "", "## Accessibility", "", "End users with low vision benefit from the high-contrast theme.", ""].join("\n");
    const a = parseMuiMarkdown(md).a11y!;
    expect(a.keyboard).toEqual([]);
  });
});

describe("antd: state props that are documented but not derived", () => {
  const prop = (p: Partial<DocProp>): DocProp => ({ owner: null, name: "x", type: "string", defaultValue: null, description: null, version: null, deprecated: false, literals: [], allLiteral: false, line: 1, file: null, ...p });
  it("flags Steps `status` (type string, values listed in the description) and sub-part `disabled`", () => {
    const props = [prop({ name: "status", description: "can be set to one of the following values: `wait` `process` `finish` `error`" }), prop({ owner: "StepItem", name: "disabled", type: "boolean" }), prop({ name: "current", type: "number" })];
    expect(unextractedStateProps(props).map((p) => p.name)).toEqual(["status", "disabled"]);
    expect(unextractedStateProps([prop({ name: "current", type: "number" }), prop({ name: "status", deprecated: true })])).toEqual([]);
  });
});

describe("antd-mobile: CSS variable owners", () => {
  it("attributes SwipeAction's variables (table after '## Ref') to SwipeAction, sub-components to themselves", () => {
    const h = (depth: number, text: string) => ({ depth, text });
    // Published before the fix: token "ref.background".
    expect(mobileCssVarOwner([h(1, "SwipeAction"), h(2, "Ref"), h(3, "CSS Variables")], "SwipeAction")).toBe("SwipeAction");
    expect(mobileCssVarOwner([h(1, "Loading"), h(2, "SpinLoading"), h(3, "CSS Variables")], "Loading")).toBe("SpinLoading");
    expect(mobileCssVarOwner([h(1, "Slider"), h(3, "CSS Variables")], "Slider")).toBe("Slider");
  });
});

describe("react-aria: Accessibility callouts", () => {
  // react-aria.adobe.com/FileTrigger.md documents its accessibility requirement only in an InlineAlert;
  // ATLAS published accessibility = "not-documented" before the fix.
  const md = [
    "# FileTrigger",
    "",
    "A FileTrigger allows a user to access the file system with any pressable React Aria or React Spectrum component, or custom components built with usePress.",
    "",
    "## Custom trigger",
    "",
    "```tsx",
    "<InlineAlert><Heading>Not this one</Heading><Content>inside code</Content></InlineAlert>",
    "```",
    "",
    '<InlineAlert variant="notice">',
    "  <Heading>Accessibility</Heading>",
    "  <Content>Any `<Pressable>` child must have an [interactive ARIA role](https://www.w3.org/TR/wai-aria-1.2/#widget_roles) or use an appropriate semantic HTML element so that screen readers can announce the trigger.</Content>",
    "</InlineAlert>",
    "",
  ].join("\n");
  it("reads callouts outside code and keeps code spans verbatim", () => {
    expect(inlineAlerts(md)).toEqual([
      { title: "Accessibility", text: "Any <Pressable> child must have an interactive ARIA role or use an appropriate semantic HTML element so that screen readers can announce the trigger." },
    ]);
    expect(parseDocsMd(md).callouts?.map((c) => c.title)).toEqual(["Accessibility"]);
    expect(parseDocsMd("# X\n\nPlain page.\n").callouts).toBeUndefined();
  });
});
