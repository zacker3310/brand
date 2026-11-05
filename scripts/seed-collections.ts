/**
 * npm-less: npx tsx scripts/seed-collections.ts [--dry-run] [--json]
 *
 * Builds the ATLAS curated collections (owner "atlas", is_curated = true) from data-derived rules
 * only. Each collection's description states its rule so the page can show it verbatim; nothing
 * is hand-picked. Idempotent: membership is diffed against the database and an unchanged run
 * writes nothing (updated_at only moves when the name, rule or membership changed).
 */
import { pathToFileURL } from "node:url";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { closeDb, getDb, type DB } from "../src/db/client";
import { collectionItems, collections } from "../src/db/schema";

export const CURATED_OWNER = "atlas";

export interface CuratedDefinition {
  slug: string;
  name: string;
  /** Shown to users verbatim: states the membership rule and its provenance. */
  description: string;
  /** Returns design_system ids, in display order. */
  members: SQL;
}

const VERIFIED = sql`ds.registry_status = 'verified' and ds.publish_state = 'published'`;

export const CURATED_DEFINITIONS: CuratedDefinition[] = [
  {
    slug: "government-and-public-sector",
    name: "Government & public sector design systems",
    description:
      "Rule: verified systems carrying the registry tag “government” or “public-sector”. Tags are assigned during ATLAS registry research and are inferred, not claims made by the systems.",
    members: sql`
      select ds.id from design_system ds
      where ${VERIFIED} and exists (
        select 1 from design_system_tag x join tag t on t.id = x.tag_id
        where x.design_system_id = ds.id and t.slug in ('government', 'public-sector'))
      order by lower(ds.name)`,
  },
  {
    slug: "headless-and-primitive-libraries",
    name: "Headless & primitive libraries",
    description: "Rule: verified systems whose registry category is “headless-library”: unstyled, behaviour-first primitives. The category comes from ATLAS registry research.",
    members: sql`select ds.id from design_system ds where ${VERIFIED} and ds.category = 'headless-library' order by lower(ds.name)`,
  },
  {
    slug: "deeply-indexed-systems",
    name: "Deeply indexed systems",
    description:
      "Rule: systems whose most recent ingestion published component, token or pattern records (ingestion status “indexed”). Systems indexed at metadata level only are excluded. Membership grows as more systems are ingested.",
    members: sql`select ds.id from design_system ds where ${VERIFIED} and ds.ingestion_status = 'indexed' order by lower(ds.name)`,
  },
  {
    slug: "web-components-implementations",
    name: "Web components implementations",
    description: "Rule: verified systems whose registry category is “web-components”: implementations shipped as custom elements. The category comes from ATLAS registry research.",
    members: sql`select ds.id from design_system ds where ${VERIFIED} and ds.category = 'web-components' order by lower(ds.name)`,
  },
  {
    slug: "systems-with-official-design-tokens",
    name: "Systems with official design tokens",
    description:
      "Rule: systems with at least one published token set that ATLAS ingested from the system’s own package or repository. Systems that publish tokens ATLAS has not ingested yet are not included.",
    members: sql`
      select ds.id from design_system ds
      where ${VERIFIED} and exists (select 1 from token_set s where s.design_system_id = ds.id and s.publish_state = 'published')
      order by lower(ds.name)`,
  },
];

export interface SyncReport {
  slug: string;
  members: number;
  added: number;
  removed: number;
  reordered: number;
  created: boolean;
  changed: boolean;
}

export async function syncCuratedCollections(db: DB = getDb(), opts: { dryRun?: boolean; definitions?: CuratedDefinition[] } = {}): Promise<SyncReport[]> {
  const reports: SyncReport[] = [];
  for (const def of opts.definitions ?? CURATED_DEFINITIONS) {
    const desired = (await db.execute<{ id: string }>(def.members)).rows.map((r) => r.id);
    const report = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(collections).where(and(eq(collections.ownerId, CURATED_OWNER), eq(collections.slug, def.slug)));
      const current = existing
        ? await tx
            .select({ id: collectionItems.id, entityId: collectionItems.entityId, position: collectionItems.position, entityType: collectionItems.entityType })
            .from(collectionItems)
            .where(eq(collectionItems.collectionId, existing.id))
        : [];
      const currentSystems = new Map(current.filter((c) => c.entityType === "system").map((c) => [c.entityId, c]));
      const desiredSet = new Set(desired);
      const toRemove = current.filter((c) => c.entityType !== "system" || !desiredSet.has(c.entityId));
      const toAdd = desired.filter((id) => !currentSystems.has(id));
      const reorder = desired.filter((id, pos) => currentSystems.has(id) && currentSystems.get(id)!.position !== pos);
      const metaChanged = !existing || existing.name !== def.name || existing.description !== def.description || !existing.isCurated || existing.visibility !== "public";
      const changed = metaChanged || toRemove.length > 0 || toAdd.length > 0 || reorder.length > 0;
      const r: SyncReport = { slug: def.slug, members: desired.length, added: toAdd.length, removed: toRemove.length, reordered: reorder.length, created: !existing, changed };
      if (opts.dryRun || !changed) return r;

      let collectionId = existing?.id;
      if (!collectionId) {
        const [row] = await tx
          .insert(collections)
          .values({ ownerId: CURATED_OWNER, slug: def.slug, name: def.name, description: def.description, visibility: "public", isCurated: true })
          .returning({ id: collections.id });
        collectionId = row!.id;
      } else {
        await tx
          .update(collections)
          .set({ name: def.name, description: def.description, visibility: "public", isCurated: true, updatedAt: new Date() })
          .where(eq(collections.id, collectionId));
      }
      if (toRemove.length) await tx.delete(collectionItems).where(inArray(collectionItems.id, toRemove.map((c) => c.id)));
      for (const [pos, id] of desired.entries()) {
        const cur = currentSystems.get(id);
        if (!cur) await tx.insert(collectionItems).values({ collectionId, entityType: "system", entityId: id, position: pos, tags: [] }).onConflictDoNothing();
        else if (cur.position !== pos) await tx.update(collectionItems).set({ position: pos }).where(eq(collectionItems.id, cur.id));
      }
      return r;
    });
    reports.push(report);
  }
  // Definitions removed from the code are removed from the database (curated owner only).
  if (!opts.dryRun && !opts.definitions) {
    const keep = CURATED_DEFINITIONS.map((d) => d.slug);
    await db.execute(sql`delete from collection where owner_id = ${CURATED_OWNER} and is_curated and not (slug = any(${sql.raw(`array[${keep.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")}]`)}::text[]))`);
  }
  return reports;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const reports = await syncCuratedCollections(getDb(), { dryRun });
  if (process.argv.includes("--json")) console.log(JSON.stringify(reports, null, 2));
  else {
    console.log(`curated collections${dryRun ? " (dry run)" : ""}:`);
    for (const r of reports)
      console.log(`  ${r.slug.padEnd(38)} members ${String(r.members).padStart(3)}  +${r.added} -${r.removed} ~${r.reordered}${r.created ? "  created" : ""}${r.changed ? "" : "  unchanged"}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
