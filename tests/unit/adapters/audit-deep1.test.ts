/**
 * Regression tests for claims refuted by the deep-1 data-integrity audit (docs/audit/deep-1.md).
 * Each case reproduces a published claim that did not match the live official source. Inputs are
 * short synthetic excerpts modelled on the real sources (no network, no copied pages).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocsPage } from "@/ingestion/adapters/atlassian/html";
import { parseA11y, parseUsage } from "@/ingestion/adapters/carbon/docs";
import { wcDtsElements } from "@/ingestion/adapters/fluent";
import { parseDts, resolveProps } from "@/ingestion/adapters/fluent/dts";
import { componentEntries, parseF2Page, parseNav } from "@/ingestion/adapters/fluent/f2-html";
import type { FluentFragment } from "@/ingestion/adapters/fluent/fragments";
import { normalizeF2 } from "@/ingestion/adapters/fluent/normalize-f2";
import { normalizeWc } from "@/ingestion/adapters/fluent/normalize-wc";
import type { Prov as FluentProv } from "@/ingestion/adapters/fluent/shared";
import { sentencesMatching } from "@/ingestion/adapters/govuk/docs";
import { parseCem } from "@/ingestion/adapters/material/cem";
import { parseMwcDoc } from "@/ingestion/adapters/material/mwc-docs";
import { normalizeMwcComponents } from "@/ingestion/adapters/material/normalize-web";
import type { Prov as MaterialProv } from "@/ingestion/adapters/material/shared";
import { DtsResolver } from "@/ingestion/adapters/polaris/dts";
import { parseReactMdx } from "@/ingestion/adapters/polaris/mdx";
import { parseComponentsJson } from "@/ingestion/adapters/primer/components-json";
import { VARIANT_AXIS_PROPS } from "@/ingestion/adapters/primer/constants";
import type { PrimerFragmentData } from "@/ingestion/adapters/primer/fragments";
import { normalizePrimer } from "@/ingestion/adapters/primer/normalize";

const FLUENT_FX = path.resolve(import.meta.dirname, "../../fixtures/adapters/fluent");

describe("fluent d.ts: union prop shapes (Option)", () => {
  // @fluentui/react-combobox@9.17.8: children is required only when it is the display string; with
  // `text` given it is an optional ReactNode. ATLAS published both as required.
  const file = parseDts(`
export declare type OptionProps = {
    disabled?: boolean;
    value?: string;
} & ({
    text?: string;
    children: string;
} | {
    text: string;
    children?: React.ReactNode;
});
`);
  const props = new Map(resolveProps("OptionProps", file).members.map((m) => [m.name, m]));

  it("a prop is required only when every union branch requires it", () => {
    expect(props.get("children")?.optional).toBe(true);
    expect(props.get("text")?.optional).toBe(true);
    expect(props.get("value")?.optional).toBe(true);
  });

  it("a prop typed differently per branch keeps every branch type", () => {
    expect(props.get("children")?.type).toBe("string | React.ReactNode");
    expect(props.get("text")?.type).toBe("string");
  });

  it("intersections still make a prop required when one side requires it", () => {
    const f = parseDts(`export declare type P = { a?: string } & { a: string; b?: number };`);
    const m = new Map(resolveProps("P", f).members.map((x) => [x.name, x]));
    expect(m.get("a")?.optional).toBe(false);
  });
});

describe("fluent web components: relationships named in TSDoc", () => {
  it("an element whose TSDoc names another element is not-extracted for relationships (DropdownOption)", () => {
    const dts = `/**
 * A Dropdown Custom HTML Element. Implements the {@link https://www.w3.org/TR/wai-aria-1.1/#combobox | ARIA combobox }.
 *
 * @tag fluent-dropdown
 *
 * @public
 */
export declare class Dropdown extends FASTElement {
    disabled?: boolean;
}

/**
 * The definition for the \`<fluent-dropdown>\` element.
 *
 * @public
 */
export declare const DropdownDefinition: PartialFASTElementDefinition;

/**
 * A DropdownOption Custom HTML Element.
 *
 * @tag fluent-dropdown-option
 *
 * @remarks
 * The Option element is specifically designed for use in the Dropdown element.
 *
 * @public
 */
