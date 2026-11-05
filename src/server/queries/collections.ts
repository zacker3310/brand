/**
 * Collections & bookmarks: read models (readDb) and owner-scoped mutations (getDb).
 *
 * Items reference any entity by (entity_type, entity_id). Every list resolves its references in a
 * single SQL statement (one LEFT JOIN per entity table), so pages never issue N+1 queries. A
 * reference whose record no longer exists, or was retired by ingestion, is returned with
 * `exists: false` / `state: "retired"` and rendered honestly instead of disappearing.
 */
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";
import { bookmarks, collectionItems, collections } from "@/db/schema";
import { componentTypeUrl, componentUrl, patternUrl, systemUrl, tokenUrl } from "@/server/search/documents";
import { CURATED_OWNER } from "@/server/identity";
import { slugify } from "@/lib/utils";
import { ENTITY_TYPES, LIMITS, type CollectionInput, type EntityRef, type EntityType, type ItemInput, type MoveDirection } from "@/components/collections/schema";
import { readDb } from "./db";

export const comparisonUrl = (slug: string) => `/compare/${encodeURIComponent(slug)}`;

export interface ResolvedEntity {
  entityType: EntityType;
  entityId: string;
  /** False when the referenced record is no longer in the index. */
  exists: boolean;
  /** published | retired | quarantined | draft | null (taxonomy and comparisons have no publish state) */
  state: string | null;
  title: string;
  subtitle: string | null;
  systemSlug: string | null;
  systemName: string | null;
  /** ATLAS page for the record. */
  url: string | null;
  /** Official source (docs page, token package file...). Null for ATLAS-authored records. */
  sourceUrl: string | null;
  /** Verification / classification state when the record has one. */
  verification: string | null;
}

export interface CollectionItemView extends ResolvedEntity {
  itemId: string;
  note: string | null;
  tags: string[];
  position: number;
  addedAt: string;
}

export interface CollectionSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isCurated: boolean;
  visibility: string;
  itemCount: number;
  typeCounts: Partial<Record<EntityType, number>>;
  preview: { title: string; systemSlug: string | null; entityType: EntityType }[];
  createdAt: string;
  updatedAt: string;
}

export interface CollectionDetail extends CollectionSummary {
  isOwner: boolean;
  items: CollectionItemView[];
  tags: { tag: string; n: number }[];
}

