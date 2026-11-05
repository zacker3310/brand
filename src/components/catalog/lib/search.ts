import { COMPONENT_TYPES, SEARCH_SYNONYMS, normalizeName } from "@/lib/taxonomy";

const TYPE_SLUGS = new Set(COMPONENT_TYPES.map((t) => t.slug));

export interface QueryExpansion {
  /** Canonical type slugs whose implementations also match the query (labelled as expansion in the UI). */
  typeSlugs: string[];
  /** Human-readable reason per expanded type, e.g. "snackbar → Toast (alias)". */
  reasons: { slug: string; name: string; via: "alias" | "synonym" }[];
}

/**
 * Expands a catalog query to canonical types. Expansion only, never collapsing: a query for
 * "snackbar" also surfaces implementations ATLAS mapped to Toast, while result rows keep their
 * system-specific names. Exact alias matches and the curated SEARCH_SYNONYMS table are used;
 * nothing fuzzy, so expansions stay explainable.
 */
export function expandCatalogQuery(q: string): QueryExpansion {
  const n = normalizeName(q);
  if (!n) return { typeSlugs: [], reasons: [] };
  const reasons: QueryExpansion["reasons"] = [];
  const seen = new Set<string>();
  const add = (slug: string, via: "alias" | "synonym") => {
    if (seen.has(slug) || !TYPE_SLUGS.has(slug)) return;
    seen.add(slug);
    reasons.push({ slug, name: COMPONENT_TYPES.find((t) => t.slug === slug)?.name ?? slug, via });
  };
  for (const t of COMPONENT_TYPES) {
    if (normalizeName(t.name) === n || t.slug === n.replace(/ /g, "-")) continue; // direct name match: not an expansion
    if (t.aliases.some((a) => normalizeName(a) === n)) add(t.slug, "alias");
  }
  const syn = SEARCH_SYNONYMS[q.trim().toLowerCase()] ?? SEARCH_SYNONYMS[n];
  if (syn) for (const s of syn) add(s, "synonym");
  return { typeSlugs: [...seen], reasons };
}