export declare class DropdownOption extends FASTElement {
    value: string;
}

/**
 * The definition for the \`<fluent-dropdown-option>\` element.
 *
 * @public
 */
export declare const DropdownOptionDefinition: PartialFASTElementDefinition;
`;
    const frags: FluentFragment[] = [
      {
        kind: "wc-dts",
        prov: { sourceUrl: "https://cdn.jsdelivr.net/npm/@fluentui/web-components@3.1.4/dist/web-components.d.ts", retrievedAt: "2026-11-05T00:00:00.000Z", contentHash: "abc", file: "dist/web-components.d.ts" },
        npm: { pkg: "@fluentui/web-components", version: "3.1.4", publishedAt: null, license: "MIT", deprecated: null, url: "https://www.npmjs.com/package/@fluentui/web-components" },
        elements: wcDtsElements(dts),
        distDirs: [],
      },
    ];
    const { components } = normalizeWc(frags);
    const by = new Map(components.map((c) => [c.name, c]));
    expect(by.get("DropdownOption")?.coverage.relationships).toBe("not-extracted");
    expect(by.get("Dropdown")?.coverage.relationships).toBe("not-documented");
  });
});

describe("fluent 2 guidance pages: coverage of fields the adapter does not parse", () => {
  const url = "https://fluent2.microsoft.design/components/web/react/core/button/usage/";
  const html = readFileSync(path.join(FLUENT_FX, "f2-button-usage.html"), "utf8");
  const prov: FluentProv = { sourceUrl: url, retrievedAt: "2026-11-05T00:00:00.000Z", contentHash: "abc", file: "/components/web/react/core/button/usage/" };
  const entry = componentEntries(parseNav(html))[1]!;
  const run = (mutate: (p: ReturnType<typeof parseF2Page>) => void) => {
    const page = parseF2Page(html, url);
    mutate(page);
    const frags: FluentFragment[] = [{ kind: "f2-page", prov, entry, page }];
    return normalizeF2(frags).components[0]!;
  };

  it("states / sizes / tokens are not-extracted (Field, Spin button and Toast pages describe states in prose)", () => {
    const c = run(() => {});
    expect(c.coverage).toMatchObject({ states: "not-extracted", sizes: "not-extracted", tokens: "not-extracted", properties: "not-documented" });
  });

  it("keyboard use described outside the Accessibility section is unknown, not undocumented (Spin button)", () => {
    const c = run((p) => {
      const a11y = p.sections.find((s) => s.id === "accessibility")!;
      a11y.keyboard = [];
      a11y.prose = ["Use aria-valuemin and aria-valuemax to define the size of the range."];
      p.sections.push({ id: "behavior", title: "Behavior", prose: ["People can choose a value using the keyboard arrows to change the value."], h3: [], cards: [], hasTable: false, keyboard: [] });
    });
    expect(c.coverage.keyboard).toBe("not-extracted");
    expect(c.accessibility?.coverage.keyboard).toBe("not-extracted");
  });

  it("accessibility prose outside an Accessibility section is not-extracted (Menu: aria-label for screen readers)", () => {
    const c = run((p) => {
      p.sections = p.sections.filter((s) => s.id !== "accessibility");
      p.resources = p.resources.filter((r) => !/w3\.org/.test(r.href));
      p.sections.push({ id: "behavior", title: "Behavior", prose: ["Submenus: be sure to add an aria-label to the trigger component for people who use screen readers."], h3: [], cards: [], hasTable: false, keyboard: [] });
    });
    expect(c.coverage.accessibility).toBe("not-extracted");
  });
});

describe("carbon accessibility / usage tabs: absence claims", () => {
  // radio-button/accessibility.mdx: screen-reader output under "Labeling and states", no "Screen reader" heading.
  const radio = parseA11y(`---
title: Radio button
---

## Accessibility considerations

### Labeling and states

Carbon surfaces the labeling of radio buttons and groups to screen readers and other assistive technologies.

## Development considerations