export interface BookmarkView extends ResolvedEntity {
  bookmarkId: string;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Entity resolution                                                           */
/* -------------------------------------------------------------------------- */

/** LEFT JOINs resolving `${a}.entity_type` / `${a}.entity_id` against every entity table. */
function resolveJoins(a: string): SQL {
  const r = sql.raw;
  return sql`
    left join design_system r_ds on ${r(a)}.entity_type = 'system' and r_ds.id = ${r(a)}.entity_id
    left join component r_c on ${r(a)}.entity_type = 'component' and r_c.id = ${r(a)}.entity_id
    left join component_type r_cct on r_cct.id = r_c.component_type_id
    left join component_type r_ct on ${r(a)}.entity_type = 'component-type' and r_ct.id = ${r(a)}.entity_id
    left join category r_ctg on r_ctg.id = r_ct.category_id
    left join token r_t on ${r(a)}.entity_type = 'token' and r_t.id = ${r(a)}.entity_id
    left join token_set r_ts on r_ts.id = r_t.token_set_id
    left join design_pattern r_p on ${r(a)}.entity_type = 'pattern' and r_p.id = ${r(a)}.entity_id
    left join comparison r_cmp on ${r(a)}.entity_type = 'comparison' and r_cmp.id = ${r(a)}.entity_id
    left join design_system r_sys on r_sys.id = coalesce(r_c.design_system_id, r_t.design_system_id, r_p.design_system_id)
  `;
}

const RESOLVE_COLUMNS = sql`
    coalesce(r_ds.id, r_c.id, r_ct.id, r_t.id, r_p.id, r_cmp.id) is not null as r_exists,
    coalesce(r_ds.publish_state::text, r_c.publish_state::text, r_ts.publish_state::text, r_p.publish_state::text) as r_state,
    coalesce(r_ds.name, r_c.name, r_ct.name, r_t.name, r_p.name, r_cmp.title) as r_title,
    case
      when r_ds.id is not null then r_ds.category::text
      when r_c.id is not null then r_cct.name
      when r_ct.id is not null then r_ctg.name
      when r_t.id is not null then concat_ws(' · ', r_ts.name, r_t.value_text)
      when r_cmp.id is not null then array_to_string(r_cmp.system_slugs, ', ')
      else null
    end as r_subtitle,
    coalesce(r_ds.slug, r_sys.slug) as r_system_slug,
    coalesce(r_ds.name, r_sys.name) as r_system_name,
    coalesce(r_c.slug, r_ct.slug, r_p.slug, r_cmp.slug) as r_slug,
    case
      when r_ds.id is not null then coalesce(r_ds.docs_url, r_ds.homepage_url)
      when r_c.id is not null then r_c.docs_url
      when r_t.id is not null then r_ts.source_url
      when r_p.id is not null then r_p.docs_url
      else null
    end as r_source_url,
    case
      when r_ds.id is not null then r_ds.registry_status::text
      when r_c.id is not null then r_c.classification_state::text
      when r_t.id is not null then r_t.tier_state::text
      when r_p.id is not null then r_p.classification_state::text
      else null
    end as r_verification
`;

type ResolvedRow = {
  entity_type: string;
  entity_id: string;
  r_exists: boolean;
  r_state: string | null;
  r_title: string | null;
  r_subtitle: string | null;
  r_system_slug: string | null;
  r_system_name: string | null;
  r_slug: string | null;
  r_source_url: string | null;
  r_verification: string | null;
};

function urlFor(type: EntityType, row: ResolvedRow): string | null {
  if (!row.r_exists) return null;
  switch (type) {
    case "system":
      return row.r_system_slug ? systemUrl(row.r_system_slug) : null;
    case "component":
      return row.r_system_slug && row.r_slug ? componentUrl(row.r_system_slug, row.r_slug) : null;
    case "component-type":
      return row.r_slug ? componentTypeUrl(row.r_slug) : null;
    case "token":
      return row.r_system_slug && row.r_title ? tokenUrl(row.r_system_slug, row.r_title) : null;
    case "pattern":
      return row.r_system_slug && row.r_slug ? patternUrl(row.r_system_slug, row.r_slug) : null;
    case "comparison":
      return row.r_slug ? comparisonUrl(row.r_slug) : null;
  }
}

function toResolved(row: ResolvedRow): ResolvedEntity {
  const type = (ENTITY_TYPES as readonly string[]).includes(row.entity_type) ? (row.entity_type as EntityType) : "system";
  return {
    entityType: type,
    entityId: row.entity_id,
    exists: !!row.r_exists,
    state: row.r_state,
    title: row.r_title ?? "Record no longer in the index",
    subtitle: row.r_subtitle,
    systemSlug: row.r_system_slug,
    systemName: row.r_system_name,
    url: urlFor(type, row),
    sourceUrl: row.r_source_url,
    verification: row.r_verification,
  };
}

/** `array[$1, $2, ...]::type[]` (drizzle expands bare JS arrays into a parenthesised list). */
export function pgArray(values: string[], type: "text" | "uuid"): SQL {
  return sql`array[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::${sql.raw(type)}[]`;
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

/** Resolve arbitrary references (used to validate additions and by the bookmark status API). */
export async function resolveEntities(refs: EntityRef[], db?: DB): Promise<ResolvedEntity[]> {
  if (!refs.length) return [];
  const d = db ?? (await readDb());
  const types = refs.map((r) => r.entityType);
  const ids = refs.map((r) => r.entityId);
  const res = await d.execute<ResolvedRow>(sql`
    with refs as (select * from unnest(${pgArray(types, "text")}, ${pgArray(ids, "uuid")}) as x(entity_type, entity_id))
    select refs.entity_type, refs.entity_id::text, ${RESOLVE_COLUMNS}
    from refs ${resolveJoins("refs")}
  `);
  return res.rows.map(toResolved);
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

type SummaryRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_curated: boolean;
  visibility: string;
  item_count: number;
  type_counts: Record<string, number> | null;
  preview: { title: string; systemSlug: string | null; entityType: EntityType }[] | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const toSummary = (r: SummaryRow): CollectionSummary => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  description: r.description,
  isCurated: r.is_curated,
  visibility: r.visibility,
  itemCount: Number(r.item_count),
  typeCounts: r.type_counts ?? {},
  preview: r.preview ?? [],
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

/** Collections for one owner with item counts, per-type counts and a 4-item preview, in one query. */
async function summariesFor(ownerId: string, db?: DB): Promise<CollectionSummary[]> {
  const d = db ?? (await readDb());
  const res = await d.execute<SummaryRow>(sql`
    with items as (
      select ci.collection_id, ci.entity_type, ci.entity_id, ci.position, ci.added_at
      from collection_item ci join collection c on c.id = ci.collection_id
      where c.owner_id = ${ownerId}
    ),
    counts as (
      select collection_id, count(*)::int as n, jsonb_object_agg(entity_type, tn) as type_counts
      from (select collection_id, entity_type, count(*)::int as tn from items group by 1, 2) t
      group by collection_id
    ),
    ranked as (
      select items.*, row_number() over (partition by collection_id order by position, added_at) as rn from items
    ),
    preview as (
      select ranked.collection_id,
        jsonb_agg(jsonb_build_object('title', coalesce(r_ds.name, r_c.name, r_ct.name, r_t.name, r_p.name, r_cmp.title, 'Removed record'),
                                     'systemSlug', coalesce(r_ds.slug, r_sys.slug), 'entityType', ranked.entity_type) order by ranked.rn) as preview
      from ranked ${resolveJoins("ranked")}
      where ranked.rn <= 4
      group by ranked.collection_id
    )
    select c.id, c.slug, c.name, c.description, c.is_curated, c.visibility, c.created_at, c.updated_at,
      coalesce(counts.n, 0) as item_count, counts.type_counts, preview.preview
    from collection c
    left join counts on counts.collection_id = c.id
    left join preview on preview.collection_id = c.id
    where c.owner_id = ${ownerId}
    order by c.is_curated, c.updated_at desc, c.name
  `);
  return res.rows.map(toSummary);
}

export async function listOwnerCollections(ownerId: string | null, db?: DB): Promise<CollectionSummary[]> {
  if (!ownerId) return [];
  return summariesFor(ownerId, db);
}

export async function listCuratedCollections(db?: DB): Promise<CollectionSummary[]> {
  return summariesFor(CURATED_OWNER, db);
}

/**
 * A collection by slug as seen by `viewerId`: the viewer's own collection first, then an ATLAS
 * curated collection with that slug. Other owners' private collections are never returned.
 */
export async function getCollection(viewerId: string | null, slug: string, db?: DB): Promise<CollectionDetail | null> {
  const d = db ?? (await readDb());
  const owners = viewerId ? [viewerId, CURATED_OWNER] : [CURATED_OWNER];
  const rows = await d
    .select()
    .from(collections)
    .where(and(eq(collections.slug, slug), inArray(collections.ownerId, owners)))
    .orderBy(desc(sql`${collections.ownerId} = ${viewerId ?? ""}`));
  const c = rows[0];
  if (!c) return null;
  const items = await d.execute<ResolvedRow & { item_id: string; note: string | null; tags: string[]; position: number; added_at: Date | string }>(sql`
    select ci.id::text as item_id, ci.entity_type, ci.entity_id::text, ci.note, ci.tags, ci.position, ci.added_at, ${RESOLVE_COLUMNS}
    from collection_item ci ${resolveJoins("ci")}
    where ci.collection_id = ${c.id}
    order by ci.position, ci.added_at, ci.id
  `);
  const views: CollectionItemView[] = items.rows.map((r) => ({
    ...toResolved(r),
    itemId: r.item_id,
    note: r.note,
    tags: r.tags ?? [],
    position: r.position,
    addedAt: iso(r.added_at),
  }));
  const typeCounts: Partial<Record<EntityType, number>> = {};
  const tagCounts = new Map<string, number>();
  for (const v of views) {
    typeCounts[v.entityType] = (typeCounts[v.entityType] ?? 0) + 1;
    for (const t of v.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    isCurated: c.isCurated,
    visibility: c.visibility,
    itemCount: views.length,
    typeCounts,
    preview: views.slice(0, 4).map((v) => ({ title: v.title, systemSlug: v.systemSlug, entityType: v.entityType })),
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
    isOwner: !!viewerId && c.ownerId === viewerId,
    items: views,
    tags: [...tagCounts].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)),
  };
}

export async function listBookmarks(ownerId: string | null, db?: DB): Promise<BookmarkView[]> {
  if (!ownerId) return [];
  const d = db ?? (await readDb());
  const res = await d.execute<ResolvedRow & { bookmark_id: string; created_at: Date | string }>(sql`
    select b.id::text as bookmark_id, b.entity_type, b.entity_id::text, b.created_at, ${RESOLVE_COLUMNS}
    from bookmark b ${resolveJoins("b")}
    where b.owner_id = ${ownerId}
    order by b.created_at desc
    limit ${LIMITS.bookmarksPerOwner}
  `);
  return res.rows.map((r) => ({ ...toResolved(r), bookmarkId: r.bookmark_id, createdAt: iso(r.created_at) }));
}

export interface EntityMembership {
  bookmarked: boolean;
  collections: { id: string; slug: string; name: string; itemCount: number; contains: boolean; itemId: string | null }[];
}

/** Bookmark state + the owner's collections with whether each contains the entity. One query each. */
export async function entityMembership(ownerId: string | null, ref: EntityRef, db?: DB): Promise<EntityMembership> {
  if (!ownerId) return { bookmarked: false, collections: [] };
  const d = db ?? (await readDb());
  const [b, cols] = await Promise.all([
    d
      .select({ id: bookmarks.id })
      .from(bookmarks)
      .where(and(eq(bookmarks.ownerId, ownerId), eq(bookmarks.entityType, ref.entityType), eq(bookmarks.entityId, ref.entityId)))
      .limit(1),
    d.execute<{ id: string; slug: string; name: string; item_count: number; item_id: string | null }>(sql`
      select c.id, c.slug, c.name,
        (select count(*)::int from collection_item x where x.collection_id = c.id) as item_count,
        (select ci.id::text from collection_item ci where ci.collection_id = c.id and ci.entity_type = ${ref.entityType} and ci.entity_id = ${ref.entityId}::uuid) as item_id
      from collection c where c.owner_id = ${ownerId}
      order by c.updated_at desc
    `),
  ]);
  return {
    bookmarked: b.length > 0,
    collections: cols.rows.map((c) => ({ id: c.id, slug: c.slug, name: c.name, itemCount: Number(c.item_count), contains: !!c.item_id, itemId: c.item_id })),
  };
}

/* -------------------------------------------------------------------------- */
/* Mutations (owner-scoped; every statement filters on owner_id)               */
/* -------------------------------------------------------------------------- */

export class CollectionError extends Error {
  constructor(
    public readonly code: "not_found" | "limit" | "invalid" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "CollectionError";
  }
}

/** Unique slug for an owner, never colliding with a curated slug (curated wins /collections/[slug] for others). */
export async function uniqueSlug(ownerId: string, name: string, db: DB = getDb()): Promise<string> {
  const base = slugify(name).slice(0, 60) || "collection";
  const taken = await db.execute<{ slug: string }>(sql`
    select slug from collection where owner_id in (${ownerId}, ${CURATED_OWNER}) and (slug = ${base} or slug like ${base + "-%"})
  `);
  const set = new Set(taken.rows.map((r) => r.slug));
  if (!set.has(base)) return base;
  for (let i = 2; i < 10_000; i++) if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function createCollection(ownerId: string, input: CollectionInput, db: DB = getDb()): Promise<{ id: string; slug: string }> {
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(collections).where(eq(collections.ownerId, ownerId));
  if (n >= LIMITS.collectionsPerOwner) throw new CollectionError("limit", `You can keep up to ${LIMITS.collectionsPerOwner} collections.`);
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = await uniqueSlug(ownerId, input.name, db);
    const [row] = await db
      .insert(collections)
      .values({ ownerId, slug, name: input.name, description: input.description, visibility: "private", isCurated: false })
      .onConflictDoNothing()
      .returning({ id: collections.id, slug: collections.slug });
    if (row) return row;
  }
  throw new CollectionError("conflict", "Could not allocate a unique collection URL. Try another name.");
}

async function ownedCollection(ownerId: string, collectionId: string, db: DB) {
  const [c] = await db
    .select({ id: collections.id, slug: collections.slug, isCurated: collections.isCurated })
    .from(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.ownerId, ownerId)));
  if (!c) throw new CollectionError("not_found", "That collection does not exist or is not yours.");
  return c;
}

