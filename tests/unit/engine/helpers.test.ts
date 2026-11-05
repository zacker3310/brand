import { describe, expect, it } from "vitest";
import { diffPayload } from "@/ingestion/engine/diff";
import { contentHash } from "@/ingestion/engine/hash";
import { interleaveByHost, pool } from "@/ingestion/engine/stages/context";
import { fetchErrorCode, isTransient } from "@/ingestion/engine/stages/fetch";
import { classifyComponent, enforceExampleLicense } from "@/ingestion/engine/stages/promote-components";
import { formatTokenValue, resolveTokenGraph, validateTokenValue } from "@/ingestion/engine/tokens";
import { backoffMs } from "@/ingestion/engine/queue";
import { nextStage } from "@/ingestion/engine/pipeline";
import { COMPONENT_TYPES } from "@/lib/taxonomy";

describe("contentHash", () => {
  it("is key-order independent and ignores retrievedAt/undefined", () => {
    expect(contentHash({ a: 1, b: [1, 2], c: { retrievedAt: "x", d: 1 } })).toBe(contentHash({ c: { d: 1, retrievedAt: "y" }, b: [1, 2], a: 1, e: undefined }));
    expect(contentHash({ b: [1, 2] })).not.toBe(contentHash({ b: [2, 1] }));
  });
});

describe("diffPayload", () => {
  it("summarizes list membership and scalar changes, ignoring evidence", () => {
    const before = { name: "Button", description: "A", variants: [{ axis: "variant", name: "primary" }, { axis: "variant", name: "old" }], evidence: [{ x: 1 }], aliases: ["btn"] };
    const after = { name: "Button", description: "B", variants: [{ axis: "variant", name: "primary" }, { axis: "variant", name: "new" }], evidence: [{ x: 2 }], aliases: ["btn", "push"] };
    const d = diffPayload(before, after);
    expect(d.map((c) => c.field)).toEqual(["aliases", "description", "variants"]);
    expect(d.find((c) => c.field === "description")).toMatchObject({ before: "A", after: "B" });
    expect(d.find((c) => c.field === "variants")!.summary).toBe("variants: +1 (variant:new) -1 (variant:old)");
    expect(d.find((c) => c.field === "aliases")).toMatchObject({ before: ["btn"], after: ["btn", "push"] });
  });
  it("treats reordering as no change and new entities as no diff", () => {
    expect(diffPayload({ states: [{ name: "a" }, { name: "b" }] }, { states: [{ name: "b" }, { name: "a" }] })).toEqual([]);
    expect(diffPayload(null, { a: 1 })).toEqual([]);
  });
});

describe("token helpers (shared token library via engine wrappers)", () => {
  it("resolves alias chains, composites, cycles and missing targets", () => {
    const g = resolveTokenGraph([
      { name: "blue", rawValue: "#00f", references: [] },
      { name: "brand", rawValue: "{blue}", references: ["blue"] },
      { name: "link", rawValue: "{brand}", references: ["brand"] },
      { name: "border", rawValue: "1px solid {brand}", references: ["brand"] },
      { name: "a", rawValue: "{b}", references: ["b"] },
      { name: "b", rawValue: "{a}", references: ["a"] },
      { name: "ghost", rawValue: "{nope}", references: ["nope"] },
      { name: "css", rawValue: "var(--blue-var)", references: ["--blue-var"] },
      { name: "blueVar", rawValue: "#00e", references: [], cssVar: "--blue-var" },
    ]);
    expect(g.get("blue")).toMatchObject({ state: "literal", resolvedValue: "#00f", depth: 0 });
    expect(g.get("link")).toMatchObject({ state: "resolved", resolvedValue: "#00f", depth: 2, chain: ["brand", "blue"] });
    expect(g.get("border")).toMatchObject({ state: "resolved", resolvedValue: "1px solid #00f" });
    expect(g.get("a")!.state).toBe("cycle");
    expect(g.get("b")!.state).toBe("cycle");
    // a direct target missing from the scope is reported as external (never guessed)
    expect(g.get("ghost")).toMatchObject({ state: "external", resolvedValue: null });
    expect(g.get("css")).toMatchObject({ state: "resolved", resolvedValue: "#00e" });
  });

  it("formats composite values", () => {
    expect(formatTokenValue([0.4, 0, 0.2, 1], "cubicBezier")).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
    expect(formatTokenValue({ value: 4, unit: "px" }, "dimension")).toBe("4px");
    expect(formatTokenValue({ offsetX: "0", offsetY: "1px", blur: "2px", spread: "0", color: "#0003" }, "shadow")).toBe("0 1px 2px 0 #0003");
    expect(formatTokenValue({ fontFamily: ["Inter", "sans-serif"], fontSize: "16px", fontWeight: 400, lineHeight: "24px" }, "typography")).toBe("400 16px/24px Inter, sans-serif");
    expect(formatTokenValue(null, "color")).toBeNull();
  });

  it("validates literal values by DTCG type", () => {
    expect(validateTokenValue("#ffffff", "color").valid).toBe(true);
    expect(validateTokenValue("rgb(0 0 0 / 50%)", "color").valid).toBe(true);
    expect(validateTokenValue({ colorSpace: "srgb", components: [1, 0, 0] }, "color").valid).toBe(true);
    expect(validateTokenValue("12px", "color").valid).toBe(false);
    expect(validateTokenValue("1.5rem", "dimension").valid).toBe(true);
    expect(validateTokenValue("big", "dimension").valid).toBe(false);
    expect(validateTokenValue("200ms", "duration").valid).toBe(true);
    expect(validateTokenValue([0, 0, 1], "cubicBezier").valid).toBe(false);
    expect(validateTokenValue(450, "fontWeight").valid).toBe(true);
    expect(validateTokenValue(null, "color").valid).toBe(false);
    expect(validateTokenValue("anything", "mystery").valid).toBe(true);
    expect(validateTokenValue("calc(1px + 2px)", "dimension").valid).toBe(true);
  });
});

