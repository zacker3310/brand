import { describe, expect, it } from "vitest";
import { chunkRows, groupPrefix, groupTokens, pageRowIds, paginateGroups, parseStep, remainderAfter, type IndexRow } from "@/components/tokens/lib/grouping";
import { naturalCompare } from "@/components/tokens/lib/natural";

const row = (name: string, extra: Partial<IndexRow> = {}): IndexRow => ({ id: name, name, path: name.split("."), setId: "s1", aliasState: null, ...extra });

describe("naturalCompare", () => {
  it("orders embedded numbers numerically", () => {
    expect(["neutral.10", "neutral.2", "neutral.1"].sort(naturalCompare)).toEqual(["neutral.1", "neutral.2", "neutral.10"]);
    expect(["blue100", "blue0", "blue20"].sort(naturalCompare)).toEqual(["blue0", "blue20", "blue100"]);
  });
});

describe("prefixes and steps", () => {
  it("caps prefixes at three segments and splits kebab single segments", () => {
    expect(groupPrefix(["base", "color", "blue", "5"], "base.color.blue.5")).toEqual(["base", "color", "blue"]);
    expect(groupPrefix(["md", "comp", "slider", "inactive", "color"], "x")).toEqual(["md", "comp", "slider"]);
    expect(groupPrefix(["layer-active"], "layer-active")).toEqual(["layer"]);
    expect(remainderAfter(["layer"], ["layer-active"], "layer-active")).toEqual(["active"]);
  });
  it("parses numbered steps with families and suffixes", () => {
    expect(parseStep("blue0")).toEqual({ family: "blue", step: 0, raw: "0", suffix: "" });
    expect(parseStep("100Hover")).toEqual({ family: "", step: 100, raw: "100", suffix: "Hover" });
    expect(parseStep("neutral-variant80")).toMatchObject({ family: "neutral-variant", step: 80 });
    expect(parseStep("default")).toBeNull();
  });
});

describe("groupTokens", () => {
  it("detects ramps in color groups and keeps semantic tokens as a list", () => {
    const rows = [
      ...["0", "1", "2", "10"].map((s) => row(`base.color.blue.${s}`)),
      row("base.color.blue.muted", { aliasState: "resolved" }),
      row("fgColor.default", { aliasState: "resolved" }),
      row("fgColor.muted", { aliasState: "resolved" }),
    ];
    const groups = groupTokens(rows, { ramps: true });
    const blue = groups.find((g) => g.label === "base.color.blue")!;
    expect(blue.ramps).toHaveLength(1);
    expect(blue.ramps[0]!.steps.map((s) => s.stepLabel)).toEqual(["0", "1", "2", "10"]);
    expect(blue.list.map((r) => r.name)).toEqual(["base.color.blue.muted"]);
    expect(groups.find((g) => g.label === "fgColor")!.list).toHaveLength(2);
  });
  it("splits families with suffixes into separate ramps, base first", () => {
    const rows = ["10", "20", "30", "10Hover", "20Hover", "30Hover"].map((s) => row(`yellow.${s}`));
    const [g] = groupTokens(rows, { ramps: true });
    expect(g!.ramps.map((r) => r.label)).toEqual(["yellow", "yellow · Hover"]);
  });
  it("never puts theme-dependent tokens in ramps", () => {
    const rows = ["1", "2", "3"].map((s) => row(`x.y.${s}`, { aliasState: "theme-dependent" }));
    const [g] = groupTokens(rows, { ramps: true });
    expect(g!.ramps).toHaveLength(0);
    expect(g!.themed).toHaveLength(3);
  });
  it("coarsens singleton groups into parents and collects the rest in Other", () => {
    const groups = groupTokens([row("a.b.c.d"), row("a.b.x.y"), row("lonely")], {});
    expect(groups.map((g) => g.label)).toEqual(["a.b", "Other"]);
  });
  it("orders by value when requested", () => {
    const rows = [row("s.big", { sortValue: 32 }), row("s.small", { sortValue: 4 }), row("s.unknown", { sortValue: null })];
    const [g] = groupTokens(rows, { order: "value" });
    expect(g!.list.map((r) => r.name)).toEqual(["s.small", "s.big", "s.unknown"]);
  });
  it("groups per set in multi-set scope, following the set order", () => {
    const rows = [row("a.x", { setId: "dark" }), row("a.y", { setId: "dark" }), row("a.x", { id: "2", setId: "light" }), row("a.y", { id: "3", setId: "light" })];
    const groups = groupTokens(rows, { bySet: true, setOrder: ["light", "dark"] });
    expect(groups.map((g) => g.setId)).toEqual(["light", "dark"]);
  });
});

describe("pagination", () => {
  it("packs whole groups and splits oversized ones into parts", () => {
    const rows = Array.from({ length: 25 }, (_, i) => row(`big.t${i}`)).concat([row("small.a"), row("small.b")]);
    const pages = paginateGroups(groupTokens(rows, {}), 10);
    expect(pages.flat().filter((g) => g.label === "big").map((g) => g.part)).toEqual([
      { index: 1, total: 3 },
      { index: 2, total: 3 },
      { index: 3, total: 3 },
    ]);
    expect(pages.map(pageRowIds).flat()).toHaveLength(27);
  });
  it("keeps rows sharing a key together when chunking", () => {
    const rows = ["a.1", "a.2", "a.3", "b.1", "b.2"].map((n) => row(n));
    const chunks = chunkRows(rows, 2, (r) => r.path[0]!);
    expect(chunks.map((c) => c.map((r) => r.name))).toEqual([["a.1", "a.2", "a.3"], ["b.1", "b.2"]]);
  });
});