- See the [ARIA authoring practices](https://www.w3.org/WAI/ARIA/apg/patterns/radiobutton/) for more considerations.
`);
  it("screen-reader prose outside a dedicated section is flagged (coverage becomes not-extracted)", () => {
    expect(radio.screenReader).toBeNull();
    expect(radio.screenReaderSectionFound).toBe(false);
    expect(radio.screenReaderMentioned).toBe(true);
    expect(radio.ariaPattern).toBe("radiobutton");
    // "Pressing Tab again will move focus out of the radio button group" without a "Focus" heading
    const focus = parseA11y(`## Keyboard interactions\n\nA group of radio buttons takes a single tab stop. Pressing Tab again will move focus out of the radio button group.`);
    expect(focus.focusSectionFound).toBe(false);
    expect(focus.focusMentioned).toBe(true);
  });

  it("APG links in other URL forms are flagged instead of reported as no pattern (pagination, tile)", () => {
    const pagination = parseA11y(`## Development considerations

- Consult the [ARIA authoring practices](https://www.w3.org/WAI/ARIA/apg/example-index/combobox/combobox-select-only.html) for more considerations.
`);
    expect(pagination.ariaPattern).toBeNull();
    expect(pagination.apgLinkFound).toBe(true);
    const tile = parseA11y(`See the [ARIA authoring practices](https://w3c.github.io/aria-practices/#tooltip) for more considerations.`);
    expect(tile.apgLinkFound).toBe(true);
    const none = parseA11y(`## Keyboard interactions\n\nPress Tab to move focus.`);
    expect(none.apgLinkFound).toBe(false);
    expect(none.screenReaderMentioned).toBe(false);
  });

  it("an AI presence section is recorded so variants are not claimed undocumented", () => {
    const usage = parseUsage(
      `---
title: Radio button
description: Use radio buttons when you have a group of mutually exclusive choices.
---

## Overview

Radio buttons are used for mutually exclusive choices.

## AI presence

Radio button has a modification that embeds the AI label when AI present in the control. The AI variant functions the same as the normal version.
`,
      "src/pages/components/radio-button/usage.mdx",
    );
    expect(usage.variants).toEqual([]);
    expect(usage.variantsSectionFound).toBe(false);
    expect(usage.aiPresenceSectionFound).toBe(true);
  });
});

describe("polaris archived React docs: ARIA role named in prose", () => {
  it('reads "with the `switch` ARIA role" as role switch (Setting toggle)', () => {
    const doc = parseReactMdx(
      `---
title: Setting toggle
category: Deprecated
status: Deprecated
---

# {frontmatter.title}

<Lede>

Use to give merchants control over a feature or option that can be turned on or off.

</Lede>

## Accessibility

The \`SettingToggle\` component is implemented as an HTML \`<button>\` with the \`switch\` [ARIA role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/switch_role).
`,
      "polaris.shopify.com/content/components/deprecated/setting-toggle.mdx",
    );
    expect(doc.accessibility?.roles).toContain("switch");
  });
});

describe("polaris d.ts: single-literal aliases are enumerations", () => {
  it("ButtonGroup `variant?: Variant` with `type Variant = 'segmented'` yields ['segmented']", async () => {
    const files: Record<string, string> = {
      "ButtonGroup.d.ts": "type Gap = 'extraTight' | 'tight' | 'loose';\ntype Variant = 'segmented';\nexport interface ButtonGroupProps {\n    gap?: Gap;\n    variant?: Variant;\n}\n",
    };
    const r = new DtsResolver(async (f) => files[f] ?? null);
    expect(await r.allowedValues("ButtonGroup.d.ts", "Variant")).toEqual(["segmented"]);
    expect(await r.allowedValues("ButtonGroup.d.ts", "Gap")).toEqual(["extraTight", "tight", "loose"]);
    // A bare inline literal is still not treated as an enumeration.
    expect(await r.allowedValues("ButtonGroup.d.ts", "'div'")).toBeNull();
  });
});