describe("classification", () => {
  const known = new Set(COMPONENT_TYPES.map((c) => c.slug));
  const ids = new Map([["button", "id-button"], ["combobox", "id-combobox"]]);
  it("uses adapter-declared types, else the heuristic (inferred)", () => {
    expect(classifyComponent({ name: "Fancy", canonicalType: "combobox", classification: null, aliases: [] }, ids, known)).toMatchObject({ typeId: "id-combobox", state: "inferred", method: "adapter-declared" });
    expect(classifyComponent({ name: "Fancy", canonicalType: "combobox", classification: { state: "verified", method: "m", confidence: 1 }, aliases: [] }, ids, known)).toMatchObject({ state: "verified", method: "m" });
    expect(classifyComponent({ name: "Button", canonicalType: null, classification: null, aliases: [] }, ids, known)).toMatchObject({ typeId: "id-button", state: "inferred", method: "heuristic:alias-exact:button" });
    expect(classifyComponent({ name: "Zorblax", canonicalType: "not-real", classification: null, aliases: [] }, ids, known)).toMatchObject({ typeId: null, state: "unverified", method: null });
  });
  it("strips example code unless redistribution is permitted", () => {
    const c = { examples: [{ slug: "a", title: "A", kind: "code-snippet", code: "<X/>" }] } as never;
    expect(enforceExampleLicense(c, "permitted").stripped).toEqual([]);
    const r = enforceExampleLicense(c, "unknown");
    expect(r.stripped).toEqual(["a"]);
    expect(r.component.examples[0]!.code).toBeNull();
  });
});

describe("fetch error codes", () => {
  it("maps fetch results to stable codes", () => {
    const base = { blockedByRobots: false, error: null, status: 200, ok: true, body: "x" };
    expect(fetchErrorCode({ ...base, blockedByRobots: true, error: "ROBOTS_DISALLOWED", status: 0, ok: false, body: null })).toBe("ROBOTS_DISALLOWED");
    expect(fetchErrorCode({ ...base, error: "TIMEOUT", status: 0, ok: false, body: null })).toBe("TIMEOUT");
    expect(fetchErrorCode({ ...base, error: "BODY_TOO_LARGE", ok: false, body: null })).toBe("BODY_TOO_LARGE");
    expect(fetchErrorCode({ ...base, status: 404, ok: false })).toBe("HTTP_404");
    expect(fetchErrorCode({ ...base, status: 0, ok: false, body: null, error: "ECONNRESET" })).toBe("NETWORK_ECONNRESET");
    expect(isTransient("HTTP_503")).toBe(true);
    expect(isTransient("HTTP_404")).toBe(false);
    expect(isTransient("TIMEOUT")).toBe(true);
  });
});

describe("scheduling helpers", () => {
  it("interleaves by host", () => {
    const urls = ["https://a.test/1", "https://a.test/2", "https://a.test/3", "https://b.test/1", "https://c.test/1"];
    expect(interleaveByHost(urls, (u) => u)).toEqual(["https://a.test/1", "https://b.test/1", "https://c.test/1", "https://a.test/2", "https://a.test/3"]);
  });
  it("pool bounds concurrency and stops after the first error", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await pool(Array.from({ length: 20 }, (_, i) => i), 3, async (i) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      seen.push(i);
      active--;
    });
    expect(peak).toBe(3);
    expect(seen.length).toBe(20);
    const started: number[] = [];
    await expect(
      pool(Array.from({ length: 50 }, (_, i) => i), 2, async (i) => {
        started.push(i);
        if (i === 3) throw new Error("stop");
        await new Promise((r) => setTimeout(r, 1));
      }),
    ).rejects.toThrow("stop");
    expect(started.length).toBeLessThan(10);
  });
  it("stage order and backoff", () => {
    expect(nextStage("run-system")).toBe("discover");
    expect(nextStage("parse")).toBe("publish");
    expect(nextStage("publish")).toBeNull();
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000]);
  });
});
