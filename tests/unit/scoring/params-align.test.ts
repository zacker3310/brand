import { describe, expect, it } from "vitest";
import { alignProps, canonicalKey, compareKeys, normalizePropName, rankCandidates, splitKeys } from "@/lib/scoring/align";
import {
  componentCompareHref,
  decodeSavedCriteria,
  defaultComparisonTitle,
  encodeSavedPicks,
  parseComponentCompareParams,
  parseCriteria,
  parsePicks,
  parseSlugList,
  parseSystemCompareParams,
  shortSlugFromBytes,
  systemCompareHref,
} from "@/lib/scoring/params";
import { CreateComparisonInput, formToComparisonInput } from "@/lib/scoring/share";
import { CRITERIA, type ComponentCandidate } from "@/lib/scoring/types";

describe("params", () => {
  it("parses comma and repeated lists into unique valid slugs", () => {
    expect(parseSlugList("carbon, github-primer,carbon")).toEqual(["carbon", "github-primer"]);
    expect(parseSlugList(["carbon", "material-web,Shadcn-UI"])).toEqual(["carbon", "material-web", "shadcn-ui"]);
    expect(parseSlugList(["../etc", "a b", "ok", "", "x--y"])).toEqual(["ok"]);
    expect(parseSlugList(undefined)).toEqual([]);
  });

  it("caps systems at 5 and reports dropped ones", () => {
    const p = parseComponentCompareParams({ type: "Button", systems: "a,b,c,d,e,f,g", diff: "1", props: "all", pick: "a:x,zz:y" });
    expect(p.type).toBe("button");
    expect(p.systems).toEqual(["a", "b", "c", "d", "e"]);
    expect(p.dropped).toEqual(["f", "g"]);
    expect(p.diffOnly).toBe(true);
    expect(p.allProps).toBe(true);
    expect(p.picks).toEqual({ a: "x" }); // picks for systems not compared are ignored
  });

  it("rejects invalid type and saved slugs", () => {
    const p = parseComponentCompareParams({ type: "<script>", saved: "../x" });
    expect(p.type).toBeNull();
    expect(p.saved).toBeNull();
    expect(parseComponentCompareParams({ saved: "Ab12Cd34" }).saved).toBe("Ab12Cd34");
  });

  it("parses picks (first wins) and criteria in canonical order", () => {
    expect(parsePicks(["a:one", "a:two", "b:three", "bad"])).toEqual({ a: "one", b: "three" });
    expect(parseCriteria("maintenance,component-coverage,bogus")).toEqual(["component-coverage", "maintenance"]);
    expect(parseCriteria(undefined)).toEqual([...CRITERIA]);
    expect(parseSystemCompareParams({ systems: "a,b", criteria: "theming" })).toMatchObject({ systems: ["a", "b"], criteria: ["theming"] });
  });

  it("builds readable canonical hrefs that round-trip", () => {
    const href = componentCompareHref({ type: "button", systems: ["github-primer", "carbon"], picks: { carbon: "button", other: "x" }, diffOnly: true });
    expect(href).toBe("/compare?type=button&systems=github-primer,carbon&pick=carbon:button&diff=1");
    const sp = Object.fromEntries(new URLSearchParams(href.split("?")[1]));
    expect(parseComponentCompareParams(sp)).toMatchObject({ type: "button", systems: ["github-primer", "carbon"], picks: { carbon: "button" }, diffOnly: true });
    expect(systemCompareHref({ systems: ["a", "b"], criteria: [...CRITERIA] })).toBe("/compare/systems?systems=a,b");
    expect(systemCompareHref({ systems: ["a", "b"], criteria: ["theming"], saved: "Xy12Ab34" })).toBe("/compare/systems?systems=a,b&criteria=theming&saved=Xy12Ab34");
  });

  it("encodes picks into saved criteria and decodes them back", () => {
    const enc = [...encodeSavedPicks({ carbon: "copy-button" }), "theming", "junk"];
    expect(decodeSavedCriteria(enc)).toEqual({ criteria: ["theming"], picks: { carbon: "copy-button" } });
    expect(decodeSavedCriteria(null)).toEqual({ criteria: [], picks: {} });
  });

  it("generates short base62 slugs and readable default titles", () => {
    const slug = shortSlugFromBytes(new Uint8Array([0, 61, 62, 255, 10, 36, 100, 7]));
    expect(slug).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(slug).toBe("0z07Aac7");
    expect(defaultComparisonTitle("Button", ["A", "B"])).toBe("Button: A vs B");
    expect(defaultComparisonTitle(null, ["A", "B", "C", "D"])).toBe("Systems: A, B, C +1");
  });
});

