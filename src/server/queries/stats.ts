import { sql } from "drizzle-orm";
import { readDb } from "./db";

export interface CatalogStats {
  systemsVerified: number;
  systemsIndexed: number;
  registryCandidates: number;
  components: number;
  componentTypesCovered: number;
  tokens: number;
  patterns: number;
  evidence: number;
  sources: number;
  lastIngestedAt: string | null;
}

/** Library statistics derived from actual indexed records (never hard-coded). */
export async function getCatalogStats(): Promise<CatalogStats> {
  const db = await readDb();
  const r = await db.execute<{
    systems_verified: string;
    systems_indexed: string;
    registry_candidates: string;
    components: string;
    component_types_covered: string;
    tokens: string;
    patterns: string;
    evidence: string;
    sources: string;
    last_ingested_at: string | null;
  }>(sql`
    select
      (select count(*) from design_system where registry_status = 'verified' and publish_state = 'published') as systems_verified,
      (select count(*) from design_system where ingestion_status in ('indexed','partial','inventory')) as systems_indexed,
      (select count(*) from design_system where registry_rank is not null) as registry_candidates,
      (select count(*) from component where publish_state = 'published') as components,
      (select count(distinct component_type_id) from component where publish_state = 'published' and component_type_id is not null) as component_types_covered,
      (select count(*) from token t join token_set s on s.id = t.token_set_id where s.publish_state = 'published') as tokens,
      (select count(*) from design_pattern where publish_state = 'published') as patterns,
      (select count(*) from verification_evidence) as evidence,
      (select count(*) from source) as sources,
      (select max(last_ingested_at)::text from design_system) as last_ingested_at
  `);
  const row = r.rows[0]!;
  return {
    systemsVerified: Number(row.systems_verified),
    systemsIndexed: Number(row.systems_indexed),
    registryCandidates: Number(row.registry_candidates),
    components: Number(row.components),
    componentTypesCovered: Number(row.component_types_covered),
    tokens: Number(row.tokens),
    patterns: Number(row.patterns),
    evidence: Number(row.evidence),
    sources: Number(row.sources),
    lastIngestedAt: row.last_ingested_at,
  };
}
