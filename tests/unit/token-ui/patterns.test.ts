import { describe, expect, it } from "vitest";
import { classificationInfo, docsSection, excerpt } from "@/components/patterns/lib";

describe("pattern helpers", () => {
  it("reconstructs the heuristic method when it matches the stored type", () => {
    const i = classificationInfo({ name: "Filtering", classificationState: "inferred", type: { slug: "filtering", name: "Filtering" } });
    expect(i.state).toBe("inferred");
    expect(i.detail).toContain("alias-exact:filtering");
  });
  it("does not claim a heuristic when the classifier disagrees", () => {
    const i = classificationInfo({ name: "Blorp", classificationState: "inferred", type: { slug: "search", name: "Search" } });
    expect(i.detail).toContain("adapter");
  });
  it("labels unmapped patterns as unclassified", () => {
    expect(classificationInfo({ name: "Copy", classificationState: "unverified", type: null }).label).toBe("Unclassified");
  });
  it("derives the docs section from the URL path", () => {
    expect(docsSection("https://primer.style/product/scenario-patterns/copy/")).toBe("product / scenario-patterns");
    expect(docsSection("https://example.com/x")).toBeNull();
    expect(docsSection("not a url")).toBeNull();
  });
  it("excerpts at word boundaries", () => {
    expect(excerpt("a ".repeat(200), 20)!.endsWith("…")).toBe(true);
    expect(excerpt("short", 20)).toBe("short");
  });
});
