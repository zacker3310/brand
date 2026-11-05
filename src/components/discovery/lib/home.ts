/**
 * Derivation rules for the home page. Pure (unit-tested); the SQL lives in src/server/queries/home.ts.
 * Every rule here is also described in the UI next to the section it drives.
 */
import { buildHref } from "./params";

/* -------------------------------------------------------------------------- */
/* Featured systems                                                            */
/* -------------------------------------------------------------------------- */

export interface FeaturedCandidate {
  slug: string;
  name: string;
  components: number;
  tokens: number;
  patterns: number;
  registryRank: number | null;
}

export const FEATURED_RULE = "Ranked by published components + tokens; ties broken by patterns, then registry rank.";

/** Most deeply indexed systems: published component + token records, systems with none excluded. */
export function pickFeatured<T extends FeaturedCandidate>(rows: T[], limit = 6): T[] {
  return rows
    .filter((r) => r.components + r.tokens + r.patterns > 0)
    .sort(
      (a, b) =>
        b.components + b.tokens - (a.components + a.tokens) ||
        b.patterns - a.patterns ||
        (a.registryRank ?? Number.MAX_SAFE_INTEGER) - (b.registryRank ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Suggested comparisons                                                       */
/* -------------------------------------------------------------------------- */

export interface TypeImplementation {
  typeSlug: string;
  typeName: string;
  group: string;
  typeSortOrder: number;
  /** Systems implementing this canonical type, each with how the classification was made. */
  systems: { slug: string; name: string; registryRank: number | null; verified: number; inferred: number }[];
}

export interface ComparisonSuggestion {
  typeSlug: string;
  typeName: string;
  group: string;
  systems: { slug: string; name: string }[];
  /** Systems implementing the type in total (may exceed the systems linked). */
  systemCount: number;
  /** Whether every linking classification is heuristic (no adapter/source-declared match). */
  allInferred: boolean;
  href: string;
}

export const COMPARISON_MIN_SYSTEMS = 3;
export const COMPARISON_MAX_SYSTEMS = 4;
export const COMPARISON_RULE = `Component types implemented by at least ${COMPARISON_MIN_SYSTEMS} indexed systems, one per component group first, widest coverage first.`;

export function compareHref(typeSlug: string, systems: string[]): string {
  return buildHref("/compare", [
    ["type", typeSlug],
    ["systems", systems],
  ]);
}

/**
 * Pick comparison suggestions: types implemented by >= 3 systems. To keep the list varied the
 * pick is round-robin over component groups (widest-coverage type of each group first).
 */
export function suggestComparisons(types: TypeImplementation[], limit = 6): ComparisonSuggestion[] {
  const eligible = types
    .filter((t) => t.systems.length >= COMPARISON_MIN_SYSTEMS)
    .sort((a, b) => b.systems.length - a.systems.length || a.typeSortOrder - b.typeSortOrder || a.typeSlug.localeCompare(b.typeSlug));
  const byGroup = new Map<string, TypeImplementation[]>();
  for (const t of eligible) byGroup.set(t.group, [...(byGroup.get(t.group) ?? []), t]);
  // group order: the group whose best type has the widest coverage goes first
  const groups = [...byGroup.keys()];
  const picked: TypeImplementation[] = [];
  for (let round = 0; picked.length < limit; round++) {
    let any = false;
    for (const g of groups) {
      const t = byGroup.get(g)?.[round];
      if (!t) continue;
      any = true;
      picked.push(t);
      if (picked.length >= limit) break;
    }
    if (!any) break;
  }
  return picked.map((t) => {
    const systems = [...t.systems]
      .sort((a, b) => (a.registryRank ?? Number.MAX_SAFE_INTEGER) - (b.registryRank ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name))
      .slice(0, COMPARISON_MAX_SYSTEMS);
    return {
      typeSlug: t.typeSlug,
      typeName: t.typeName,
      group: t.group,
      systems: systems.map((s) => ({ slug: s.slug, name: s.name })),
      systemCount: t.systems.length,
      allInferred: systems.every((s) => s.verified === 0),
      href: compareHref(
        t.typeSlug,
        systems.map((s) => s.slug),
      ),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Recent activity                                                             */
/* -------------------------------------------------------------------------- */

export interface ActivityCounts {
  entityType: string;
  changeKind: string;
  count: number;
}

const ENTITY_NOUN: Record<string, [string, string]> = {
  component: ["component", "components"],
  token_set: ["token set", "token sets"],
  pattern: ["pattern", "patterns"],
  design_system: ["system record", "system records"],
  source_document: ["source document", "source documents"],
};

const KIND_VERB: Record<string, string> = {
  created: "added",
  updated: "updated",
  removed: "retired",
  "source-changed": "source changed",
  verified: "verified",
  "status-changed": "status changed",
};

/** "76 components added · 9 token sets added" (largest first, most 3 phrases). */
export function summarizeActivity(counts: ActivityCounts[], max = 3): string[] {
  return [...counts]
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.entityType.localeCompare(b.entityType))
    .slice(0, max)
    .map((c) => {
      const [one, many] = ENTITY_NOUN[c.entityType] ?? [c.entityType.replace(/_/g, " "), `${c.entityType.replace(/_/g, " ")}s`];
      return `${c.count.toLocaleString("en-US")} ${c.count === 1 ? one : many} ${KIND_VERB[c.changeKind] ?? c.changeKind}`;
    });
}

/** Honest library depth label: "4 systems deeply indexed · 96 metadata-level". */
export function depthLabel(indexed: number, partial: number, metadata: number): string {
  const parts = [`${indexed} ${indexed === 1 ? "system" : "systems"} deeply indexed`];
  if (partial > 0) parts.push(`${partial} partial`);
  parts.push(`${metadata} metadata-level`);
  return parts.join(" · ");
}
