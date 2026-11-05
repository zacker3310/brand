/**
 * Read models for the Pattern Library. Counts are aggregated in SQL from published records.
 */
import { sql } from "drizzle-orm";
import type { CoverageMap, VerificationState } from "@/lib/contracts";
import type { EvidenceRow } from "@/components/atlas";
import { readDb } from "./db";

export interface PatternTypeSummary {
  slug: string;
  name: string;
  description: string;
  aliases: string[];
  patternCount: number;
  systems: { slug: string; name: string }[];
}

export interface PatternComponentRef {
  slug: string;
  name: string;
  typeSlug: string | null;
  typeName: string | null;
}

export interface PatternRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  docsUrl: string | null;
  coverage: CoverageMap;
  classificationState: VerificationState;
  confidence: number;
  updatedAt: string;
  system: { slug: string; name: string; docsUrl: string | null };
  type: { slug: string; name: string } | null;
  components: PatternComponentRef[];
  /** Latest retrieval time of the pattern's evidence. */
  retrievedAt: string | null;
}

type PatternRaw = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  docs_url: string | null;
  coverage: CoverageMap | null;
  classification_state: VerificationState;
  confidence: number;
  updated_at: string;
  system_slug: string;
  system_name: string;
  system_docs: string | null;
  type_slug: string | null;
  type_name: string | null;
  components: PatternComponentRef[] | null;
  retrieved_at: string | null;
};

const PATTERN_SELECT = sql`
  p.id, p.slug, p.name, p.description, p.docs_url, p.coverage, p.classification_state::text as classification_state, p.confidence,
  p.updated_at::text as updated_at, ds.slug as system_slug, ds.name as system_name, ds.docs_url as system_docs,
  pt.slug as type_slug, pt.name as type_name,
  (select coalesce(json_agg(json_build_object('slug', c.slug, 'name', c.name, 'typeSlug', ct.slug, 'typeName', ct.name) order by c.name), '[]'::json)
     from pattern_component pc join component c on c.id = pc.component_id and c.publish_state = 'published'
     left join component_type ct on ct.id = c.component_type_id
     where pc.pattern_id = p.id) as components,
  (select max(e.retrieved_at)::text from verification_evidence e where e.subject_type = 'pattern' and e.subject_id = p.id) as retrieved_at`;

const PATTERN_FROM = sql`
  from design_pattern p
  join design_system ds on ds.id = p.design_system_id and ds.publish_state = 'published'
  left join pattern_type pt on pt.id = p.pattern_type_id`;

function toRecord(x: PatternRaw): PatternRecord {
  return {
    id: x.id,
    slug: x.slug,
    name: x.name,
    description: x.description,
    docsUrl: x.docs_url,
    coverage: x.coverage ?? {},
    classificationState: x.classification_state,
    confidence: Number(x.confidence),
    updatedAt: x.updated_at,
    system: { slug: x.system_slug, name: x.system_name, docsUrl: x.system_docs },
    type: x.type_slug && x.type_name ? { slug: x.type_slug, name: x.type_name } : null,
    components: x.components ?? [],
    retrievedAt: x.retrieved_at,
  };
}

