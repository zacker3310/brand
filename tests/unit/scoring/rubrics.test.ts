import { describe, expect, it } from "vitest";
import { RUBRIC_DEFINITIONS } from "@/lib/scoring/definitions";
import {
  CORE_COMPONENT_TYPES,
  daysSince,
  fieldTally,
  recencyValue,
  scoreAccessibilityDocs,
  scoreComponentCoverage,
  scoreDocumentationDepth,
  scoreFrameworkCompatibility,
  scoreMaintenance,
  scoreResponsive,
  scoreSourceAvailability,
  scoreSystem,
  scoreTheming,
  scoreTokenArchitecture,
  themeTraits,
} from "@/lib/scoring/rubrics";
import { CRITERIA } from "@/lib/scoring/types";
import { CTX, indexedMetrics, metadataOnlyMetrics } from "./fixtures";

const COMPONENT_DERIVED = ["component-coverage", "accessibility-docs", "token-architecture", "theming", "responsive", "documentation-depth"] as const;

describe("metadata-only systems", () => {
  const m = metadataOnlyMetrics();
  const results = scoreSystem(m, CRITERIA, CTX);

  it("get null (not-indexed) scores for every component/token-derived criterion, with an explanation", () => {
    for (const id of COMPONENT_DERIVED) {
      const r = results.find((x) => x.criterion === id)!;
      expect(r.score, id).toBeNull();
      expect(r.status, id).toBe("not-indexed");
      expect(r.explanation, id).toMatch(/not (indexed|scored)|has not indexed/i);
      expect(r.explanation, id).not.toMatch(/poor|bad|low quality/i);
    }
  });

  it("are still scored on registry facts", () => {
    const src = results.find((x) => x.criterion === "source-availability")!;
    expect(src.score).toBe(0); // proprietary license is a known fact; repo/packages are weak negatives
    expect(src.confidence).toBe("medium");
    const maint = results.find((x) => x.criterion === "maintenance")!;
    expect(maint.score).toBe(100); // status known, release date unknown (excluded, not penalised)
    expect(maint.evidenceCoverage).toBe(0.5);
    expect(maint.confidence).toBe("low");
  });

  it("are insufficient on frameworks when every framework claim is unverified", () => {
    const fw = results.find((x) => x.criterion === "framework-compatibility")!;
    expect(fw.score).toBeNull();
    expect(fw.status).toBe("insufficient");
  });
});

describe("component coverage", () => {
  it("scores the share of the 30 core types", () => {
    const r = scoreComponentCoverage(indexedMetrics(), CTX);
    const covered = indexedMetrics().components.types.filter((t) => (CORE_COMPONENT_TYPES as readonly string[]).includes(t)).length;
    expect(CORE_COMPONENT_TYPES).toHaveLength(30);
    expect(r.score).toBe(Math.round((100 * covered) / 30));
    expect(r.evidenceCoverage).toBe(0.95);
    // mostly inferred classification caps confidence
    expect(r.confidence).toBe("medium");
    expect(r.caps.join(" ")).toMatch(/inferred/);
  });

  it("is insufficient (not zero) for an indexed system with no published components", () => {
    const m = indexedMetrics({ components: { ...indexedMetrics().components, total: 0, classified: 0, types: [] } });
    const r = scoreComponentCoverage(m, CTX);
    expect(r.score).toBeNull();
    expect(r.status).toBe("insufficient");
  });

  it("withholds the score when too few components are classified", () => {
    const m = indexedMetrics({ components: { ...indexedMetrics().components, total: 100, classified: 20, types: ["button"] } });
    expect(scoreComponentCoverage(m, CTX).score).toBeNull();
  });

  it("caps partial ingestion at medium confidence", () => {
    const m = indexedMetrics({ ingestionStatus: "partial", components: { ...indexedMetrics().components, classifiedVerified: 38 } });
    const r = scoreComponentCoverage(m, CTX);
    expect(r.confidence).toBe("medium");
    expect(r.caps.join(" ")).toMatch(/partial/);
  });
});

