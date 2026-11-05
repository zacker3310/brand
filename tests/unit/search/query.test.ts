import { describe, expect, it } from "vitest";
import { correctWord, editDistance, normalizeWords, parseQuery, relaxInterpretedFilters } from "@/server/search/query";

const pq = (q: string, extra: Record<string, unknown> = {}) => parseQuery({ q, limit: 20, offset: 0, ...extra });

describe("normalizeWords", () => {
  it("lowercases, strips diacritics and punctuation, splits separators", () => {
    expect(normalizeWords("  Date-Picker / Señal_Ü ")).toBe("date picker senal u");
    expect(normalizeWords("--color-fg-default")).toBe("color fg default");
    expect(normalizeWords("A11y & #0969da")).toBe("a11y 0969da");
  });
});

describe("parseQuery: required example queries", () => {
  it("Accessible date picker -> date-picker type boost + a11y boost, 'accessible' not required", () => {
    const p = pq("Accessible date picker");
    expect(p.terms).toEqual(["date", "picker"]);
    expect(p.boosts.componentTypes).toEqual(["date-picker"]);
    expect(p.boosts.accessibility).toBe(true);
    expect(p.boosts.tags).toContain("accessibility");
    expect(p.interpretedFilters).toMatchObject({ componentTypes: ["date-picker"], accessibility: ["documented"], tags: ["accessibility"] });
    expect(p.filters.types).toBeNull();
    expect(p.expansions).toContain("calendar");
    // the consumed word still contributes as an optional rank term
    expect(p.softTerms).toContain("accessible");
  });

  it("Enterprise data table -> table type, enterprise tag boost, table/data grid expansions", () => {
    const p = pq("Enterprise data table");
    expect(p.terms).toEqual(["data", "table"]);
    expect(p.boosts.componentTypes).toEqual(["table"]);
    expect(p.boosts.tags).toEqual(expect.arrayContaining(["enterprise"]));
    expect(p.expansions).toEqual(expect.arrayContaining(["table", "data grid"]));
    expect(p.boosts.relatedComponentTypes).toContain("data-grid");
    expect(p.units).toHaveLength(1);
    expect(p.units[0]!.words).toEqual(["data", "table"]);
  });

  it("Dark mode tokens -> token type filter + dark theme filter, browse mode", () => {
    const p = pq("Dark mode tokens");
    expect(p.filters.types).toEqual(["token"]);
    expect(p.filters.themes).toEqual(["dark"]);
    expect(p.terms).toEqual([]);
    expect(p.interpretedFilters).toMatchObject({ types: ["token"], theme: ["dark"] });
    expect(p.interpretedHard).toMatchObject({ types: true, themes: true });
  });

  it("React combobox -> framework filter react + combobox type boost", () => {
    const p = pq("React combobox");
    expect(p.filters.frameworks).toEqual(["react"]);
    expect(p.terms).toEqual(["combobox"]);
    expect(p.boosts.componentTypes).toEqual(["combobox"]);
    expect(p.interpretedFilters).toMatchObject({ frameworks: ["react"], componentTypes: ["combobox"] });
    expect(p.interpretedHard.frameworks).toBe(true);
  });

  it("Government design systems -> system filter; 'government' stays required text with synonyms", () => {
    const p = pq("Government design systems");
    expect(p.filters.types).toEqual(["system"]);
    expect(p.terms).toEqual(["government"]);
    expect(p.boosts.tags).toContain("government");
    expect(p.expansions).toEqual(expect.arrayContaining(["gov", "public sector"]));
    expect(p.interpretedFilters).toMatchObject({ types: ["system"], tags: ["government"] });
  });

  it("Button with loading state -> button type + loading state boost", () => {
    const p = pq("Button with loading state");
    expect(p.terms).toEqual(["button"]);
    expect(p.boosts.componentTypes).toEqual(["button"]);
    expect(p.boosts.states).toEqual(["loading"]);
    expect(p.interpretedFilters).toMatchObject({ componentTypes: ["button"], states: ["loading"] });
    expect(p.softTerms).toContain("loading");
  });
});

