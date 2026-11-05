import { describe, expect, it } from "vitest";
import { parseSearchParams, parseSuggestParams } from "@/server/search/params";
import { renderHighlight } from "@/server/search/providers/postgres";
import { keywordString, tokenKeywords, tokenUrl, componentUrl } from "@/server/search/documents";

const sp = (s: string) => new URLSearchParams(s);

describe("parseSearchParams", () => {
  it("applies defaults", () => {
    const r = parseSearchParams(sp(""));
    expect(r).toEqual({ ok: true, value: { q: "", limit: 20, offset: 0 } });
  });

  it("parses comma-separated and repeated arrays", () => {
    const r = parseSearchParams(sp("q=button&types=component,token&types=system&frameworks=react,vue&systems=primer&limit=5&offset=10"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      q: "button",
      types: ["component", "token", "system"],
      frameworks: ["react", "vue"],
      systems: ["primer"],
      limit: 5,
      offset: 10,
    });
  });

  it("trims q and ignores empty list items", () => {
    const r = parseSearchParams(sp("q=%20%20react%20&types=,component,,"));
    expect(r.ok && r.value.q).toBe("react");
    expect(r.ok && r.value.types).toEqual(["component"]);
  });

  it("rejects bad input", () => {
    expect(parseSearchParams(sp("types=widget")).ok).toBe(false);
    expect(parseSearchParams(sp("limit=0")).ok).toBe(false);
    expect(parseSearchParams(sp("limit=101")).ok).toBe(false);
    expect(parseSearchParams(sp("limit=abc")).ok).toBe(false);
    expect(parseSearchParams(sp("offset=-1")).ok).toBe(false);
    expect(parseSearchParams(sp("limit=2.5")).ok).toBe(false);
    expect(parseSearchParams(sp(`q=${"x".repeat(201)}`)).ok).toBe(false);
    expect(parseSearchParams(sp("systems=Bad Slug!")).ok).toBe(false);
    expect(parseSearchParams(sp(`frameworks=${Array.from({ length: 30 }, (_, i) => `f${i}`).join(",")}`)).ok).toBe(false);
    const r = parseSearchParams(sp("types=widget&limit=0"));
    expect(!r.ok && r.issues.map((i) => i.path).sort()).toEqual(["limit", "types.0"]);
  });
});

describe("parseSuggestParams", () => {
  it("defaults and bounds", () => {
    expect(parseSuggestParams(sp("q=pag"))).toEqual({ ok: true, value: { q: "pag", limit: 8 } });
    expect(parseSuggestParams(sp("q=pag&limit=21")).ok).toBe(false);
    expect(parseSuggestParams(sp("q=pag&limit=x")).ok).toBe(false);
    expect(parseSuggestParams(sp(`q=${"y".repeat(101)}`)).ok).toBe(false);
    expect(parseSuggestParams(sp(""))).toEqual({ ok: true, value: { q: "", limit: 8 } });
  });
});

describe("document helpers", () => {
  it("highlight output is HTML-escaped with <mark> only", () => {
    expect(renderHighlight("a <script>x</script> ⟦date⟧  picker")).toBe("a &lt;script&gt;x&lt;/script&gt; <mark>date</mark> picker");
  });

  it("token keywords split dotted, camelCase and CSS-var names", () => {
    const k = tokenKeywords("fgColor.default", ["fgColor", "default"], "--fgColor-default")!.split(" ");
    expect(k).toEqual(expect.arrayContaining(["fg", "color", "default", "fgcolor"]));
  });

  it("keywordString de-duplicates phrases and drops empties", () => {
    expect(keywordString(["Toast", "toast", null, "", "snack bar"])).toBe("toast snack bar");
    expect(keywordString([])).toBeNull();
  });

  it("urls are encoded", () => {
    expect(tokenUrl("primer", "--color fg")).toBe("/tokens?system=primer&q=--color%20fg");
    expect(componentUrl("primer", "action-list")).toBe("/systems/primer/components/action-list");
  });
});