export async function updateCollection(ownerId: string, collectionId: string, input: CollectionInput, db: DB = getDb()) {
  await ownedCollection(ownerId, collectionId, db);
  const [row] = await db
    .update(collections)
    .set({ name: input.name, description: input.description, updatedAt: new Date() })
    .where(and(eq(collections.id, collectionId), eq(collections.ownerId, ownerId)))
    .returning({ id: collections.id, slug: collections.slug });
  return row!;
}

export async function deleteCollection(ownerId: string, collectionId: string, db: DB = getDb()) {
  const rows = await db
    .delete(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.ownerId, ownerId)))
    .returning({ id: collections.id });
  if (!rows.length) throw new CollectionError("not_found", "That collection does not exist or is not yours.");
}

const touch = (db: DB, collectionId: string) => db.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, collectionId));

export async function addItem(ownerId: string, collectionId: string, ref: EntityRef, input: Partial<ItemInput> = {}, db: DB = getDb()) {
  await ownedCollection(ownerId, collectionId, db);
  const [resolved] = await resolveEntities([ref], db);
  if (!resolved?.exists) throw new CollectionError("invalid", "That record is not in the ATLAS index.");
  const [{ n, maxPos } = { n: 0, maxPos: -1 }] = await db
    .select({ n: sql<number>`count(*)::int`, maxPos: sql<number>`coalesce(max(${collectionItems.position}), -1)::int` })
    .from(collectionItems)
    .where(eq(collectionItems.collectionId, collectionId));
  if (n >= LIMITS.itemsPerCollection) throw new CollectionError("limit", `A collection holds up to ${LIMITS.itemsPerCollection} items.`);
  const [row] = await db
    .insert(collectionItems)
    .values({ collectionId, entityType: ref.entityType, entityId: ref.entityId, note: input.note ?? null, tags: input.tags ?? [], position: maxPos + 1 })
    .onConflictDoNothing()
    .returning({ id: collectionItems.id });
  await touch(db, collectionId);
  return { itemId: row?.id ?? null, alreadyPresent: !row, title: resolved.title };
}

