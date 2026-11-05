import { describe, expect, it } from "vitest";
import { combine, confidenceFor, minConfidence, pct } from "@/lib/scoring/signals";
import type { RubricInput } from "@/lib/scoring/types";

const input = (over: Partial<RubricInput>): RubricInput => ({
  key: "k",
  label: "k",
  display: "",
  value: 1,
  coverage: 1,
  weight: 1,
  source: "components",
  ...over,
});
const explain = ({ score }: { score: number | null }) => `score=${score}`;

describe("confidenceFor / minConfidence / pct", () => {
  it("maps evidence coverage to confidence bands", () => {
    expect(confidenceFor(1)).toBe("high");
    expect(confidenceFor(0.8)).toBe("high");
    expect(confidenceFor(0.79)).toBe("medium");
    expect(confidenceFor(0.55)).toBe("medium");
    expect(confidenceFor(0.54)).toBe("low");
    expect(confidenceFor(0.35)).toBe("low");
    expect(confidenceFor(0.34)).toBe("insufficient");
    expect(confidenceFor(0)).toBe("insufficient");
  });
  it("takes the lower confidence", () => {
    expect(minConfidence("high", "medium")).toBe("medium");
    expect(minConfidence("low", "high")).toBe("low");
    expect(minConfidence("insufficient", "high")).toBe("insufficient");
  });
  it("formats shares without dividing by zero", () => {
    expect(pct(1, 4)).toBe("25%");
    expect(pct(3, 0)).toBe("n/a");
  });
});

describe("combine", () => {
  it("scores only over known inputs: an unknown input never lowers the score", () => {
    const r = combine("documentation-depth", [input({ value: 0.8, weight: 0.5 }), input({ key: "u", value: null, weight: 0.5 })], { explain });
    expect(r.score).toBe(80);
    expect(r.evidenceCoverage).toBe(0.5);
    expect(r.confidence).toBe("low");
    expect(r.status).toBe("scored");
  });

  it("withholds the score below the low-confidence threshold", () => {
    const r = combine("documentation-depth", [input({ value: 0.1, coverage: 0.2 })], { explain });
    expect(r.score).toBeNull();
    expect(r.status).toBe("insufficient");
    expect(r.confidence).toBe("insufficient");
    expect(r.evidenceCoverage).toBe(0.2);
    expect(r.explanation).toBe("score=null");
  });

  it("is insufficient when nothing is known", () => {
    const r = combine("theming", [input({ value: null }), input({ value: null })], { explain });
    expect(r.score).toBeNull();
    expect(r.status).toBe("insufficient");
  });

  it("never publishes a score resting only on weak negatives (absence in partial data)", () => {
    const r = combine("theming", [input({ value: 0, coverage: 0.5 }), input({ value: 0, coverage: 0.5 })], { explain });
    expect(r.score).toBeNull();
    expect(r.status).toBe("insufficient");
    expect(r.caps.join(" ")).toMatch(/absence/);
  });

  it("caps confidence at medium when part of the score rests on a weak negative", () => {
    const r = combine("theming", [input({ value: 1, coverage: 1, weight: 0.8 }), input({ value: 0, coverage: 0.5, weight: 0.2 })], { explain });
    expect(r.evidenceCoverage).toBe(0.9);
    expect(r.confidence).toBe("medium");
    expect(r.score).toBe(80);
    expect(r.caps.length).toBe(1);
  });

  it("applies explicit caps and records the reason only when they bite", () => {
    const capped = combine("component-coverage", [input({})], { explain, caps: [{ max: "medium", reason: "inferred" }, null, false] });
    expect(capped.confidence).toBe("medium");
    expect(capped.caps).toEqual(["inferred"]);
    const notBiting = combine("component-coverage", [input({ coverage: 0.6 })], { explain, caps: [{ max: "medium", reason: "inferred" }] });
    expect(notBiting.confidence).toBe("medium");
    expect(notBiting.caps).toEqual([]);
  });

  it("ignores zero-weight (informational) inputs for score and coverage", () => {
    const r = combine("component-coverage", [input({ value: 0.5 }), input({ key: "info", value: null, weight: 0 })], { explain });
    expect(r.score).toBe(50);
    expect(r.evidenceCoverage).toBe(1);
  });

  it("clamps out-of-range values and treats NaN as unknown", () => {
    const r = combine("maintenance", [input({ value: 1.7 }), input({ key: "n", value: Number.NaN })], { explain });
    expect(r.score).toBe(100);
    expect(r.inputs[1]!.value).toBeNull();
    expect(r.inputs[1]!.coverage).toBe(0);
  });

  it("marks not-indexed results without a score", () => {
    const r = combine("component-coverage", [input({})], { explain, notIndexed: true });
    expect(r).toMatchObject({ score: null, status: "not-indexed", confidence: "insufficient", evidenceCoverage: 0 });
  });
});