describe("primer: density variants and states documented on subcomponents", () => {
  const stamp = (url: string) => ({ url, evidenceUrl: url, retrievedAt: "2026-11-05T00:00:00.000Z", hash: "abc" });
  const react = { packageName: "@primer/react", version: "38.44.0", publishedAt: null, license: "MIT" };
  const cjUrl = "https://cdn.jsdelivr.net/npm/@primer/react@38.44.0/generated/components.json";
  const cj = JSON.stringify({
    schemaVersion: 2,
    components: {
      actionbar: {
        id: "actionbar", name: "ActionBar", status: "alpha", importPath: "@primer/react", stories: [],
        props: [{ name: "size", type: "'small' | 'large' | 'medium'", defaultValue: "'medium'" }],
        subcomponents: [{ name: "ActionBar.IconButton", props: [{ name: "disabled", type: "boolean" }] }],
      },
      data_table: {
        id: "data_table", name: "DataTable", status: "alpha", importPath: "@primer/react/experimental", stories: [],
        props: [{ name: "cellPadding", type: "'condensed' | 'normal' | 'spacious'", description: "Specify the amount of space that should be available around the contents of a cell" }],
        subcomponents: [],
      },
    },
  });
  const fragments: PrimerFragmentData[] = [
    { type: "sitemap", stamp: stamp("https://primer.style/sitemap.xml"), urls: ["https://primer.style/product/components/action-bar/", "https://primer.style/product/components/data-table/"] },
    { type: "components-json", stamp: stamp(cjUrl), npm: react, file: "generated/components.json", data: parseComponentsJson(cj) },
  ];
  const bundle = normalizePrimer(fragments, { systemSlug: "github-primer" });
  const by = (slug: string) => bundle.components!.find((c) => c.slug === slug)!;

  it("DataTable cellPadding ('Table cell density') is a documented density axis", () => {
    expect(VARIANT_AXIS_PROPS.cellPadding).toBe("density");
    const dt = by("data-table");
    expect(dt.variants.map((v) => `${v.axis}:${v.name}`)).toEqual(["density:condensed", "density:normal", "density:spacious"]);
    expect(dt.coverage.variants).toBe("documented");
  });

  it("a disabled prop on ActionBar.IconButton makes parent states not-extracted, not not-documented", () => {
    const ab = by("action-bar");
    expect(ab.states).toEqual([]);
    expect(ab.coverage.states).toBe("not-extracted");
  });
});

describe("gov.uk guidance excerpts keep their subject", () => {
  it("prepends the sentence a dependent sentence refers to", () => {
    const blocks = [
      "Avoid using the ‘infinite scroll’ technique to automatically load content when the user approaches the bottom of the page. This causes problems for keyboard users.",
      "Do not use links in hint text. While screen readers will read out the link text, they usually do not tell users the text is a link.",
      "Show the page number in the page <title> so that screen reader users know they’ve navigated to a different page.",
    ];
    const out = sentencesMatching(blocks, /\b(keyboard|screen readers?)\b/i, 6);
    expect(out[0]).toBe(blocks[0]);
    expect(out[1]).toBe(blocks[1]);
    expect(out[2]).toBe(blocks[2]);
  });

  it("walks back over a chain of dependent sentences (Cookie banner)", () => {
    const b = "Do not make the Cookie banner component ‘sticky’ to the top of the page by using position: fixed or any other method. This is to make sure it does not cover or obscure any content which has a focus applied. This is to comply with WCAG 2.2 success criterion 2.4.11 Focus not obscured (minimum).";
    expect(sentencesMatching([b], /\bwcag\b/i, 6)).toEqual([b]);
  });

  it("does not repeat a context sentence that was already emitted", () => {
    const out = sentencesMatching(["Screen readers announce the error. This helps screen reader users."], /screen readers?/i, 6);
    expect(out).toEqual(["Screen readers announce the error.", "This helps screen reader users."]);
  });
});

describe("atlassian examples tab without section headings", () => {
  it("counts rendered example code blocks (Country select has one example and no h2/h3)", () => {
    const html = `<html><head><title>Country select</title></head><body><main id="main-content">
<h1>Country select</h1><p>Country select allows users to make a single selection from a list of countries.</p>
<div role="tabpanel"><p>Use country select to let people select a single country from a list of countries.</p>
<pre><code class="language-tsx">import { CountrySelect } from '@atlaskit/select/country-select';</code></pre></div>
</main></body></html>`;
    const page = parseDocsPage(html, "https://atlassian.design/components/select/country-select/examples");
    expect(page.headings.filter((h) => h.level >= 2)).toEqual([]);
    expect(page.exampleBlocks).toBe(1);
  });
});