/** Item ids are only mutable through their owner's collection. */
async function ownedItem(ownerId: string, itemId: string, db: DB) {
  const [it] = await db
    .select({ id: collectionItems.id, collectionId: collectionItems.collectionId, position: collectionItems.position })
    .from(collectionItems)
    .innerJoin(collections, eq(collections.id, collectionItems.collectionId))
    .where(and(eq(collectionItems.id, itemId), eq(collections.ownerId, ownerId)));
  if (!it) throw new CollectionError("not_found", "That item does not exist or is not yours.");
  return it;
}

export async function removeItem(ownerId: string, itemId: string, db: DB = getDb()) {
  const it = await ownedItem(ownerId, itemId, db);
  await db.delete(collectionItems).where(eq(collectionItems.id, it.id));
  await touch(db, it.collectionId);
  return it.collectionId;
}

export async function removeEntityFromCollection(ownerId: string, collectionId: string, ref: EntityRef, db: DB = getDb()) {
  await ownedCollection(ownerId, collectionId, db);
  await db
    .delete(collectionItems)
    .where(and(eq(collectionItems.collectionId, collectionId), eq(collectionItems.entityType, ref.entityType), eq(collectionItems.entityId, ref.entityId)));
  await touch(db, collectionId);
}

export async function updateItem(ownerId: string, itemId: string, input: ItemInput, db: DB = getDb()) {
  const it = await ownedItem(ownerId, itemId, db);
  await db.update(collectionItems).set({ note: input.note, tags: input.tags }).where(eq(collectionItems.id, it.id));
  await touch(db, it.collectionId);
}