describe("share input", () => {
  it("validates JSON bodies", () => {
    expect(CreateComparisonInput.safeParse({ type: "button", systems: ["a", "b"] }).success).toBe(true);
    expect(CreateComparisonInput.safeParse({ type: "button", systems: ["a"] }).success).toBe(false);
    expect(CreateComparisonInput.safeParse({ systems: ["a", "a"] }).success).toBe(false);
    expect(CreateComparisonInput.safeParse({ systems: ["a", "b", "c", "d", "e", "f"] }).success).toBe(false);
    expect(CreateComparisonInput.safeParse({ systems: ["a", "b"], extra: 1 }).success).toBe(false);
    expect(CreateComparisonInput.safeParse({ systems: ["a", "B c"] }).success).toBe(false);
    expect(CreateComparisonInput.safeParse({ systems: ["a", "b"], criteria: ["nope"] }).success).toBe(false);
    const ok = CreateComparisonInput.parse({ systems: ["a", "b"], title: "  My\u0007 title  ", picks: { a: "x" } });
    expect(ok.title).toBe("My title");
  });

  it("normalizes form bodies (no-JS save)", () => {
    const form = new URLSearchParams("type=button&systems=a,b&systems=c&pick=a:x&pick=zz:y&criteria=theming&title=");
    expect(formToComparisonInput(form)).toEqual({ type: "button", systems: ["a", "b", "c"], criteria: ["theming"], picks: { a: "x" } });
    expect(CreateComparisonInput.safeParse(formToComparisonInput(form)).success).toBe(true);
  });
});

describe("alignment", () => {
  it("normalizes prop names across conventions", () => {
    expect(normalizePropName("dangerDescription")).toBe("dangerdescription");
    expect(normalizePropName("danger-description")).toBe("dangerdescription");
    expect(normalizePropName("@click")).toBe("click");
    expect(normalizePropName("label?")).toBe("label");
  });

  it("aligns props by normalized name, shared props first, marking the method", () => {
    const rows = alignProps([
      { system: "a", implementation: "react", name: "tabIndex" },
      { system: "b", implementation: "web-components", name: "tab-index" },
      { system: "a", implementation: "react", name: "disabled" },
      { system: "b", implementation: "web-components", name: "disabled" },
      { system: "c", implementation: "react", name: "disabled" },
      { system: "a", implementation: "react", name: "zeta" },
    ]);
    expect(rows.map((r) => r.key)).toEqual(["disabled", "tabindex", "zeta"]);
    expect(rows[0]).toMatchObject({ method: "exact", systemCount: 3, label: "disabled" });
    expect(rows[1]).toMatchObject({ method: "normalized", names: ["tab-index", "tabIndex"], systemCount: 2 });
  });

  it("splits and canonicalizes documented keys", () => {
    expect(splitKeys("Tab / Space / Enter")).toEqual(["Tab", "Space", "Enter"]);
    expect(splitKeys("ArrowUp or ArrowDown")).toEqual(["Arrow keys"]);
    expect(splitKeys("Esc, Return")).toEqual(["Escape", "Enter"]);
    expect(splitKeys("Ctrl+K")).toEqual(["Ctrl+K"]);
    expect(canonicalKey("shift + tab")).toBe("Shift+Tab");
    expect(canonicalKey("q")).toBe("Type-ahead");
    expect(["Escape", "Tab", "Zed", "Enter"].sort(compareKeys)).toEqual(["Tab", "Enter", "Escape", "Zed"]);
  });

  it("ranks the most representative component first", () => {
    const c = (slug: string, over: Partial<ComponentCandidate> = {}): ComponentCandidate => ({
      id: slug,
      slug,
      name: slug,
      lifecycle: "stable",
      classificationState: "inferred",
      classificationMethod: "alias-exact:x",
      confidence: 0.8,
      ...over,
    });
    const ranked = rankCandidates(
      [
        c("confirmation-dialog", { confidence: 0.95 }),
        c("dialog-v1", { lifecycle: "deprecated", confidence: 0.99 }),
        c("dialog"),
        c("dialog-contained", { classificationMethod: "alias-contained:dialog", confidence: 0.99 }),
      ],
      { slug: "dialog", name: "Dialog" },
    );
    expect(ranked.map((x) => x.slug)).toEqual(["dialog", "confirmation-dialog", "dialog-contained", "dialog-v1"]);
    const plural = rankCandidates([c("list-item", { name: "List item" }), c("list", { name: "Lists", classificationMethod: "singular+alias-exact:list" })], { slug: "list", name: "List" });
    expect(plural[0]!.slug).toBe("list");
  });
});
