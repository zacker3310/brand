import { describe, expect, it } from "vitest";
import { explorerHref, likePattern, parseExplorerParams } from "@/components/tokens/lib/params";

describe("explorer params", () => {
  it("parses and validates search params", () => {
    const p = parseExplorerParams({ system: "github-primer", category: "color", view: "themes", page: "3", token: "77F8CFA3-D0D3-463B-9708-BE3EB6B0170D", state: "cycle", failing: "1" });
    expect(p).toMatchObject({ system: "github-primer", category: "color", view: "themes", page: 3, token: "77f8cfa3-d0d3-463b-9708-be3eb6b0170d", state: "cycle", failing: true });
  });
  it("drops invalid values instead of trusting them", () => {
    const p = parseExplorerParams({ system: "../x", category: "sound", view: "grid", page: "-2", token: "1; drop", state: "maybe" });
    expect(p).toMatchObject({ system: undefined, category: undefined, view: "visual", page: 1, token: undefined, state: undefined });
  });
  it("resets page on filter changes and system-specific keys on system change", () => {
    const cur = parseExplorerParams({ system: "carbon", set: "palette", category: "color", page: "4", q: "blue" });
    expect(explorerHref(cur, { category: "spacing" })).toBe("/tokens?system=carbon&set=palette&category=spacing&q=blue");
    expect(explorerHref(cur, { system: "github-primer" })).toBe("/tokens?system=github-primer&category=color");
    expect(explorerHref(cur, { page: 5 })).toBe("/tokens?system=carbon&set=palette&category=color&q=blue&page=5");
  });
  it("escapes LIKE wildcards", () => {
    expect(likePattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
  });
});
