import { describe, expect, it } from "vitest";
import { ariaPatternLabel, ariaReference } from "@/components/catalog/lib/apg";
import { a11yState, coverageCounts, coverageSummaryText, documentedShare, fieldState } from "@/components/catalog/lib/coverage";
import {
  describeClassificationMethod,
  groupKeyboard,
  implementationLabel,
  isLiteralUnionOf,
  shortSystemName,
  sortImplementations,
} from "@/components/catalog/lib/format";
import { expandCatalogQuery } from "@/components/catalog/lib/search";
import { shortenLabels, tokenValueEntries } from "@/components/catalog/lib/tokens";
import { COMPONENT_TYPES } from "@/lib/taxonomy";

describe("coverage", () => {
  it("treats missing or malformed fields as not-extracted, never as none", () => {
    expect(fieldState({}, "variants")).toBe("not-extracted");
    expect(fieldState({ variants: "garbage" as never }, "variants")).toBe("not-extracted");
    expect(fieldState(null, "variants")).toBe("not-extracted");
    expect(coverageCounts({})["not-extracted"]).toBe(12);
  });

  it("counts documented and documented-none as source answers, not inferred", () => {
    const cov = { description: "documented", sizes: "documented-none", states: "inferred", keyboard: "not-documented" } as const;
    const c = coverageCounts(cov);
    expect(c.documented).toBe(1);
    expect(c["documented-none"]).toBe(1);
    expect(c.inferred).toBe(1);
    expect(documentedShare(cov)).toBeCloseTo(2 / 12);
    expect(coverageSummaryText(cov)).toBe("2 of 12 fields documented, 1 inferred, 1 not documented, 8 not extracted");
  });

  it("a11y availability prefers the strongest state of accessibility/keyboard", () => {
    expect(a11yState({ accessibility: "not-documented", keyboard: "documented" })).toBe("documented");
    expect(a11yState({ accessibility: "not-documented" })).toBe("not-documented");
    expect(a11yState({})).toBe("not-extracted");
  });
});

describe("ariaReference", () => {
  it("links APG pattern pages, following verified slug changes", () => {
    expect(ariaReference("combobox")).toMatchObject({ kind: "apg-pattern", url: "https://www.w3.org/WAI/ARIA/apg/patterns/combobox/" });
    expect(ariaReference("menu")?.url).toBe("https://www.w3.org/WAI/ARIA/apg/patterns/menubar/");
    expect(ariaReference("window-splitter")?.url).toBe("https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/");
  });

  it("links role definitions for values without an APG pattern page, and nothing for unknown values", () => {
    expect(ariaReference("textbox")).toMatchObject({ kind: "aria-role", url: "https://www.w3.org/TR/wai-aria-1.2/#textbox" });
    expect(ariaReference("made-up")).toBeNull();
    expect(ariaReference(null)).toBeNull();
  });

  it("every aria_pattern in the taxonomy resolves to a verified reference", () => {
    const patterns = new Set(COMPONENT_TYPES.map((t) => t.ariaPattern).filter((x): x is string => !!x));
    for (const p of patterns) expect(ariaReference(p), p).not.toBeNull();
  });

  it("labels facet values", () => {
    expect(ariaPatternLabel("menu-button")).toBe("Menu Button");
    expect(ariaPatternLabel("textbox")).toBe("textbox");
  });
});

describe("expandCatalogQuery", () => {
  it("expands exact aliases and curated synonyms to canonical types", () => {
    expect(expandCatalogQuery("snackbar").typeSlugs).toContain("toast");
    const dropdown = expandCatalogQuery("dropdown");
    expect(dropdown.typeSlugs).toEqual(expect.arrayContaining(["select", "menu", "combobox", "menu-button"]));
    expect(dropdown.reasons.find((r) => r.slug === "select")?.via).toBe("synonym");
  });

  it("does not treat a direct type-name match as an expansion, and ignores fuzzy input", () => {
    expect(expandCatalogQuery("Combobox").typeSlugs).not.toContain("combobox");
    expect(expandCatalogQuery("zzzz").typeSlugs).toEqual([]);
    expect(expandCatalogQuery("").typeSlugs).toEqual([]);
  });
});