describe("parseQuery: interpretation rules", () => {
  it("synonym expansion never replaces the original words", () => {
    const p = pq("snackbar");
    expect(p.terms).toEqual(["snackbar"]);
    expect(p.expansions).toEqual(["toast"]);
    expect(p.boosts.componentTypes).toEqual(["toast"]); // 'snackbar' is a taxonomy alias of toast
    const d = pq("dropdown");
    expect(d.terms).toEqual(["dropdown"]);
    expect(d.boosts.componentTypes).toEqual(["dropdown"]);
    expect(d.expansions).toEqual(expect.arrayContaining(["select", "menu", "combobox", "menu button"]));
    // near-synonyms are expansions/related only, not boosted as the detected type
    expect(d.boosts.componentTypes).not.toContain("select");
  });

  it("interpretive words alone are kept as text", () => {
    expect(pq("react").terms).toEqual(["react"]);
    expect(pq("react").filters.frameworks).toEqual(["react"]);
    expect(pq("government").terms).toEqual(["government"]);
    expect(pq("loading").terms).toEqual(["loading"]);
    expect(pq("loading state").terms).toEqual(["loading"]);
    expect(pq("token").terms).toEqual(["token"]); // singular intent is only a boost
    expect(pq("token").filters.types).toBeNull();
  });

  it("plural intents are filters, singular intents boosts", () => {
    expect(pq("button tokens").filters.types).toEqual(["token"]);
    expect(pq("button tokens").terms).toEqual(["button"]);
    expect(pq("form patterns").filters.types).toEqual(["pattern", "pattern-type"]);
    expect(pq("carbon design system").filters.types).toBeNull();
    expect(pq("carbon design system").boosts.entityTypes).toEqual(["system"]);
    expect(pq("carbon design system").terms).toEqual(["carbon"]);
    expect(pq("tokens").terms).toEqual([]); // browse all tokens
  });

  it("weak framework words need component context", () => {
    expect(pq("solid border tokens").filters.frameworks).toBeNull();
    expect(pq("solid border tokens").terms).toEqual(["solid", "border"]);
    expect(pq("solid button").filters.frameworks).toEqual(["solid"]);
    expect(pq("css variables").filters.frameworks).toBeNull();
    expect(pq("web components tabs").filters.frameworks).toEqual(["web-components"]);
    expect(pq("react native switch").filters.frameworks).toEqual(["react-native"]);
  });

  it("bare 'dark' is a theme only in token context", () => {
    expect(pq("dark tokens").filters.themes).toEqual(["dark"]);
    expect(pq("dark button").filters.themes).toBeNull();
    expect(pq("dark button").terms).toEqual(["dark", "button"]);
    expect(pq("dark mode").terms).toEqual(["dark", "mode"]); // only interpretive words -> stay as text
    expect(pq("dark mode").filters.themes).toEqual(["dark"]);
  });

  it("state words: '<x> state' always, bare only for unambiguous states", () => {
    expect(pq("input error state").boosts.states).toEqual(["error"]);
    expect(pq("input error state").terms).toEqual(["input"]);
    expect(pq("disabled checkbox").boosts.states).toEqual(["disabled"]);
    expect(pq("error message").boosts.states).toEqual([]); // 'error' alone is not a state word
    expect(pq("error message").boosts.componentTypes).toEqual(["validation-message"]);
    expect(pq("focus ring").boosts.states).toEqual([]);
  });

  it("plural component names detect the type", () => {
    expect(pq("buttons").boosts.componentTypes).toEqual(["button"]);
    expect(pq("data tables").boosts.componentTypes).toEqual(["table"]);
    expect(pq("toasts").expansions).toEqual(expect.arrayContaining(["snackbar"]));
  });

  it("typo correction is conservative and only adds an expansion", () => {
    const p = pq("comobox");
    expect(p.terms).toEqual(["comobox"]);
    expect(p.expansions).toEqual(["combobox"]);
    expect(p.boosts.componentTypes).toEqual([]);
    expect(p.boosts.relatedComponentTypes).toEqual(["combobox"]);
    expect(pq("pagnation").expansions).toEqual(["pagination"]);
    expect(pq("radix").expansions).toEqual([]); // too short to correct
    expect(pq("primer").expansions).toEqual([]);
    expect(correctWord("button")).toBeNull(); // known word
    expect(editDistance("comobox", "combobox")).toBe(1);
    expect(editDistance("tooltpi", "tooltip")).toBe(1); // transposition
  });

  it("quoted phrases are literal and negations are extracted", () => {
    const p = pq('"loading state" -react button');
    expect(p.negated).toEqual(["react"]);
    expect(p.filters.frameworks).toBeNull();
    expect(p.terms).toEqual(["loading", "state", "button"]);
    expect(p.boosts.states).toEqual([]);
    expect(p.text).toBe('"loading state" button');
    expect(p.interpretedFilters.excluded).toEqual(["react"]);
    // CSS custom properties are not negations
    expect(pq("--color-fg-default").negated).toEqual([]);
    expect(pq("--color-fg-default").terms).toEqual(["color", "fg", "default"]);
  });

  it("stopword-only queries never silently become browse-all", () => {
    expect(pq("the").terms).toEqual(["the"]);
    expect(pq("").terms).toEqual([]);
    expect(pq("").filters.types).toBeNull();
  });

  it("explicit filters win over interpreted ones and are never relaxed", () => {
    const p = pq("Dark mode tokens", { types: ["component"] });
    expect(p.filters.types).toEqual(["component"]);
    expect(p.interpretedHard.types).toBe(false);
    const f = pq("React combobox", { frameworks: ["vue"] });
    expect(f.filters.frameworks).toEqual(["vue", "react"]);
    const relaxed = relaxInterpretedFilters(f, ["vue"]);
    expect(relaxed.filters.frameworks).toEqual(["vue"]);
    expect(relaxed.boosts.componentTypes).toEqual(["combobox"]);
    const r2 = relaxInterpretedFilters(pq("Dark mode tokens"));
    expect(r2.filters.types).toBeNull();
    expect(r2.filters.themes).toBeNull();
    expect(r2.boosts.entityTypes).toEqual(["token"]);
  });

  it("is deterministic", () => {
    expect(pq("Enterprise data table")).toEqual(pq("Enterprise data table"));
  });
});