/** Pure: new order of ids after moving `id` in `direction`. */
export function reorder(ids: string[], id: string, direction: MoveDirection): string[] {
  const i = ids.indexOf(id);
  if (i < 0) return ids;
  const out = ids.slice();
  out.splice(i, 1);
  const j = direction === "top" ? 0 : direction === "bottom" ? out.length : direction === "up" ? Math.max(0, i - 1) : Math.min(out.length, i + 1);
  out.splice(j, 0, id);
  return out;
}

export async function moveItem(ownerId: string, itemId: string, direction: MoveDirection, db: DB = getDb()) {
  const it = await ownedItem(ownerId, itemId, db);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from collection where id = ${it.collectionId} for update`);
    const rows = await tx
      .select({ id: collectionItems.id })
      .from(collectionItems)
      .where(eq(collectionItems.collectionId, it.collectionId))
      .orderBy(asc(collectionItems.position), asc(collectionItems.addedAt), asc(collectionItems.id));
    const order = reorder(
      rows.map((r) => r.id),
      it.id,
      direction,
    );
    if (!order.length) return;
    await tx.execute(sql`
      update collection_item ci set position = (o.pos - 1)::int
      from unnest(${pgArray(order, "uuid")}) with ordinality as o(id, pos)
      where ci.id = o.id and ci.collection_id = ${it.collectionId} and ci.position is distinct from (o.pos - 1)::int
    `);
    await tx.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, it.collectionId));
  });
  return it.collectionId;
}

export async function toggleBookmark(ownerId: string, ref: EntityRef, want?: boolean, db: DB = getDb()): Promise<{ bookmarked: boolean }> {
  const [existing] = await db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(and(eq(bookmarks.ownerId, ownerId), eq(bookmarks.entityType, ref.entityType), eq(bookmarks.entityId, ref.entityId)));
  const target = want ?? !existing;
  if (!target) {
    if (existing) await db.delete(bookmarks).where(eq(bookmarks.id, existing.id));
    return { bookmarked: false };
  }
  if (existing) return { bookmarked: true };
  const [resolved] = await resolveEntities([ref], db);
  if (!resolved?.exists) throw new CollectionError("invalid", "That record is not in the ATLAS index.");
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(bookmarks).where(eq(bookmarks.ownerId, ownerId));
  if (n >= LIMITS.bookmarksPerOwner) throw new CollectionError("limit", `You can keep up to ${LIMITS.bookmarksPerOwner} bookmarks.`);
  await db.insert(bookmarks).values({ ownerId, entityType: ref.entityType, entityId: ref.entityId }).onConflictDoNothing();
  return { bookmarked: true };
}