describe("format helpers", () => {
  it("describes classification methods in plain language", () => {
    expect(describeClassificationMethod("alias-exact:checkbox")).toBe("The name matches the ATLAS alias “checkbox” exactly.");
    expect(describeClassificationMethod("taxonomy:alias-exact:action menu+apg-link:menu-button")).toBe(
      "The name matches the ATLAS alias “action menu” exactly, and the official docs link the WAI-ARIA APG “menu-button” pattern.",
    );
    expect(describeClassificationMethod("aria-role:switch (accessibility tab)")).toBe(
      "The official docs declare the ARIA role “switch” (accessibility tab).",
    );
    expect(describeClassificationMethod("something-new:x")).toBe("Method: something-new:x");
    expect(describeClassificationMethod(null)).toBeNull();
  });

  it("labels and orders prop implementations", () => {
    expect(implementationLabel("react").label).toBe("React");
    expect(implementationLabel("web-components:cds-toast-notification").label).toBe("Web Components · cds-toast-notification");
    expect(sortImplementations(["react:Callout", "web-components", "react"])).toEqual(["react", "web-components", "react:Callout"]);
  });

  it("shortens system names only when the org prefix leaves a specific name", () => {
    expect(shortSystemName("GitHub Primer", "GitHub")).toBe("Primer");
    expect(shortSystemName("IBM Carbon Design System", "IBM")).toBe("Carbon Design System");
    expect(shortSystemName("Atlassian Design System", "Atlassian")).toBe("Atlassian Design System");
    expect(shortSystemName("Ant Design", "Ant Group")).toBe("Ant Design");
    expect(shortSystemName("Material Web", null)).toBe("Material Web");
  });

  it("detects literal unions that duplicate allowed values", () => {
    expect(isLiteralUnionOf("'sm' | 'md' | 'lg'", ["sm", "md", "lg"])).toBe(true);
    expect(isLiteralUnionOf("| 'a' | 'b'", ["a", "b"])).toBe(true);
    expect(isLiteralUnionOf("1 | 2", ["1", "2"])).toBe(true);
    expect(isLiteralUnionOf("string | number", ["string", "number"])).toBe(false);
    expect(isLiteralUnionOf("'a' | 'b'", ["a", "c"])).toBe(false);
    expect(isLiteralUnionOf("'a'", ["a"])).toBe(false);
  });

  it("groups keyboard interactions by context and merges identical actions", () => {
    const groups = groupKeyboard([
      { keys: "Enter", action: "Trigger button: Opens the menu." },
      { keys: "Space", action: "Trigger button: Opens the menu." },
      { keys: "Esc", action: "Menu items: Close menu" },
    ]);
    expect(groups).toEqual([
      { context: "Trigger button", rows: [{ keys: ["Enter", "Space"], action: "Opens the menu." }] },
      { context: "Menu items", rows: [{ keys: ["Esc"], action: "Close menu" }] },
    ]);
    expect(groupKeyboard([{ keys: "Tab", action: "Moves focus" }])).toEqual([{ context: null, rows: [{ keys: ["Tab"], action: "Moves focus" }] }]);
  });
});

describe("token value entries", () => {
  it("shortens shared label prefixes", () => {
    expect(shortenLabels(["m3-sys-color-light", "m3-sys-color-dark-high-contrast"])).toEqual(["light", "dark-high-contrast"]);
    expect(shortenLabels(["only"])).toEqual(["only"]);
  });

  it("expands theme-dependent values per themed set, light first", () => {
    const entries = tokenValueEntries([
      {
        set: "m3-component-tokens",
        theme: null,
        valueText: "…",
        aliasState: "theme-dependent",
        resolvedValue: { $themes: { "m3-sys-color-dark": "#d0bcff", "m3-sys-color-light": "#6750a4" } },
      },
    ]);
    expect(entries.map((e) => [e.label, e.text])).toEqual([
      ["light", "#6750a4"],
      ["dark", "#d0bcff"],
    ]);
  });

  it("labels per-theme sets and keeps a single value unlabelled", () => {
    const multi = tokenValueEntries([
      { set: "primitives-theme-dark", theme: "dark", valueText: "#000", aliasState: "resolved", resolvedValue: "#000" },
      { set: "primitives-theme-light", theme: "light", valueText: "#fff", aliasState: "resolved", resolvedValue: "#fff" },
    ]);
    expect(multi.map((e) => e.label)).toEqual(["light", "dark"]);
    const single = tokenValueEntries([{ set: "base", theme: null, valueText: "4px", aliasState: null, resolvedValue: "4px" }]);
    expect(single).toEqual([{ label: null, text: "4px", value: "4px", aliasState: null }]);
  });

  it("does not invent a value for unresolved aliases", () => {
    const [e] = tokenValueEntries([{ set: "s", theme: null, valueText: null, aliasState: "unresolved", resolvedValue: null }]);
    expect(e?.text).toBeNull();
    expect(e?.aliasState).toBe("unresolved");
  });
});