/** Canonical pattern types with the systems that document each (published patterns only). */
export async function listPatternTypes(): Promise<PatternTypeSummary[]> {
  const db = await readDb();
  const r = await db.execute<{ slug: string; name: string; description: string; aliases: string[]; n: string; systems: { slug: string; name: string }[] | null }>(sql`
    select pt.slug, pt.name, pt.description, pt.aliases, count(p.id) as n,
      (select coalesce(json_agg(distinct jsonb_build_object('slug', ds2.slug, 'name', ds2.name)), '[]'::json)
         from design_pattern p2 join design_system ds2 on ds2.id = p2.design_system_id and ds2.publish_state = 'published'
         where p2.pattern_type_id = pt.id and p2.publish_state = 'published') as systems
    from pattern_type pt
    left join design_pattern p on p.pattern_type_id = pt.id and p.publish_state = 'published'
      and exists (select 1 from design_system ds where ds.id = p.design_system_id and ds.publish_state = 'published')
    group by pt.id
    order by pt.sort_order, pt.name
  `);
  return r.rows.map((x) => ({
    slug: x.slug,
    name: x.name,
    description: x.description,
    aliases: x.aliases ?? [],
    patternCount: Number(x.n),
    systems: (x.systems ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

/** Published patterns not mapped to a canonical type. */
export async function listUnclassifiedPatterns(): Promise<PatternRecord[]> {
  const db = await readDb();
  const r = await db.execute<PatternRaw>(sql`select ${PATTERN_SELECT} ${PATTERN_FROM} where p.publish_state = 'published' and p.pattern_type_id is null order by ds.name, p.name`);
  return r.rows.map(toRecord);
}

/** Library-wide totals for the index header. */
export async function getPatternTotals(): Promise<{ patterns: number; classified: number; systems: number; types: number; typesCovered: number }> {
  const db = await readDb();
  const r = await db.execute<{ patterns: string; classified: string; systems: string; types: string; covered: string }>(sql`
    select count(p.id) as patterns,
      count(p.id) filter (where p.pattern_type_id is not null) as classified,
      count(distinct p.design_system_id) as systems,
      (select count(*) from pattern_type) as types,
      count(distinct p.pattern_type_id) as covered
    from design_pattern p join design_system ds on ds.id = p.design_system_id and ds.publish_state = 'published'
    where p.publish_state = 'published'
  `);
  const x = r.rows[0]!;
  return { patterns: Number(x.patterns), classified: Number(x.classified), systems: Number(x.systems), types: Number(x.types), typesCovered: Number(x.covered) };
}

export async function getPatternType(slug: string): Promise<(Omit<PatternTypeSummary, "patternCount" | "systems"> & { patterns: PatternRecord[] }) | null> {
  const db = await readDb();
  const t = await db.execute<{ id: string; slug: string; name: string; description: string; aliases: string[] }>(sql`
    select id, slug, name, description, aliases from pattern_type where slug = ${slug} limit 1
  `);
  const type = t.rows[0];
  if (!type) return null;
  const r = await db.execute<PatternRaw>(sql`select ${PATTERN_SELECT} ${PATTERN_FROM} where p.publish_state = 'published' and p.pattern_type_id = ${type.id} order by ds.name, p.name`);
  return { slug: type.slug, name: type.name, description: type.description, aliases: type.aliases ?? [], patterns: r.rows.map(toRecord) };
}

/** Published patterns of one system (null when the system is unknown). */
export async function listSystemPatterns(systemSlug: string): Promise<{ system: { slug: string; name: string; docsUrl: string | null; ingestionStatus: string }; patterns: PatternRecord[] } | null> {
  const db = await readDb();
  const s = await db.execute<{ slug: string; name: string; docs_url: string | null; ingestion_status: string }>(sql`
    select slug, name, docs_url, ingestion_status::text as ingestion_status from design_system where slug = ${systemSlug} and publish_state = 'published' limit 1
  `);
  const sys = s.rows[0];
  if (!sys) return null;
  const r = await db.execute<PatternRaw>(sql`select ${PATTERN_SELECT} ${PATTERN_FROM} where p.publish_state = 'published' and ds.slug = ${systemSlug} order by pt.sort_order nulls last, p.name`);
  return { system: { slug: sys.slug, name: sys.name, docsUrl: sys.docs_url, ingestionStatus: sys.ingestion_status }, patterns: r.rows.map(toRecord) };
}

export interface PatternDetail extends PatternRecord {
  evidence: EvidenceRow[];
  /** Same canonical type documented by other systems. */
  siblings: { slug: string; name: string; system: { slug: string; name: string } }[];
}

export async function getSystemPattern(systemSlug: string, patternSlug: string): Promise<PatternDetail | null> {
  const db = await readDb();
  const r = await db.execute<PatternRaw & { pattern_type_id: string | null }>(sql`
    select ${PATTERN_SELECT}, p.pattern_type_id ${PATTERN_FROM}
    where p.publish_state = 'published' and ds.slug = ${systemSlug} and p.slug = ${patternSlug}
    limit 1
  `);
  const x = r.rows[0];
  if (!x) return null;
  const [ev, sib] = await Promise.all([
    db.execute<{
      id: string;
      field: string;
      source_url: string;
      source_title: string | null;
      retrieved_at: string;
      content_hash: string | null;
      extraction_method: string;
      location: string | null;
      excerpt: string | null;
      state: VerificationState;
      confidence: number;
    }>(sql`
      select id, field, source_url, source_title, retrieved_at::text as retrieved_at, content_hash, extraction_method, location, excerpt, state::text as state, confidence
      from verification_evidence where subject_type = 'pattern' and subject_id = ${x.id}
      order by field, retrieved_at desc
    `),
    x.pattern_type_id
      ? db.execute<{ slug: string; name: string; system_slug: string; system_name: string }>(sql`
          select p.slug, p.name, ds.slug as system_slug, ds.name as system_name
          from design_pattern p join design_system ds on ds.id = p.design_system_id and ds.publish_state = 'published'
          where p.pattern_type_id = ${x.pattern_type_id} and p.publish_state = 'published' and p.id <> ${x.id}
          order by ds.name, p.name
        `)
      : Promise.resolve({ rows: [] as { slug: string; name: string; system_slug: string; system_name: string }[] }),
  ]);
  return {
    ...toRecord(x),
    evidence: ev.rows.map((e) => ({
      id: e.id,
      field: e.field,
      sourceUrl: e.source_url,
      sourceTitle: e.source_title,
      retrievedAt: e.retrieved_at,
      contentHash: e.content_hash,
      extractionMethod: e.extraction_method,
      location: e.location,
      excerpt: e.excerpt,
      state: e.state,
      confidence: Number(e.confidence),
    })),
    siblings: sib.rows.map((s) => ({ slug: s.slug, name: s.name, system: { slug: s.system_slug, name: s.system_name } })),
  };
}
