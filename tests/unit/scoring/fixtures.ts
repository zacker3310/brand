import type { SystemMetrics } from "@/lib/scoring/types";

/** A richly indexed system (numbers modelled on real ATLAS aggregates, not copied). */
export function indexedMetrics(over: Partial<SystemMetrics> = {}): SystemMetrics {
  return {
    slug: "alpha",
    name: "Alpha DS",
    ingestionStatus: "indexed",
    frameworks: [
      { slug: "react", name: "React", kind: "web", state: "verified" },
      { slug: "web-components", name: "Web Components", kind: "web", state: "verified" },
      { slug: "figma", name: "Figma", kind: "design", state: "unverified" },
    ],
    repositoryUrl: "https://github.com/example/alpha",
    license: { slug: "mit", name: "MIT License", spdxId: "MIT", isOpenSource: true },
    packageCount: 3,
    maintenanceStatus: "active",
    latestReleaseAt: "2026-10-30T00:00:00.000Z",
    latestVersion: "4.2.0",
    components: {
      total: 40,
      classified: 38,
      classifiedVerified: 2,
      types: ["button", "icon-button", "link", "text-field", "checkbox", "radio", "switch", "select", "tabs", "menu", "dialog", "tooltip", "card", "tag", "badge", "alert", "toast", "table", "list", "accordion", "stack", "grid"],
      coverage: {
        accessibility: { documented: 30, "not-documented": 5 },
        keyboard: { documented: 20, "not-documented": 10 },
        responsive: { documented: 4, "not-documented": 30 },
      },
      avgDocumentedFields: 7.5,
      avgKnownFields: 10,
      avgDepthRatio: 0.75,
      fieldCount: 12,
    },
    tokens: {
      total: 1000,
      primitive: 300,
      semantic: 500,
      component: 150,
      untiered: 50,
      tierVerified: 900,
      aliases: 600,
      aliasResolved: 580,
      aliasExternal: 10,
      aliasBroken: 10,
      layout: 12,
      breakpointNamed: 0,
      sets: 6,
      themedSets: 2,
      themes: ["dark", "light"],
    },
    evidence: 500,
    ...over,
  };
}

/** A system ATLAS only knows from verified registry facts. */
export function metadataOnlyMetrics(over: Partial<SystemMetrics> = {}): SystemMetrics {
  return {
    slug: "beta",
    name: "Beta Guidelines",
    ingestionStatus: "metadata_only",
    frameworks: [{ slug: "swiftui", name: "SwiftUI", kind: "native", state: "unverified" }],
    repositoryUrl: null,
    license: { slug: "proprietary", name: "Proprietary", spdxId: null, isOpenSource: false },
    packageCount: 0,
    maintenanceStatus: "active",
    latestReleaseAt: null,
    latestVersion: null,
    components: { total: 0, classified: 0, classifiedVerified: 0, types: [], coverage: {}, avgDocumentedFields: null, avgKnownFields: null, avgDepthRatio: null, fieldCount: 12 },
    tokens: {
      total: 0,
      primitive: 0,
      semantic: 0,
      component: 0,
      untiered: 0,
      tierVerified: 0,
      aliases: 0,
      aliasResolved: 0,
      aliasExternal: 0,
      aliasBroken: 0,
      layout: 0,
      breakpointNamed: 0,
      sets: 0,
      themedSets: 0,
      themes: [],
    },
    evidence: 5,
    ...over,
  };
}

export const CTX = { asOf: new Date("2026-11-05T00:00:00.000Z"), taxonomySize: 113 };