describe("material web: descriptions inherited from a superclass, sizes typed by alias, variants outside Types", () => {
  const cemJson = JSON.stringify({
    schemaVersion: "1.0.0",
    modules: [
      {
        kind: "javascript-module",
        path: "chips/chip-set.js",
        declarations: [{ kind: "class", name: "MdChipSet", tagName: "md-chip-set", customElement: true, description: "TODO(b/243982145): add docs", superclass: { name: "ChipSet", module: "chips/internal/chip-set.js", package: "@material/web" } }],
      },
      { kind: "javascript-module", path: "chips/internal/chip-set.js", declarations: [{ kind: "class", name: "ChipSet", description: "A chip set component.", members: [] }] },
      {
        kind: "javascript-module",
        path: "fab/fab.js",
        declarations: [{ kind: "class", name: "MdFab", tagName: "md-fab", customElement: true, description: "A floating action button.", members: [{ kind: "field", name: "size", type: { text: "FabSize" }, default: "'medium'", attribute: "size" }] }],
      },
      {
        kind: "javascript-module",
        path: "slider/slider.js",
        declarations: [{ kind: "class", name: "MdSlider", tagName: "md-slider", customElement: true, description: "A slider.", members: [{ kind: "field", name: "max", type: { text: "number" }, default: "100", attribute: "max" }] }],
      },
    ],
  });
  const elements = parseCem(cemJson);

  it("evidence for an inherited description points at the declaration holding the text", () => {
    const chipSet = elements.find((e) => e.tagName === "md-chip-set")!;
    expect(chipSet.description).toBe("A chip set component.");
    expect(chipSet.pointer).toBe("/modules/0/declarations/0");
    expect(chipSet.docPointer).toBe("/modules/1/declarations/0");
    const fab = elements.find((e) => e.tagName === "md-fab")!;
    expect(fab.docPointer).toBe(fab.pointer);
  });

  it("an alias-typed size property or a Sizes section is not-extracted; a page without Types is not-extracted for variants", () => {
    const prov = (file: string): MaterialProv => {
      const sourceUrl = `https://github.com/material-components/material-web/blob/v2.5.0/${file}`;
      return { sourceUrl, fetchedUrl: sourceUrl, retrievedAt: "2026-11-05T00:00:00.000Z", contentHash: "abc", file };
    };
    const fabMd = `# Floating action buttons (FAB)

FAB represents the most important action on a screen.

## Types

1. [FAB](#fab)

## FAB

### Sizes

FABs may be small, medium (default), or large by setting the \`size\` attribute.

## API

### MdFab <code>&lt;md-fab&gt;</code>

#### Properties

| Property | Attribute | Type | Default | Description |
| --- | --- | --- | --- | --- |
| \`size\` | \`size\` | \`FabSize\` | \`'medium'\` | The size of the FAB. |
`;
    const sliderMd = `# Sliders

Sliders allow users to view and select a value (or range) along a track.

## Usage

Sliders may be continuous or discrete, and may also represent a range.

### Continuous

Allows users to select a value along a subjective range.

## API

### MdSlider <code>&lt;md-slider&gt;</code>

#### Properties

| Property | Attribute | Type | Default | Description |
| --- | --- | --- | --- | --- |
| \`max\` | \`max\` | \`number\` | \`100\` | The slider maximum value |
`;
    const { components } = normalizeMwcComponents(
      [
        { prov: prov("docs/components/fab.md"), stem: "fab", doc: parseMwcDoc(fabMd, "docs/components/fab.md") },
        { prov: prov("docs/components/slider.md"), stem: "slider", doc: parseMwcDoc(sliderMd, "docs/components/slider.md") },
      ],
      { version: "2.5.0", ref: "v2.5.0", cem: { prov: prov("custom-elements.json"), elements }, labsReadme: null, tokenByCssVar: new Map() },
    );
    const fab = components.find((c) => c.slug === "fab")!;
    expect(fab.sizes).toBeNull();
    expect(fab.coverage.sizes).toBe("not-extracted");
    const slider = components.find((c) => c.slug === "slider")!;
    expect(slider.variants).toEqual([]);
    expect(slider.coverage.variants).toBe("not-extracted");
    expect(slider.coverage.sizes).toBe("not-documented");
  });
});