describe("accessibility documentation", () => {
  it("weights guidance 0.6 and keyboard 0.4 over checked components only", () => {
    const r = scoreAccessibilityDocs(indexedMetrics());
    // guidance 30/35, keyboard 20/30
    expect(r.score).toBe(Math.round(100 * ((0.6 * 30) / 35 + (0.4 * 20) / 30)));
    // coverage: guidance 35/40, keyboard 30/40
    expect(r.evidenceCoverage).toBe(Math.round(100 * (0.6 * (35 / 40) + 0.4 * (30 / 40))) / 100);
    expect(r.explanation).toMatch(/not the accessibility of the implementation/);
  });

  it("does not penalise not-extracted components", () => {
    const base = indexedMetrics();
    const more = indexedMetrics({ components: { ...base.components, total: 60 } });
    expect(scoreAccessibilityDocs(more).score).toBe(scoreAccessibilityDocs(base).score);
    expect(scoreAccessibilityDocs(more).evidenceCoverage).toBeLessThan(scoreAccessibilityDocs(base).evidenceCoverage);
    expect(scoreAccessibilityDocs(more).confidence).toBe("medium");
    // Mostly unextracted: the score is withheld rather than lowered.
    const mostlyUnknown = scoreAccessibilityDocs(indexedMetrics({ components: { ...base.components, total: 400 } }));
    expect(mostlyUnknown.score).toBeNull();
    expect(mostlyUnknown.status).toBe("insufficient");
  });

  it("gives inferred documentation half credit and counts documented-none as documented", () => {
    const m = indexedMetrics({ components: { ...indexedMetrics().components, total: 4, coverage: { accessibility: { inferred: 2, "documented-none": 2 } } } });
    const t = fieldTally(m, "accessibility");
    expect(t).toMatchObject({ documented: 2, inferred: 2, known: 4, notExtracted: 0 });
    const r = scoreAccessibilityDocs(m);
    // guidance: (2 + 1) / 4 = 0.75; keyboard unknown
    expect(r.score).toBe(75);
  });
});

describe("framework compatibility", () => {
  it("counts verified code frameworks (design tools excluded), saturating at 4", () => {
    expect(scoreFrameworkCompatibility(indexedMetrics()).score).toBe(50);
    const many = indexedMetrics({
      frameworks: ["react", "vue", "angular", "svelte", "solid"].map((s) => ({ slug: s, name: s, kind: "web", state: "verified" as const })),
    });
    expect(scoreFrameworkCompatibility(many).score).toBe(100);
  });
  it("is insufficient without framework claims", () => {
    expect(scoreFrameworkCompatibility(indexedMetrics({ frameworks: [] })).status).toBe("insufficient");
  });
  it("lowers confidence, not the score, for unverified claims", () => {
    const m = indexedMetrics({
      frameworks: [
        { slug: "react", name: "React", kind: "web", state: "verified" },
        { slug: "vue", name: "Vue", kind: "web", state: "unverified" },
      ],
    });
    const r = scoreFrameworkCompatibility(m);
    expect(r.score).toBe(25);
    expect(r.evidenceCoverage).toBe(0.5);
    expect(r.confidence).toBe("low");
  });
});

describe("token architecture & theming", () => {
  it("scores tiers, alias layering, integrity and themed sets", () => {
    const r = scoreTokenArchitecture(indexedMetrics());
    // tiers 3/3 (w.4), alias 0.6/0.5 -> 1 (w.3), integrity 1 - 10/600 (w.15), themed 1 (w.15)
    expect(r.score).toBe(Math.round(100 * (0.4 + 0.3 + 0.15 * (1 - 10 / 600) + 0.15)));
    expect(r.confidence).toBe("high");
  });
  it("is not-indexed for metadata-only and insufficient for indexed systems without tokens", () => {
    expect(scoreTokenArchitecture(metadataOnlyMetrics()).status).toBe("not-indexed");
    const noTokens = indexedMetrics({ tokens: metadataOnlyMetrics().tokens });
    expect(scoreTokenArchitecture(noTokens).status).toBe("insufficient");
    expect(scoreTheming(noTokens).status).toBe("insufficient");
  });
  it("caps confidence when tiers are inferred", () => {
    const m = indexedMetrics({ tokens: { ...indexedMetrics().tokens, tierVerified: 10 } });
    expect(scoreTokenArchitecture(m).confidence).toBe("medium");
  });
  it("detects dark and high-contrast themes from labels", () => {
    expect(themeTraits(["light", "dark-high-contrast"])).toEqual({ dark: true, highContrast: true, count: 2 });
    expect(themeTraits(["g100", "white"])).toMatchObject({ dark: true, highContrast: false });
    expect(themeTraits([])).toEqual({ dark: false, highContrast: false, count: 0 });
  });
  it("scores theming with weak negatives and withholds it when no theme is labelled", () => {
    const r = scoreTheming(indexedMetrics());
    expect(r.score).toBe(Math.round(100 * (0.45 + 0 + 0.25 * 0.5)));
    expect(r.confidence).toBe("medium"); // high-contrast "not found" is a weak negative
    const none = scoreTheming(indexedMetrics({ tokens: { ...indexedMetrics().tokens, themedSets: 0, themes: [] } }));
    expect(none.score).toBeNull();
    expect(none.status).toBe("insufficient");
    const full = scoreTheming(indexedMetrics({ tokens: { ...indexedMetrics().tokens, themes: ["light", "dark", "light-high-contrast", "dark-high-contrast"] } }));
    expect(full.score).toBe(100);
    expect(full.confidence).toBe("high");
  });
});

