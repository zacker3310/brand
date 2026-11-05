/**
 * Reference data seed from the ATLAS taxonomy (src/lib/taxonomy): categories, component types,
 * pattern types, frameworks and platforms. Idempotent: rows are upserted and only rewritten when
 * a value actually differs.
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";
import { categories, componentTypes, frameworks, patternTypes, platforms } from "@/db/schema";
import * as taxonomy from "@/lib/taxonomy";

export interface UpsertCounts {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface ReferenceReport {
  categories: UpsertCounts;
  componentTypes: UpsertCounts;
  patternTypes: UpsertCounts;
  frameworks: UpsertCounts;
  platforms: UpsertCounts;
  notes: string[];
}

const counts = (total: number, rows: { inserted: boolean }[]): UpsertCounts => {
  const inserted = rows.filter((r) => r.inserted).length;
  return { inserted, updated: rows.length - inserted, unchanged: total - rows.length };
};

/** `(a, b, c) is distinct from (excluded.a, excluded.b, excluded.c)` for the given column names. */
const distinct = (table: string, cols: string[]): SQL => sql.raw(`(${cols.map((c) => `"${table}"."${c}"`).join(", ")}) is distinct from (${cols.map((c) => `excluded."${c}"`).join(", ")})`);
const excluded = (cols: Record<string, string>) => Object.fromEntries(Object.entries(cols).map(([k, c]) => [k, sql.raw(`excluded."${c}"`)]));

interface PatternGroupDef {
  slug: string;
  name: string;
  description: string;
}

export async function seedReferenceData(db: DB = getDb()): Promise<ReferenceReport> {
  const notes: string[] = [];
  const insertedFlag = sql<boolean>`(xmax = 0)`;

  const groups = taxonomy.COMPONENT_GROUPS.map((g, i) => ({ slug: g.slug, kind: "component-group", name: g.name, description: g.description, sortOrder: i }));
  const patternGroups = ((taxonomy as Record<string, unknown>).PATTERN_GROUPS as PatternGroupDef[] | undefined) ?? [];
  if (!patternGroups.length) notes.push("taxonomy defines no PATTERN_GROUPS; no 'pattern-group' categories seeded");
  const pgroups = patternGroups.map((g, i) => ({ slug: g.slug, kind: "pattern-group", name: g.name, description: g.description ?? null, sortOrder: i }));
  const catRows = [...groups, ...pgroups];
  const catRes = await db
    .insert(categories)
    .values(catRows)
    .onConflictDoUpdate({
      target: [categories.kind, categories.slug],
      set: excluded({ name: "name", description: "description", sortOrder: "sort_order" }),
      setWhere: distinct("category", ["name", "description", "sort_order"]),
    })
    .returning({ id: categories.id, inserted: insertedFlag });

  const cats = await db.select({ id: categories.id, slug: categories.slug, kind: categories.kind }).from(categories);
  const groupId = new Map(cats.filter((c) => c.kind === "component-group").map((c) => [c.slug, c.id]));
  const ctRows = taxonomy.COMPONENT_TYPES.map((t, i) => {
    const categoryId = groupId.get(t.group);
    if (!categoryId) throw new Error(`component type ${t.slug} references unknown group ${t.group}`);
    return { slug: t.slug, name: t.name, categoryId, description: t.description, aliases: t.aliases, nearSynonyms: t.nearSynonyms, ariaPattern: t.ariaPattern ?? null, sortOrder: i };
  });
  const ctRes = await db
    .insert(componentTypes)
    .values(ctRows)
    .onConflictDoUpdate({
      target: componentTypes.slug,
      set: excluded({ name: "name", categoryId: "category_id", description: "description", aliases: "aliases", nearSynonyms: "near_synonyms", ariaPattern: "aria_pattern", sortOrder: "sort_order" }),
      setWhere: distinct("component_type", ["name", "category_id", "description", "aliases", "near_synonyms", "aria_pattern", "sort_order"]),
    })
    .returning({ id: componentTypes.id, inserted: insertedFlag });

  const ptRows = taxonomy.PATTERN_TYPES.map((p, i) => ({ slug: p.slug, name: p.name, description: p.description, aliases: p.aliases, sortOrder: i }));
  const ptRes = await db
    .insert(patternTypes)
    .values(ptRows)
    .onConflictDoUpdate({
      target: patternTypes.slug,
      set: excluded({ name: "name", description: "description", aliases: "aliases", sortOrder: "sort_order" }),
      setWhere: distinct("pattern_type", ["name", "description", "aliases", "sort_order"]),
    })
    .returning({ id: patternTypes.id, inserted: insertedFlag });

  const fwRows = taxonomy.FRAMEWORKS.map((f) => ({ slug: f.slug, name: f.name, kind: f.kind, websiteUrl: f.websiteUrl }));
  const fwRes = await db
    .insert(frameworks)
    .values(fwRows)
    .onConflictDoUpdate({ target: frameworks.slug, set: excluded({ name: "name", kind: "kind", websiteUrl: "website_url" }), setWhere: distinct("framework", ["name", "kind", "website_url"]) })
    .returning({ id: frameworks.id, inserted: insertedFlag });

  const plRows = taxonomy.PLATFORMS.map((p) => ({ slug: p.slug, name: p.name }));
  const plRes = await db
    .insert(platforms)
    .values(plRows)
    .onConflictDoUpdate({ target: platforms.slug, set: excluded({ name: "name" }), setWhere: distinct("platform", ["name"]) })
    .returning({ id: platforms.id, inserted: insertedFlag });

  return {
    categories: counts(catRows.length, catRes),
    componentTypes: counts(ctRows.length, ctRes),
    patternTypes: counts(ptRows.length, ptRes),
    frameworks: counts(fwRows.length, fwRes),
    platforms: counts(plRows.length, plRes),
    notes,
  };
}
