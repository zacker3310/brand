/**
 * Data quality report from the live database -> docs/DATA_QUALITY.md (+ .cache/data-quality.json).
 * Every number here is derived from stored records; nothing is estimated.
 *
 *   npm run quality
 */
import { mkdir, writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/db/client";

type Row = Record<string, unknown>;

async function q<T extends Row>(query: ReturnType<typeof sql>): Promise<T[]> {
  const r = await getDb().execute(query);
  return r.rows as T[];
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
const num = (v: unknown) => Number(v ?? 0);

async function main() {
  const generatedAt = new Date().toISOString();

  const registry = await q<{ registry_status: string; n: string }>(sql`
    select registry_status, count(*) n from design_system group by 1 order by 1`);
  const nonVerified = await q<{ slug: string; name: string; registry_status: string; duplicate_of_slug: string | null; registry_notes: string | null }>(sql`
    select slug, name, registry_status, duplicate_of_slug, registry_notes from design_system
    where registry_status <> 'verified' order by registry_rank nulls last, slug`);
  const replacements = await q<{ slug: string; name: string; replaces_slug: string }>(sql`
    select slug, name, replaces_slug from design_system where replaces_slug is not null order by slug`);

  const systems = await q<{
    slug: string;
    name: string;
    category: string;
    ingestion_status: string;
    adapter_id: string | null;
    components: string;
    tokens: string;
    patterns: string;
    evidence: string;
    confidence: number;
    last_verified_at: string | null;
    last_ingested_at: string | null;
  }>(sql`
    select d.slug, d.name, d.category, d.ingestion_status, d.adapter_id, d.confidence,
      d.last_verified_at::text, d.last_ingested_at::text,
      (select count(*) from component c where c.design_system_id = d.id and c.publish_state = 'published') components,
      (select count(*) from token t join token_set s on s.id = t.token_set_id where t.design_system_id = d.id and s.publish_state = 'published') tokens,
      (select count(*) from design_pattern p where p.design_system_id = d.id and p.publish_state = 'published') patterns,
      (select count(*) from verification_evidence e where e.design_system_id = d.id) evidence
    from design_system d where d.registry_status = 'verified' order by components desc, tokens desc, d.name`);

  const fields = ["description", "variants", "states", "sizes", "properties", "accessibility", "keyboard", "responsive", "tokens", "examples", "frameworks", "relationships"];
  const completeness = await q<Row>(sql.raw(`
    select count(*) total, ${fields
      .map(
        (f) =>
          `count(*) filter (where coverage->>'${f}' = 'documented') as "${f}_documented",
           count(*) filter (where coverage->>'${f}' = 'documented-none') as "${f}_none",
           count(*) filter (where coverage->>'${f}' = 'not-documented') as "${f}_notdoc",
           count(*) filter (where coverage->>'${f}' = 'inferred') as "${f}_inferred",
           count(*) filter (where coverage->>'${f}' is null or coverage->>'${f}' = 'not-extracted') as "${f}_notext"`,
      )
      .join(",")}
    from component where publish_state = 'published'`));
  const classification = await q<{ state: string; n: string }>(sql`
    select case when component_type_id is null then 'unclassified' else classification_state::text end state, count(*) n
    from component where publish_state = 'published' group by 1 order by 1`);

  const tokenCats = await q<{ category: string; n: string; systems: string }>(sql`
    select category, count(*) n, count(distinct design_system_id) systems from token group by 1 order by 2 desc`);
  const aliasStates = await q<{ alias_state: string | null; n: string }>(sql`
    select coalesce(alias_state, 'literal') alias_state, count(*) n from token group by 1 order by 2 desc`);
  const tokenLicenses = await q<{ redistribution: string; sets: string; tokens: string }>(sql`
    select redistribution, count(*) sets, coalesce(sum(token_count),0) tokens from token_set group by 1 order by 1`);

  const freshness = await q<Row>(sql`
    select count(*) docs,
      count(*) filter (where last_fetched_at > now() - interval '7 days') fresh7,
      count(*) filter (where last_fetched_at > now() - interval '30 days') fresh30,
      count(*) filter (where last_fetched_at is null) never,
      count(*) filter (where status <> 'active') not_active
    from source_document`);
  const brokenSources = await q<{ slug: string; kind: string; url: string; last_status: number | null; last_error: string | null }>(sql`
    select d.slug, s.kind, s.url, s.last_status, s.last_error from source s join design_system d on d.id = s.design_system_id
    where d.registry_status = 'verified' and s.last_checked_at is not null and (s.last_status is null or s.last_status >= 400 or s.last_error is not null)
      and coalesce(s.last_status, 0) not in (401, 403, 429) and coalesce(s.last_error, '') <> 'ROBOTS_DISALLOWED'
    order by d.slug limit 200`);
  const restrictedSources = await q<{ host: string; last_status: number; n: string }>(sql`
    select substring(s.url from '^https?://([^/]+)') host, s.last_status, count(*) n from source s
    join design_system d on d.id = s.design_system_id
    where d.registry_status = 'verified' and s.last_checked_at is not null and s.last_status in (401, 403, 429)
    group by 1, 2 order by 3 desc`);
  const robotsSources = await q<Row>(sql`
    select count(*) n from source s join design_system d on d.id = s.design_system_id
    where d.registry_status = 'verified' and s.last_error = 'ROBOTS_DISALLOWED'`);
  const sourcesChecked = await q<Row>(sql`
    select count(*) total, count(*) filter (where s.last_checked_at is not null) checked
    from source s join design_system d on d.id = s.design_system_id where d.registry_status = 'verified'`);

  const dupComponents = await q<{ slug: string; name: string; n: string }>(sql`
    select d.slug, lower(c.name) name, count(*) n from component c join design_system d on d.id = c.design_system_id
    where c.publish_state = 'published' group by 1, 2 having count(*) > 1 order by 3 desc limit 50`);
  const extractionStates = await q<{ validation: string; n: string }>(sql`
    select validation, count(*) n from extraction e
    where e.run_id in (select distinct on (design_system_id) id from ingestion_run order by design_system_id, created_at desc)
    group by 1 order by 1`);
  const conflictingEvidence = await q<Row>(sql`select count(*) n from verification_evidence where state = 'conflicting'`);
  const runs = await q<{ status: string; n: string }>(sql`select status, count(*) n from ingestion_run group by 1 order by 1`);
  const failedRuns = await q<{ slug: string | null; kind: string; status: string; stage: string | null; created_at: string }>(sql`
    select d.slug, r.kind, r.status, r.stage, r.created_at::text from ingestion_run r left join design_system d on d.id = r.design_system_id
    where r.status in ('failed','partial') order by r.created_at desc limit 30`);
  const errors = await q<{ stage: string; code: string; n: string }>(sql`
    select stage, code, count(*) n from ingestion_error where resolved_at is null group by 1, 2 order by 3 desc limit 30`);
  const evidenceStates = await q<{ state: string; n: string }>(sql`select state, count(*) n from verification_evidence group by 1 order by 2 desc`);
  const depth = await q<{ ingestion_status: string; n: string }>(sql`
    select ingestion_status::text, count(*) n from design_system where registry_status = 'verified' group by 1 order by 2 desc`);
  const shallow = await q<{ slug: string; name: string; ingestion_status: string; registry_notes: string | null }>(sql`
    select slug, name, ingestion_status::text, registry_notes from design_system
    where registry_status = 'verified' and ingestion_status not in ('indexed', 'inventory') order by ingestion_status, slug`);
  const restrictedDocs = await q<{ slug: string; status: string; n: string }>(sql`
    select d.slug, sd.status::text, count(*) n from source_document sd join design_system d on d.id = sd.design_system_id
    where sd.status <> 'active' group by 1, 2 order by 3 desc, 1 limit 50`);
  const latestRunErrors = await q<{ slug: string; stage: string; code: string; n: string }>(sql`
    select d.slug, e.stage, e.code, count(*) n from ingestion_error e join design_system d on d.id = e.design_system_id
    where e.resolved_at is null and e.severity = 'error'
      and e.run_id in (select distinct on (design_system_id) id from ingestion_run order by design_system_id, created_at desc)
    group by 1, 2, 3 order by 4 desc, 1 limit 50`);

  const verifiedCount = num(registry.find((r) => r.registry_status === "verified")?.n);
  const c0 = completeness[0] ?? {};
  const totalComponents = num(c0.total);
  const deep = systems.filter((s) => s.ingestion_status === "indexed" || s.ingestion_status === "partial");
  const withComponents = systems.filter((s) => num(s.components) > 0);
  const withTokens = systems.filter((s) => num(s.tokens) > 0);

  const lines: string[] = [];
  const L = (s = "") => lines.push(s);
  L("# ATLAS data quality report");
  L();
  L(`Generated ${generatedAt} from the live database by \`npm run quality\`. All figures are counts of stored records.`);
  L();
  L("## Summary");
  L();
  L("| Metric | Value |");
  L("|---|---|");
  L(`| Verified systems (registry) | ${verifiedCount} / 100 |`);
  L(`| Systems deeply indexed (indexed or partial) | ${deep.length} |`);
  L(`| Ingestion depth (verified systems) | ${depth.map((d) => `${d.ingestion_status} ${d.n}`).join(" · ")} |`);
  L(`| Systems with component records | ${withComponents.length} |`);
  L(`| Systems with token records | ${withTokens.length} |`);
  L(`| Published components | ${totalComponents} |`);
  L(`| Tokens | ${tokenCats.reduce((n, r) => n + num(r.n), 0)} |`);
  L(`| Published patterns | ${systems.reduce((n, s) => n + num(s.patterns), 0)} |`);
  L(`| Evidence records | ${evidenceStates.reduce((n, r) => n + num(r.n), 0)} |`);
  L();
  L("## Registry");
  L();
  L("| Status | Count |");
  L("|---|---|");
  for (const r of registry) L(`| ${r.registry_status} | ${r.n} |`);
  L();
  if (nonVerified.length) {
    L("Entries not counted toward the 100 (discovery results preserved):");
    L();
    L("| Slug | Status | Duplicate of | Reason |");
    L("|---|---|---|---|");
    for (const r of nonVerified) L(`| ${r.slug} | ${r.registry_status} | ${r.duplicate_of_slug ?? ""} | ${(r.registry_notes ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 220)} |`);
    L();
  }
  if (replacements.length) {
    L("Replacements:");
    L();
    for (const r of replacements) L(`- ${r.name} (\`${r.slug}\`) replaces \`${r.replaces_slug}\``);
    L();
  }
  L("## Verified system coverage");
  L();
  L("| System | Category | Ingestion | Adapter | Components | Tokens | Patterns | Evidence | Confidence |");
  L("|---|---|---|---|---:|---:|---:|---:|---:|");
  for (const s of systems)
    L(`| ${s.name} | ${s.category} | ${s.ingestion_status} | ${s.adapter_id ?? "—"} | ${s.components} | ${s.tokens} | ${s.patterns} | ${s.evidence} | ${Number(s.confidence).toFixed(2)} |`);
  L();
  L("## Component extraction completeness");
  L();
  L(`Across ${totalComponents} published components. "Not extracted" means ATLAS has not parsed the field; it is unknown, not absent.`);
  L();
  L("| Field | Documented | Documented none | Not documented | Inferred | Not extracted |");
  L("|---|---:|---:|---:|---:|---:|");
  for (const f of fields)
    L(
      `| ${f} | ${c0[`${f}_documented`]} (${pct(num(c0[`${f}_documented`]), totalComponents)}) | ${c0[`${f}_none`]} | ${c0[`${f}_notdoc`]} | ${c0[`${f}_inferred`]} | ${c0[`${f}_notext`]} (${pct(num(c0[`${f}_notext`]), totalComponents)}) |`,
    );
  L();
  L("Taxonomy classification:");
  L();
  for (const c of classification) L(`- ${c.state}: ${c.n}`);
  L();
  L("## Token coverage");
  L();
  L("| Category | Tokens | Systems |");
  L("|---|---:|---:|");
  for (const t of tokenCats) L(`| ${t.category} | ${t.n} | ${t.systems} |`);
  L();
  L("Alias resolution: " + aliasStates.map((a) => `${a.alias_state} ${a.n}`).join(" · "));
  L();
  L("Token set redistribution status: " + tokenLicenses.map((t) => `${t.redistribution}: ${t.sets} sets / ${t.tokens} tokens`).join(" · "));
  L();
  L("## Source freshness");
  L();
  const f0 = freshness[0] ?? {};
  L(`Documents tracked: ${f0.docs}. Fetched within 7 days: ${f0.fresh7}; within 30 days: ${f0.fresh30}; never fetched: ${f0.never}; not active (gone/blocked/error): ${f0.not_active}.`);
  L();
  L("## Broken links (sources of verified systems)");
  L();
  const sc = sourcesChecked[0] ?? {};
  L(
    `Sources: ${sc.total}; link-checked: ${sc.checked}; broken (404/410/5xx/network): ${brokenSources.length}; ` +
      `restricted for automated clients (401/403/429, not verifiable, not counted as broken): ${restrictedSources.reduce((n, r) => n + num(r.n), 0)}; robots-disallowed: ${num(robotsSources[0]?.n)}.`,
  );
  L();
  if (restrictedSources.length) {
    L("Restricted hosts: " + restrictedSources.map((r) => `${r.host} (HTTP ${r.last_status}) ${r.n}`).join(" · "));
    L();
  }
  if (brokenSources.length) {
    L("| System | Kind | URL | Status | Error |");
    L("|---|---|---|---|---|");
    for (const b of brokenSources) L(`| ${b.slug} | ${b.kind} | ${b.url} | ${b.last_status ?? ""} | ${b.last_error ?? ""} |`);
    L();
  }
  L("## Restricted, failed and metadata-only sources");
  L();
  L(
    "Systems without extracted components or tokens, with the registry's reason. ATLAS never bypasses robots.txt, authentication, bot challenges or client-side rendering; these stay metadata-level until a static, permitted source exists.",
  );
  L();
  if (shallow.length) {
    L("| System | Ingestion | Reason (registry note) |");
    L("|---|---|---|");
    for (const r of shallow) L(`| ${r.name} (\`${r.slug}\`) | ${r.ingestion_status} | ${(r.registry_notes ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 240)} |`);
    L();
  } else {
    L("None.");
    L();
  }
  L(`Documents not active (gone, robots-blocked or erroring): ${restrictedDocs.reduce((n, r) => n + num(r.n), 0)}.`);
  for (const r of restrictedDocs) L(`- ${r.slug}: ${r.status} ${r.n}`);
  L();
  L(`Errors in each system's latest run: ${latestRunErrors.reduce((n, r) => n + num(r.n), 0)}.`);
  for (const r of latestRunErrors) L(`- ${r.slug}: ${r.stage}/${r.code} x${r.n}`);
  L();
  L("## Duplicates and conflicts");
  L();
  L(`Duplicate component names within a system (case-insensitive): ${dupComponents.length}.`);
  for (const d of dupComponents.slice(0, 20)) L(`- ${d.slug}: "${d.name}" x${d.n}`);
  L();
  L("Latest-run extraction validation: " + (extractionStates.map((e) => `${e.validation} ${e.n}`).join(" · ") || "none"));
  L();
  L(`Conflicting evidence records: ${num(conflictingEvidence[0]?.n)}.`);
  L();
  L("Evidence states: " + evidenceStates.map((e) => `${e.state} ${e.n}`).join(" · "));
  L();
  L("## Ingestion runs");
  L();
  L("Runs by status: " + (runs.map((r) => `${r.status} ${r.n}`).join(" · ") || "none"));
  L();
  if (failedRuns.length) {
    L("| System | Kind | Status | Stage | Started |");
    L("|---|---|---|---|---|");
    for (const r of failedRuns) L(`| ${r.slug ?? "—"} | ${r.kind} | ${r.status} | ${r.stage ?? ""} | ${r.created_at} |`);
    L();
  }
  if (errors.length) {
    L("Unresolved errors by stage/code:");
    L();
    L("| Stage | Code | Count |");
    L("|---|---|---:|");
    for (const e of errors) L(`| ${e.stage} | ${e.code} | ${e.n} |`);
    L();
  }

  await writeFile("docs/DATA_QUALITY.md", lines.join("\n"));
  await mkdir(".cache", { recursive: true });
  await writeFile(
    ".cache/data-quality.json",
    JSON.stringify({ generatedAt, registry, systems, completeness: c0, tokenCats, aliasStates, freshness: f0, brokenSources, errors, runs }, null, 2),
  );
  console.log(`wrote docs/DATA_QUALITY.md (${verifiedCount} verified, ${totalComponents} components)`);
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
