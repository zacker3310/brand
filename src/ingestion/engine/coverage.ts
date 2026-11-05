/**
 * Derived per-system coverage counts (design_system.coverage). Pure aggregation over canonical
 * tables; never estimates.
 */
import { sql } from "drizzle-orm";
import type { SystemCoverageSummary, TokenCategory } from "@/lib/contracts";
import type { DB } from "@/db/client";
import type { Tx } from "./evidence";

type Exec = DB | Tx;

export async function computeSystemCoverage(db: Exec, systemId: string): Promise<SystemCoverageSummary> {
  const res = await db.execute(sql`
    with c as (select id, component_type_id from component where design_system_id = ${systemId} and publish_state = 'published')
    select
      (select count(*) from c)::int as components,
      (select count(*) from c where component_type_id is not null)::int as classified,
      (select count(*) from c where exists (select 1 from component_variant v where v.component_id = c.id))::int as with_variants,
      (select count(*) from c where exists (select 1 from component_property p where p.component_id = c.id))::int as with_props,
      (select count(*) from c where exists (select 1 from component_accessibility a where a.component_id = c.id))::int as with_a11y,
      (select count(*) from token t join token_set s on s.id = t.token_set_id where s.design_system_id = ${systemId} and s.publish_state = 'published')::int as tokens,
      (select count(*) from token_set s where s.design_system_id = ${systemId} and s.publish_state = 'published')::int as token_sets,
      (select count(*) from design_pattern p where p.design_system_id = ${systemId} and p.publish_state = 'published')::int as patterns,
      ((select count(*) from source_document d where d.design_system_id = ${systemId} and d.status <> 'gone' and d.last_status is not null)
        + (select count(*) from source s where s.design_system_id = ${systemId} and s.last_checked_at is not null))::int as sources_checked,
      ((select count(*) from source_document d where d.design_system_id = ${systemId} and d.status = 'active' and d.last_status between 200 and 399)
        + (select count(*) from source s where s.design_system_id = ${systemId} and s.last_checked_at is not null and s.last_status between 200 and 399))::int as sources_ok,
      (select count(*) from verification_evidence e where e.design_system_id = ${systemId})::int as evidence
  `);
  const r = res.rows[0] as Record<string, number>;
  const cats = await db.execute(sql`
    select t.category::text as category, count(*)::int as n from token t join token_set s on s.id = t.token_set_id
    where s.design_system_id = ${systemId} and s.publish_state = 'published' group by t.category order by t.category`);
  const tokenCategories: Partial<Record<TokenCategory, number>> = {};
  for (const row of cats.rows as { category: TokenCategory; n: number }[]) tokenCategories[row.category] = row.n;
  return {
    components: r.components ?? 0,
    componentsClassified: r.classified ?? 0,
    componentsWithVariants: r.with_variants ?? 0,
    componentsWithProps: r.with_props ?? 0,
    componentsWithA11y: r.with_a11y ?? 0,
    tokens: r.tokens ?? 0,
    tokenSets: r.token_sets ?? 0,
    tokenCategories,
    patterns: r.patterns ?? 0,
    sourcesChecked: r.sources_checked ?? 0,
    sourcesOk: r.sources_ok ?? 0,
    evidence: r.evidence ?? 0,
    computedAt: new Date().toISOString(),
  };
}

/** True when two summaries differ in anything but computedAt. */
export function coverageChanged(a: SystemCoverageSummary | null | undefined, b: SystemCoverageSummary): boolean {
  if (!a) return true;
  const strip = ({ computedAt: _c, ...rest }: SystemCoverageSummary) => JSON.stringify(rest, Object.keys(rest).sort());
  return strip(a) !== strip(b) || JSON.stringify(a.tokenCategories ?? {}) !== JSON.stringify(b.tokenCategories ?? {});
}