describe("responsive, depth, source, maintenance", () => {
  it("responsive combines layout tokens and guidance", () => {
    const r = scoreResponsive(indexedMetrics());
    expect(r.score).toBe(Math.round((100 * (0.4 * 1 + 0.6 * (4 / 34))) / 1));
  });
  it("documentation depth uses the per-component ratio over checked fields", () => {
    const r = scoreDocumentationDepth(indexedMetrics());
    expect(r.score).toBe(75);
    expect(r.evidenceCoverage).toBe(Math.round((100 * 10) / 12) / 100);
  });
  it("documentation depth is insufficient when fields are mostly not extracted", () => {
    const m = indexedMetrics({ components: { ...indexedMetrics().components, avgKnownFields: 2, avgDocumentedFields: 0.2, avgDepthRatio: 0.1 } });
    expect(scoreDocumentationDepth(m).score).toBeNull();
  });
  it("source availability excludes an unknown license instead of scoring it as closed", () => {
    const m = indexedMetrics({ license: null });
    const r = scoreSourceAvailability(m);
    expect(r.score).toBe(100);
    expect(r.evidenceCoverage).toBe(0.6);
  });
  it("maintenance uses status and release recency as of the given date", () => {
    expect(daysSince("2026-10-30T00:00:00.000Z", CTX.asOf)).toBe(6);
    expect(daysSince(null, CTX.asOf)).toBeNull();
    expect(daysSince("not a date", CTX.asOf)).toBeNull();
    expect([10, 100, 200, 400, 800].map(recencyValue)).toEqual([1, 0.85, 0.65, 0.35, 0.1]);
    expect(scoreMaintenance(indexedMetrics(), CTX).score).toBe(100);
    const old = scoreMaintenance(indexedMetrics({ maintenanceStatus: "maintenance", latestReleaseAt: "2025-06-01T00:00:00.000Z" }), CTX);
    expect(old.score).toBe(Math.round(100 * (0.5 * 0.6 + 0.5 * 0.35)));
    const unknown = scoreMaintenance(indexedMetrics({ maintenanceStatus: "unknown", latestReleaseAt: null }), CTX);
    expect(unknown.score).toBeNull();
  });
});

describe("definitions", () => {
  it("define every criterion with method and caveats", () => {
    for (const c of CRITERIA) {
      const d = RUBRIC_DEFINITIONS[c];
      expect(d.id).toBe(c);
      expect(d.method.length).toBeGreaterThan(0);
      expect(d.caveats.length).toBeGreaterThan(0);
    }
    expect(RUBRIC_DEFINITIONS["component-coverage"].method.join(" ")).toContain(CORE_COMPONENT_TYPES.join(", "));
  });
  it("scoreSystem returns results in the requested order", () => {
    const r = scoreSystem(indexedMetrics(), ["maintenance", "theming"], CTX);
    expect(r.map((x) => x.criterion)).toEqual(["maintenance", "theming"]);
    for (const x of scoreSystem(indexedMetrics(), CRITERIA, CTX)) {
      expect(x.evidenceCoverage).toBeGreaterThanOrEqual(0);
      expect(x.evidenceCoverage).toBeLessThanOrEqual(1);
      if (x.score !== null) expect(x.score).toBeGreaterThanOrEqual(0);
      if (x.score !== null) expect(x.score).toBeLessThanOrEqual(100);
    }
  });
});
