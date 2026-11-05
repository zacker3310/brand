/**
 * Ops read models (internal dashboard). Every view is aggregated in SQL; lists are bounded.
 * Writes live in src/app/ops/actions.ts (admin-checked) and only ever enqueue / requeue /
 * cancel jobs or mark errors resolved; nothing here runs ingestion.
 */
import { sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db/client";
import type { RunStats } from "@/lib/contracts";
import type { EvidenceRow } from "@/components/atlas";
import { containsPattern, iso, num, whereAll } from "@/server/api/sql";
import { readDb } from "./db";

type Row = Record<string, unknown>;
const d_ = async (db?: DB) => db ?? (await readDb());
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export const STALE_VERIFICATION_DAYS = 30;

/* -------------------------------------------------------------------------- */
/* Overview                                                                     */
/* -------------------------------------------------------------------------- */

export interface OpsOverview {
  registry: Record<string, number>;
  staleVerification: number;
  ingestion: Record<string, number>;
  jobs: Record<string, number>;
  dueJobs: number;
  oldestQueuedAt: string | null;
  runs: { total: number; active: number; failed7d: number; lastFinishedAt: string | null };
  errors: { open: number; openErrors: number; openWarnings: number; resolved: number };
  quarantined: number;
  documents: Record<string, number>;
  brokenSources: number;
  registryDuplicates: number;
  evidence: number;
}

export async function opsOverview(db?: DB): Promise<OpsOverview> {
  const d = await d_(db);
  const r = await d.execute<Row>(sql`
    select
      (select jsonb_object_agg(s, n) from (select registry_status::text s, count(*)::int n from design_system group by 1) x) as registry,
      (select count(*)::int from design_system where registry_status = 'verified' and (last_verified_at is null or last_verified_at < now() - make_interval(days => ${STALE_VERIFICATION_DAYS}))) as stale,
      (select jsonb_object_agg(s, n) from (select ingestion_status::text s, count(*)::int n from design_system where registry_status = 'verified' group by 1) x) as ingestion,
      (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select status::text s, count(*)::int n from ingestion_job group by 1) x) as jobs,
      (select count(*)::int from ingestion_job where status = 'queued' and run_at <= now()) as due,
      (select min(created_at) from ingestion_job where status = 'queued') as oldest_queued,
      (select count(*)::int from ingestion_run) as runs_total,
      (select count(*)::int from ingestion_run where status in ('pending', 'running')) as runs_active,
      (select count(*)::int from ingestion_run where status = 'failed' and created_at > now() - interval '7 days') as runs_failed,
      (select max(finished_at) from ingestion_run) as last_finished,
      (select count(*)::int from ingestion_error where resolved_at is null) as errors_open,
      (select count(*)::int from ingestion_error where resolved_at is null and severity = 'error') as errors_open_errors,
      (select count(*)::int from ingestion_error where resolved_at is null and severity <> 'error') as errors_open_warnings,
      (select count(*)::int from ingestion_error where resolved_at is not null) as errors_resolved,
      (select count(*)::int from (
         select distinct on (design_system_id, entity_kind, entity_key) validation from extraction
         order by design_system_id, entity_kind, entity_key, created_at desc) x where validation in ('invalid', 'conflict')) as quarantined,
      (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select status s, count(*)::int n from source_document group by 1) x) as documents,
      (select count(*)::int from source where last_status >= 400 or last_error is not null) as broken,
      (select count(*)::int from design_system where registry_status = 'duplicate') as duplicates,
      (select count(*)::int from verification_evidence) as evidence
  `);
  const x = r.rows[0]!;
  return {
    registry: (x.registry as Record<string, number>) ?? {},
    staleVerification: num(x.stale),
    ingestion: (x.ingestion as Record<string, number>) ?? {},
    jobs: (x.jobs as Record<string, number>) ?? {},
    dueJobs: num(x.due),
    oldestQueuedAt: iso(x.oldest_queued as Date | null),
    runs: { total: num(x.runs_total), active: num(x.runs_active), failed7d: num(x.runs_failed), lastFinishedAt: iso(x.last_finished as Date | null) },
    errors: { open: num(x.errors_open), openErrors: num(x.errors_open_errors), openWarnings: num(x.errors_open_warnings), resolved: num(x.errors_resolved) },
    quarantined: num(x.quarantined),
    documents: (x.documents as Record<string, number>) ?? {},
    brokenSources: num(x.broken),
    registryDuplicates: num(x.duplicates),
    evidence: num(x.evidence),
  };
}

/* -------------------------------------------------------------------------- */
/* Registry coverage                                                            */
/* -------------------------------------------------------------------------- */

export interface RegistryEntryRow {
  slug: string;
  name: string;
  status: string;
  rank: number | null;
  confidence: number;
  notes: string | null;
  duplicateOf: { slug: string; name: string | null } | null;
  replacedBy: { slug: string; name: string | null } | null;
  replaces: { slug: string; name: string | null } | null;
  lastVerifiedAt: string | null;
  homepageUrl: string | null;
  checks: number;
  failedChecks: number;
}

export interface RegistryCoverage {
  counts: Record<string, number>;
  rankedCandidates: number;
  confidence: { bucket: string; n: number }[];
  notVerified: RegistryEntryRow[];
  replacements: RegistryEntryRow[];
  stale: RegistryEntryRow[];
  lowestConfidence: RegistryEntryRow[];
}

const REGISTRY_ROW = sql`
  ds.slug, ds.name, ds.registry_status::text as status, ds.registry_rank as rank, ds.confidence, ds.registry_notes as notes,
  ds.duplicate_of_slug, dup.name as duplicate_name, ds.replaced_by_slug, rep.name as replaced_by_name, ds.replaces_slug, orig.name as replaces_name,
  ds.last_verified_at, ds.homepage_url,
  coalesce(jsonb_array_length(ds.registry_evidence->'checks'), 0) as checks,
  (select count(*) from jsonb_array_elements(coalesce(ds.registry_evidence->'checks', '[]'::jsonb)) c where (c->>'ok')::boolean is false)::int as failed_checks
`;
const REGISTRY_JOINS = sql`
  left join design_system dup on dup.slug = ds.duplicate_of_slug
  left join design_system rep on rep.slug = ds.replaced_by_slug
  left join design_system orig on orig.slug = ds.replaces_slug
`;

function toRegistryRow(r: Row): RegistryEntryRow {
  const ref = (slug: unknown, name: unknown) => (slug ? { slug: String(slug), name: str(name) } : null);
  return {
    slug: String(r.slug),
    name: String(r.name),
    status: String(r.status),
    rank: (r.rank as number | null) ?? null,
    confidence: num(r.confidence),
    notes: str(r.notes),
    duplicateOf: ref(r.duplicate_of_slug, r.duplicate_name),
    replacedBy: ref(r.replaced_by_slug, r.replaced_by_name),
    replaces: ref(r.replaces_slug, r.replaces_name),
    lastVerifiedAt: iso(r.last_verified_at as Date | null),
    homepageUrl: str(r.homepage_url),
    checks: num(r.checks),
    failedChecks: num(r.failed_checks),
  };
}

export async function registryCoverage(db?: DB): Promise<RegistryCoverage> {
  const d = await d_(db);
  const [counts, ranked, conf, notVerified, replacements, stale, lowest] = await Promise.all([
    d.execute<{ s: string; n: number }>(sql`select registry_status::text s, count(*)::int n from design_system group by 1`),
    d.execute<{ n: number }>(sql`select count(*)::int n from design_system where registry_rank is not null`),
    d.execute<{ b: number; n: number }>(sql`
      select least(width_bucket(confidence, 0.5, 1.0, 5), 6) as b, count(*)::int n
      from design_system where registry_status = 'verified' group by 1 order by 1`),
    d.execute<Row>(sql`select ${REGISTRY_ROW} from design_system ds ${REGISTRY_JOINS} where ds.registry_status <> 'verified' order by ds.registry_status, ds.registry_rank nulls last, ds.name`),
    d.execute<Row>(sql`select ${REGISTRY_ROW} from design_system ds ${REGISTRY_JOINS} where ds.replaces_slug is not null order by ds.name`),
    d.execute<Row>(sql`
      select ${REGISTRY_ROW} from design_system ds ${REGISTRY_JOINS}
      where ds.registry_status = 'verified' and (ds.last_verified_at is null or ds.last_verified_at < now() - make_interval(days => ${STALE_VERIFICATION_DAYS}))
      order by ds.last_verified_at nulls first limit 100`),
    d.execute<Row>(sql`select ${REGISTRY_ROW} from design_system ds ${REGISTRY_JOINS} where ds.registry_status = 'verified' order by ds.confidence, ds.name limit 8`),
  ]);
  const label = (b: number) => (b <= 0 ? "< 0.50" : b >= 6 ? "1.00" : `${(0.5 + (b - 1) * 0.1).toFixed(2)}–${(0.5 + b * 0.1 - 0.01).toFixed(2)}`);
  const byBucket = new Map(conf.rows.map((r) => [num(r.b), num(r.n)]));
  return {
    counts: Object.fromEntries(counts.rows.map((r) => [r.s, num(r.n)])),
    rankedCandidates: num(ranked.rows[0]?.n),
    confidence: [0, 1, 2, 3, 4, 5, 6].filter((b) => b !== 6 || byBucket.has(6)).map((b) => ({ bucket: label(b), n: byBucket.get(b) ?? 0 })),
    notVerified: notVerified.rows.map(toRegistryRow),
    replacements: replacements.rows.map(toRegistryRow),
    stale: stale.rows.map(toRegistryRow),
    lowestConfidence: lowest.rows.map(toRegistryRow),
  };
}

/* -------------------------------------------------------------------------- */
/* Runs                                                                         */
/* -------------------------------------------------------------------------- */

export interface RunRow {
  id: string;
  system: string | null;
  systemName: string | null;
  adapterId: string | null;
  adapterVersion: string | null;
  kind: string;
  status: string;
  stage: string | null;
  triggeredBy: string;
  stats: RunStats;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  queueWaitMs: number | null;
  errors: number;
  warnings: number;
  quarantined: number;
}

const RUN_SELECT = sql`
  r.id, ds.slug as system, ds.name as system_name, r.adapter_id, r.adapter_version, r.kind, r.status::text as status, r.stage, r.triggered_by, r.stats,
  r.created_at, r.started_at, r.finished_at,
  (select count(*) from ingestion_error e where e.run_id = r.id and e.severity = 'error')::int as n_errors,
  (select count(*) from ingestion_error e where e.run_id = r.id and e.severity <> 'error')::int as n_warnings,
  (select count(*) from extraction x where x.run_id = r.id and x.validation in ('invalid', 'conflict'))::int as n_quarantined
`;

function toRunRow(r: Row): RunRow {
  const stats = (r.stats as RunStats | null) ?? {};
  const created = r.created_at ? new Date(r.created_at as Date).getTime() : null;
  const started = r.started_at ? new Date(r.started_at as Date).getTime() : null;
  const finished = r.finished_at ? new Date(r.finished_at as Date).getTime() : null;
  return {
    id: String(r.id),
    system: str(r.system),
    systemName: str(r.system_name),
    adapterId: str(r.adapter_id),
    adapterVersion: str(r.adapter_version),
    kind: String(r.kind),
    status: String(r.status),
    stage: str(r.stage),
    triggeredBy: String(r.triggered_by),
    stats,
    createdAt: iso(r.created_at as Date | null),
    startedAt: iso(r.started_at as Date | null),
    finishedAt: iso(r.finished_at as Date | null),
    durationMs: started && finished ? finished - started : typeof stats.durationMs === "number" ? stats.durationMs : null,
    queueWaitMs: created && started ? Math.max(0, started - created) : null,
    errors: num(r.n_errors),
    warnings: num(r.n_warnings),
    quarantined: num(r.n_quarantined),
  };
}

export interface RunFilters {
  status?: string;
  system?: string;
  page: number;
  pageSize: number;
}

export async function listRuns(f: RunFilters, db?: DB): Promise<{ rows: RunRow[]; total: number }> {
  const d = await d_(db);
  const conds: SQL[] = [];
  if (f.status) conds.push(sql`r.status = ${f.status}`);
  if (f.system) conds.push(sql`ds.slug = ${f.system}`);
  const res = await d.execute<Row>(sql`
    select ${RUN_SELECT}, count(*) over() as total
    from ingestion_run r left join design_system ds on ds.id = r.design_system_id
    ${whereAll(conds)}
    order by r.created_at desc
    limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}
  `);
  return { rows: res.rows.map(toRunRow), total: res.rows.length ? num(res.rows[0]!.total) : 0 };
}

export interface RunDetail extends RunRow {
  checkpoint: {
    discovered: number | null;
    gone: number | null;
    fetch: { outcome: string; n: number }[];
    parse: { outcome: string; n: number }[];
    publish: { ingestionStatus: string; completedAt: string } | null;
    limit: number | null;
  };
  jobs: { id: string; kind: string; status: string; attempts: number; maxAttempts: number; lastError: string | null; createdAt: string | null; finishedAt: string | null; runAt: string | null; lockedBy: string | null }[];
  errors: { id: string; stage: string; severity: string; code: string; message: string; url: string | null; resolvedAt: string | null; createdAt: string | null }[];
  errorTotal: number;
  extractionSummary: { entityKind: string; validation: string; n: number; published: number }[];
  extractions: { id: string; entityKind: string; entityKey: string; validation: string; published: boolean; issues: { code: string; message: string; path?: string; severity: string }[] }[];
  extractionTotal: number;
}

export async function getRunDetail(id: string, opts: { validation?: string } = {}, db?: DB): Promise<RunDetail | null> {
  const d = await d_(db);
  const res = await d.execute<Row>(sql`
    select ${RUN_SELECT},
      jsonb_array_length(coalesce(r.checkpoint->'discover'->'docs', '[]'::jsonb)) as cp_discovered,
      (r.checkpoint->'discover'->>'gone')::int as cp_gone,
      (select coalesce(jsonb_agg(jsonb_build_object('outcome', o, 'n', n) order by n desc), '[]'::jsonb) from (
         select value->>'outcome' o, count(*)::int n from jsonb_each(coalesce(r.checkpoint->'fetch'->'done', '{}'::jsonb)) group by 1) f) as cp_fetch,
      (select coalesce(jsonb_agg(jsonb_build_object('outcome', o, 'n', n) order by n desc), '[]'::jsonb) from (
         select value->>'outcome' o, count(*)::int n from jsonb_each(coalesce(r.checkpoint->'parse'->'done', '{}'::jsonb)) group by 1) p) as cp_parse,
      r.checkpoint->'publish' as cp_publish,
      (r.checkpoint->>'limit')::int as cp_limit
    from ingestion_run r left join design_system ds on ds.id = r.design_system_id
    where r.id = ${id}
  `);
  const r = res.rows[0];
  if (!r) return null;
  const validationFilter =
    opts.validation === "problems" ? sql`and validation <> 'valid'` : opts.validation && opts.validation !== "all" ? sql`and validation = ${opts.validation}` : sql``;
  const [jobs, errors, summary, extractions] = await Promise.all([
    d.execute<Row>(sql`select id, kind, status::text as status, attempts, max_attempts, last_error, created_at, finished_at, run_at, locked_by from ingestion_job where run_id = ${id} order by created_at`),
    d.execute<Row>(sql`select id, stage, severity, code, message, url, resolved_at, created_at, count(*) over() as total from ingestion_error where run_id = ${id} order by severity, created_at limit 200`),
    d.execute<Row>(sql`select entity_kind, validation, count(*)::int n, count(*) filter (where published)::int published from extraction where run_id = ${id} group by 1, 2 order by 1, 2`),
    d.execute<Row>(sql`
      select id, entity_kind, entity_key, validation, published, coalesce(issues, '[]'::jsonb) as issues, count(*) over() as total
      from extraction where run_id = ${id} ${validationFilter}
      order by case validation when 'invalid' then 0 when 'conflict' then 1 when 'warning' then 2 when 'pending' then 3 else 4 end, entity_kind, entity_key
      limit 300`),
  ]);
  return {
    ...toRunRow(r),
    checkpoint: {
      discovered: r.cp_discovered === null ? null : num(r.cp_discovered),
      gone: r.cp_gone === null || r.cp_gone === undefined ? null : num(r.cp_gone),
      fetch: (r.cp_fetch as { outcome: string; n: number }[]) ?? [],
      parse: (r.cp_parse as { outcome: string; n: number }[]) ?? [],
      publish: (r.cp_publish as { ingestionStatus: string; completedAt: string } | null) ?? null,
      limit: (r.cp_limit as number | null) ?? null,
    },
    jobs: jobs.rows.map((j) => ({
      id: String(j.id),
      kind: String(j.kind),
      status: String(j.status),
      attempts: num(j.attempts),
      maxAttempts: num(j.max_attempts),
      lastError: str(j.last_error),
      createdAt: iso(j.created_at as Date | null),
      finishedAt: iso(j.finished_at as Date | null),
      runAt: iso(j.run_at as Date | null),
      lockedBy: str(j.locked_by),
    })),
    errors: errors.rows.map((e) => ({
      id: String(e.id),
      stage: String(e.stage),
      severity: String(e.severity),
      code: String(e.code),
      message: String(e.message),
      url: str(e.url),
      resolvedAt: iso(e.resolved_at as Date | null),
      createdAt: iso(e.created_at as Date | null),
    })),
    errorTotal: errors.rows.length ? num(errors.rows[0]!.total) : 0,
    extractionSummary: summary.rows.map((s) => ({ entityKind: String(s.entity_kind), validation: String(s.validation), n: num(s.n), published: num(s.published) })),
    extractions: extractions.rows.map((x) => ({
      id: String(x.id),
      entityKind: String(x.entity_kind),
      entityKey: String(x.entity_key),
      validation: String(x.validation),
      published: !!x.published,
      issues: (x.issues as RunDetail["extractions"][number]["issues"]) ?? [],
    })),
    extractionTotal: extractions.rows.length ? num(extractions.rows[0]!.total) : 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Queue                                                                        */
/* -------------------------------------------------------------------------- */

export interface JobRow {
  id: string;
  kind: string;
  status: string;
  system: string | null;
  runId: string | null;
  attempts: number;
  maxAttempts: number;
  priority: number;
  lastError: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  runAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
}

export interface QueueView {
  matrix: { kind: string; counts: Record<string, number>; total: number }[];
  statuses: string[];
  due: number;
  scheduled: number;
  oldestQueuedAt: string | null;
  running: JobRow[];
  problems: JobRow[];
  problemTotal: number;
  waiting: JobRow[];
}

const JOB_SELECT = sql`
  j.id, j.kind, j.status::text as status, ds.slug as system, j.run_id, j.attempts, j.max_attempts, j.priority, j.last_error, j.locked_by, j.locked_at,
  j.run_at, j.created_at, j.updated_at, j.finished_at
`;

function toJob(j: Row): JobRow {
  return {
    id: String(j.id),
    kind: String(j.kind),
    status: String(j.status),
    system: str(j.system),
    runId: str(j.run_id),
    attempts: num(j.attempts),
    maxAttempts: num(j.max_attempts),
    priority: num(j.priority),
    lastError: str(j.last_error),
    lockedBy: str(j.locked_by),
    lockedAt: iso(j.locked_at as Date | null),
    runAt: iso(j.run_at as Date | null),
    createdAt: iso(j.created_at as Date | null),
    updatedAt: iso(j.updated_at as Date | null),
    finishedAt: iso(j.finished_at as Date | null),
  };
}

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "dead", "cancelled"] as const;

export async function queueView(opts: { problemStatus?: string } = {}, db?: DB): Promise<QueueView> {
  const d = await d_(db);
  const problemFilter = opts.problemStatus ? sql`j.status = ${opts.problemStatus}` : sql`j.status in ('failed', 'dead', 'cancelled')`;
  const [matrix, due, running, problems, waiting] = await Promise.all([
    d.execute<{ kind: string; status: string; n: number }>(sql`select kind, status::text as status, count(*)::int as n from ingestion_job group by 1, 2 order by 1`),
    d.execute<Row>(sql`
      select count(*) filter (where run_at <= now())::int as due, count(*) filter (where run_at > now())::int as scheduled, min(created_at) as oldest
      from ingestion_job where status = 'queued'`),
    d.execute<Row>(sql`select ${JOB_SELECT} from ingestion_job j left join design_system ds on ds.id = j.design_system_id where j.status = 'running' order by j.locked_at limit 50`),
    d.execute<Row>(sql`
      select ${JOB_SELECT}, count(*) over() as total from ingestion_job j left join design_system ds on ds.id = j.design_system_id
      where ${problemFilter} order by j.updated_at desc limit 100`),
    d.execute<Row>(sql`select ${JOB_SELECT} from ingestion_job j left join design_system ds on ds.id = j.design_system_id where j.status = 'queued' order by j.priority, j.run_at limit 50`),
  ]);
  const kinds = new Map<string, Record<string, number>>();
  for (const m of matrix.rows) {
    const k = kinds.get(m.kind) ?? {};
    k[m.status] = num(m.n);
    kinds.set(m.kind, k);
  }
  const x = due.rows[0] ?? {};
  return {
    matrix: [...kinds].map(([kind, counts]) => ({ kind, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) })),
    statuses: [...JOB_STATUSES],
    due: num(x.due),
    scheduled: num(x.scheduled),
    oldestQueuedAt: iso(x.oldest as Date | null),
    running: running.rows.map(toJob),
    problems: problems.rows.map(toJob),
    problemTotal: problems.rows.length ? num(problems.rows[0]!.total) : 0,
    waiting: waiting.rows.map(toJob),
  };
}

/* -------------------------------------------------------------------------- */
/* Extraction errors                                                            */
/* -------------------------------------------------------------------------- */

export interface ErrorGroup {
  system: string | null;
  systemName: string | null;
  stage: string;
  code: string;
  severity: string;
  open: number;
  resolved: number;
  firstSeen: string | null;
  lastSeen: string | null;
  sampleMessage: string;
  sampleUrl: string | null;
}

export interface ErrorFilters {
  system?: string;
  stage?: string;
  code?: string;
  state: "open" | "resolved" | "all";
}

function errorConds(f: ErrorFilters): SQL[] {
  const c: SQL[] = [];
  if (f.system === "_none") c.push(sql`e.design_system_id is null`);
  else if (f.system) c.push(sql`ds.slug = ${f.system}`);
  if (f.stage) c.push(sql`e.stage = ${f.stage}`);
  if (f.code) c.push(sql`e.code = ${f.code}`);
  return c;
}

export async function errorGroups(f: ErrorFilters, db?: DB): Promise<ErrorGroup[]> {
  const d = await d_(db);
  const having = f.state === "open" ? sql`having count(*) filter (where e.resolved_at is null) > 0` : f.state === "resolved" ? sql`having count(*) filter (where e.resolved_at is null) = 0` : sql``;
  const res = await d.execute<Row>(sql`
    select ds.slug as system, ds.name as system_name, e.stage, e.code, e.severity,
      count(*) filter (where e.resolved_at is null)::int as open, count(*) filter (where e.resolved_at is not null)::int as resolved,
      min(e.created_at) as first_seen, max(e.created_at) as last_seen,
      (array_agg(e.message order by e.created_at desc))[1] as sample_message,
      (array_agg(e.url order by e.created_at desc) filter (where e.url is not null))[1] as sample_url
    from ingestion_error e left join design_system ds on ds.id = e.design_system_id
    ${whereAll(errorConds(f))}
    group by ds.slug, ds.name, e.stage, e.code, e.severity
    ${having}
    order by case e.severity when 'error' then 0 else 1 end, count(*) filter (where e.resolved_at is null) desc, max(e.created_at) desc
    limit 200
  `);
  return res.rows.map((r) => ({
    system: str(r.system),
    systemName: str(r.system_name),
    stage: String(r.stage),
    code: String(r.code),
    severity: String(r.severity),
    open: num(r.open),
    resolved: num(r.resolved),
    firstSeen: iso(r.first_seen as Date | null),
    lastSeen: iso(r.last_seen as Date | null),
    sampleMessage: String(r.sample_message ?? ""),
    sampleUrl: str(r.sample_url),
  }));
}

export interface ErrorRow {
  id: string;
  runId: string | null;
  jobId: string | null;
  system: string | null;
  stage: string;
  severity: string;
  code: string;
  message: string;
  url: string | null;
  details: Record<string, unknown> | null;
  resolvedAt: string | null;
  createdAt: string | null;
}

export async function listErrors(f: ErrorFilters & { page: number; pageSize: number }, db?: DB): Promise<{ rows: ErrorRow[]; total: number }> {
  const d = await d_(db);
  const conds = errorConds(f);
  if (f.state === "open") conds.push(sql`e.resolved_at is null`);
  if (f.state === "resolved") conds.push(sql`e.resolved_at is not null`);
  const res = await d.execute<Row>(sql`
    select e.id, e.run_id, e.job_id, ds.slug as system, e.stage, e.severity, e.code, e.message, e.url, e.details, e.resolved_at, e.created_at, count(*) over() as total
    from ingestion_error e left join design_system ds on ds.id = e.design_system_id
    ${whereAll(conds)}
    order by e.created_at desc
    limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}
  `);
  return {
    total: res.rows.length ? num(res.rows[0]!.total) : 0,
    rows: res.rows.map((e) => ({
      id: String(e.id),
      runId: str(e.run_id),
      jobId: str(e.job_id),
      system: str(e.system),
      stage: String(e.stage),
      severity: String(e.severity),
      code: String(e.code),
      message: String(e.message),
      url: str(e.url),
      details: (e.details as Record<string, unknown> | null) ?? null,
      resolvedAt: iso(e.resolved_at as Date | null),
      createdAt: iso(e.created_at as Date | null),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Quarantine                                                                   */
/* -------------------------------------------------------------------------- */

export interface QuarantineRow {
  id: string;
  runId: string;
  runCreatedAt: string | null;
  system: string;
  systemName: string;
  entityKind: string;
  entityKey: string;
  validation: string;
  published: boolean;
  issues: { code: string; message: string; path?: string; severity: string }[];
  createdAt: string | null;
}

/**
 * Latest extraction per (system, kind, key) whose validation is invalid/conflict (quarantined),
 * or "warning" (published with issues). Older quarantined observations superseded by a later
 * valid extraction are not listed.
 */
export async function quarantine(f: { system?: string; state: "quarantined" | "warning"; page: number; pageSize: number }, db?: DB): Promise<{ rows: QuarantineRow[]; total: number; bySystem: { system: string; n: number }[] }> {
  const d = await d_(db);
  const states = f.state === "warning" ? sql`('warning')` : sql`('invalid', 'conflict')`;
  const sys = f.system ? sql`and ds.slug = ${f.system}` : sql``;
  const [rows, bySystem] = await Promise.all([
    d.execute<Row>(sql`
      with latest as (
        select distinct on (x.design_system_id, x.entity_kind, x.entity_key) x.*
        from extraction x order by x.design_system_id, x.entity_kind, x.entity_key, x.created_at desc
      )
      select l.id, l.run_id, r.created_at as run_created_at, ds.slug as system, ds.name as system_name, l.entity_kind, l.entity_key, l.validation, l.published,
        coalesce(l.issues, '[]'::jsonb) as issues, l.created_at, count(*) over() as total
      from latest l join design_system ds on ds.id = l.design_system_id join ingestion_run r on r.id = l.run_id
      where l.validation in ${states} ${sys}
      order by ds.slug, l.entity_kind, l.entity_key
      limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}`),
    d.execute<Row>(sql`
      with latest as (
        select distinct on (x.design_system_id, x.entity_kind, x.entity_key) x.design_system_id, x.validation
        from extraction x order by x.design_system_id, x.entity_kind, x.entity_key, x.created_at desc
      )
      select ds.slug as system, count(*)::int n from latest l join design_system ds on ds.id = l.design_system_id
      where l.validation in ${states} group by 1 order by 2 desc`),
  ]);
  return {
    total: rows.rows.length ? num(rows.rows[0]!.total) : 0,
    rows: rows.rows.map((x) => ({
      id: String(x.id),
      runId: String(x.run_id),
      runCreatedAt: iso(x.run_created_at as Date | null),
      system: String(x.system),
      systemName: String(x.system_name),
      entityKind: String(x.entity_kind),
      entityKey: String(x.entity_key),
      validation: String(x.validation),
      published: !!x.published,
      issues: (x.issues as QuarantineRow["issues"]) ?? [],
      createdAt: iso(x.created_at as Date | null),
    })),
    bySystem: bySystem.rows.map((b) => ({ system: String(b.system), n: num(b.n) })),
  };
}

/* -------------------------------------------------------------------------- */
/* Sources: freshness + broken links                                            */
/* -------------------------------------------------------------------------- */

export interface FreshnessView {
  buckets: { label: string; n: number }[];
  byStatus: Record<string, number>;
  bySystem: { system: string; systemName: string; documents: number; oldest: string | null; newest: string | null; notActive: number }[];
  problemDocs: { system: string; url: string; docKind: string; status: string; lastStatus: number | null; lastFetchedAt: string | null }[];
}

export async function sourceFreshness(db?: DB): Promise<FreshnessView> {
  const d = await d_(db);
  const [buckets, status, bySystem, problems] = await Promise.all([
    d.execute<Row>(sql`
      select
        count(*) filter (where last_fetched_at is null)::int as never,
        count(*) filter (where last_fetched_at >= now() - interval '1 day')::int as d1,
        count(*) filter (where last_fetched_at < now() - interval '1 day' and last_fetched_at >= now() - interval '7 days')::int as d7,
        count(*) filter (where last_fetched_at < now() - interval '7 days' and last_fetched_at >= now() - interval '30 days')::int as d30,
        count(*) filter (where last_fetched_at < now() - interval '30 days')::int as older
      from source_document`),
    d.execute<{ status: string; n: number }>(sql`select status, count(*)::int n from source_document group by 1 order by 2 desc`),
    d.execute<Row>(sql`
      select ds.slug as system, ds.name as system_name, count(*)::int as documents, min(sd.last_fetched_at) as oldest, max(sd.last_fetched_at) as newest,
        count(*) filter (where sd.status <> 'active')::int as not_active
      from source_document sd join design_system ds on ds.id = sd.design_system_id group by 1, 2 order by min(sd.last_fetched_at) nulls first`),
    d.execute<Row>(sql`
      select ds.slug as system, sd.url, sd.doc_kind, sd.status, sd.last_status, sd.last_fetched_at
      from source_document sd join design_system ds on ds.id = sd.design_system_id
      where sd.status in ('gone', 'blocked', 'error') or sd.last_status >= 400
      order by sd.status, ds.slug, sd.url limit 200`),
  ]);
  const b = buckets.rows[0] ?? {};
  return {
    buckets: [
      { label: "< 24 hours", n: num(b.d1) },
      { label: "1–7 days", n: num(b.d7) },
      { label: "7–30 days", n: num(b.d30) },
      { label: "> 30 days", n: num(b.older) },
      { label: "Never fetched", n: num(b.never) },
    ],
    byStatus: Object.fromEntries(status.rows.map((s) => [s.status, num(s.n)])),
    bySystem: bySystem.rows.map((s) => ({
      system: String(s.system),
      systemName: String(s.system_name),
      documents: num(s.documents),
      oldest: iso(s.oldest as Date | null),
      newest: iso(s.newest as Date | null),
      notActive: num(s.not_active),
    })),
    problemDocs: problems.rows.map((p) => ({
      system: String(p.system),
      url: String(p.url),
      docKind: String(p.doc_kind),
      status: String(p.status),
      lastStatus: (p.last_status as number | null) ?? null,
      lastFetchedAt: iso(p.last_fetched_at as Date | null),
    })),
  };
}

export interface BrokenLink {
  system: string;
  systemName: string;
  kind: string;
  url: string;
  label: string | null;
  lastStatus: number | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  discoveredBy: string;
}

export async function brokenLinks(db?: DB): Promise<{ rows: BrokenLink[]; checked: number; neverChecked: number }> {
  const d = await d_(db);
  const [rows, totals] = await Promise.all([
    d.execute<Row>(sql`
      select ds.slug as system, ds.name as system_name, s.kind, s.url, s.label, s.last_status, s.last_error, s.last_checked_at, s.discovered_by
      from source s join design_system ds on ds.id = s.design_system_id
      where s.last_status >= 400 or s.last_error is not null
      order by s.last_status desc nulls first, ds.slug limit 300`),
    d.execute<Row>(sql`select count(*) filter (where last_checked_at is not null)::int checked, count(*) filter (where last_checked_at is null)::int never from source`),
  ]);
  return {
    rows: rows.rows.map((r) => ({
      system: String(r.system),
      systemName: String(r.system_name),
      kind: String(r.kind),
      url: String(r.url),
      label: str(r.label),
      lastStatus: (r.last_status as number | null) ?? null,
      lastError: str(r.last_error),
      lastCheckedAt: iso(r.last_checked_at as Date | null),
      discoveredBy: String(r.discovered_by),
    })),
    checked: num(totals.rows[0]?.checked),
    neverChecked: num(totals.rows[0]?.never),
  };
}

/* -------------------------------------------------------------------------- */
/* Duplicates                                                                   */
/* -------------------------------------------------------------------------- */

export const NEAR_DUPLICATE_THRESHOLD = 0.8;

export interface DuplicateView {
  registry: RegistryEntryRow[];
  components: { system: string; systemName: string; a: { slug: string; name: string }; b: { slug: string; name: string }; similarity: number }[];
}

export async function duplicateCandidates(db?: DB): Promise<DuplicateView> {
  const d = await d_(db);
  const [registry, comps] = await Promise.all([
    d.execute<Row>(sql`select ${REGISTRY_ROW} from design_system ds ${REGISTRY_JOINS} where ds.registry_status = 'duplicate' or ds.duplicate_of_slug is not null order by ds.name`),
    d.execute<Row>(sql`
      select ds.slug as system, ds.name as system_name, a.slug as a_slug, a.name as a_name, b.slug as b_slug, b.name as b_name, similarity(a.name, b.name) as sim
      from component a
      join component b on b.design_system_id = a.design_system_id and a.id < b.id
      join design_system ds on ds.id = a.design_system_id
      where a.publish_state = 'published' and b.publish_state = 'published' and similarity(a.name, b.name) > ${NEAR_DUPLICATE_THRESHOLD}
      order by sim desc, ds.slug limit 200`),
  ]);
  return {
    registry: registry.rows.map(toRegistryRow),
    components: comps.rows.map((c) => ({
      system: String(c.system),
      systemName: String(c.system_name),
      a: { slug: String(c.a_slug), name: String(c.a_name) },
      b: { slug: String(c.b_slug), name: String(c.b_name) },
      similarity: num(c.sim),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Per-system table                                                             */
/* -------------------------------------------------------------------------- */

export interface OpsSystemRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  registryStatus: string;
  ingestionStatus: string;
  adapterId: string | null;
  lastIngestedAt: string | null;
  lastVerifiedAt: string | null;
  components: number;
  componentsClassified: number;
  componentsWithA11y: number;
  componentsWithProps: number;
  tokens: number;
  tokenSets: number;
  patterns: number;
  evidence: number;
  documents: number;
  openErrors: number;
  lastRun: { id: string; status: string; stage: string | null; createdAt: string | null } | null;
}

export const SYSTEM_SORTS = ["name", "components", "tokens", "patterns", "evidence", "last-ingested", "status"] as const;
export type SystemSort = (typeof SYSTEM_SORTS)[number];

export async function opsSystems(f: { q?: string; status?: string; sort: SystemSort; registry: "verified" | "all" }, db?: DB): Promise<OpsSystemRow[]> {
  const d = await d_(db);
  const conds: SQL[] = [];
  if (f.registry === "verified") conds.push(sql`ds.registry_status = 'verified'`);
  if (f.status) conds.push(sql`ds.ingestion_status = ${f.status}`);
  if (f.q) {
    const p = containsPattern(f.q);
    conds.push(sql`(ds.name ilike ${p} or ds.slug ilike ${p})`);
  }
  const order = {
    name: sql`lower(ds.name)`,
    components: sql`coalesce(c.n, 0) desc, lower(ds.name)`,
    tokens: sql`coalesce(t.n, 0) desc, lower(ds.name)`,
    patterns: sql`coalesce(p.n, 0) desc, lower(ds.name)`,
    evidence: sql`coalesce(e.n, 0) desc, lower(ds.name)`,
    "last-ingested": sql`ds.last_ingested_at desc nulls last, lower(ds.name)`,
    status: sql`ds.ingestion_status, lower(ds.name)`,
  }[f.sort];
  const res = await d.execute<Row>(sql`
    with c as (
      select design_system_id, count(*)::int n, count(component_type_id)::int classified,
        count(*) filter (where exists (select 1 from component_accessibility a where a.component_id = component.id))::int a11y,
        count(*) filter (where exists (select 1 from component_property pr where pr.component_id = component.id))::int props
      from component where publish_state = 'published' group by 1),
    t as (select t.design_system_id, count(*)::int n, count(distinct t.token_set_id)::int sets from token t join token_set s on s.id = t.token_set_id where s.publish_state = 'published' group by 1),
    p as (select design_system_id, count(*)::int n from design_pattern where publish_state = 'published' group by 1),
    e as (select design_system_id, count(*)::int n from verification_evidence group by 1),
    sd as (select design_system_id, count(*)::int n from source_document group by 1),
    er as (select design_system_id, count(*)::int n from ingestion_error where resolved_at is null and severity = 'error' group by 1),
    lr as (select distinct on (design_system_id) design_system_id, id, status::text as status, stage, created_at from ingestion_run order by design_system_id, created_at desc)
    select ds.id, ds.slug, ds.name, ds.category::text as category, ds.registry_status::text as registry_status, ds.ingestion_status::text as ingestion_status,
      ds.adapter_id, ds.last_ingested_at, ds.last_verified_at,
      coalesce(c.n, 0) as components, coalesce(c.classified, 0) as classified, coalesce(c.a11y, 0) as a11y, coalesce(c.props, 0) as props,
      coalesce(t.n, 0) as tokens, coalesce(t.sets, 0) as token_sets, coalesce(p.n, 0) as patterns, coalesce(e.n, 0) as evidence,
      coalesce(sd.n, 0) as documents, coalesce(er.n, 0) as open_errors,
      lr.id as run_id, lr.status as run_status, lr.stage as run_stage, lr.created_at as run_created_at
    from design_system ds
    left join c on c.design_system_id = ds.id
    left join t on t.design_system_id = ds.id
    left join p on p.design_system_id = ds.id
    left join e on e.design_system_id = ds.id
    left join sd on sd.design_system_id = ds.id
    left join er on er.design_system_id = ds.id
    left join lr on lr.design_system_id = ds.id
    ${whereAll(conds)}
    order by ${order}
  `);
  return res.rows.map((r) => ({
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    category: String(r.category),
    registryStatus: String(r.registry_status),
    ingestionStatus: String(r.ingestion_status),
    adapterId: str(r.adapter_id),
    lastIngestedAt: iso(r.last_ingested_at as Date | null),
    lastVerifiedAt: iso(r.last_verified_at as Date | null),
    components: num(r.components),
    componentsClassified: num(r.classified),
    componentsWithA11y: num(r.a11y),
    componentsWithProps: num(r.props),
    tokens: num(r.tokens),
    tokenSets: num(r.token_sets),
    patterns: num(r.patterns),
    evidence: num(r.evidence),
    documents: num(r.documents),
    openErrors: num(r.open_errors),
    lastRun: r.run_id ? { id: String(r.run_id), status: String(r.run_status), stage: str(r.run_stage), createdAt: iso(r.run_created_at as Date | null) } : null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Evidence inspector                                                           */
/* -------------------------------------------------------------------------- */

export const EVIDENCE_SUBJECTS = ["design_system", "component", "token_set", "token", "pattern", "source"] as const;

export interface EvidenceHit extends EvidenceRow {
  subjectType: string;
  subjectId: string;
  subjectLabel: string | null;
  system: string | null;
}

export async function searchEvidence(
  f: { system?: string; subjectType?: string; q?: string; state?: string; page: number; pageSize: number },
  db?: DB,
): Promise<{ rows: EvidenceHit[]; total: number; byState: Record<string, number> }> {
  const d = await d_(db);
  const conds: SQL[] = [];
  if (f.system) conds.push(sql`ds.slug = ${f.system}`);
  if (f.subjectType) conds.push(sql`v.subject_type = ${f.subjectType}`);
  if (f.state) conds.push(sql`v.state = ${f.state}`);
  if (f.q) {
    const p = containsPattern(f.q);
    conds.push(sql`(coalesce(c.name, pt.name, ts.name, tk.name, sds.name) ilike ${p} or v.field ilike ${p} or v.source_url ilike ${p} or v.extraction_method ilike ${p})`);
  }
  const from = sql`
    from verification_evidence v
    left join design_system ds on ds.id = v.design_system_id
    left join component c on v.subject_type = 'component' and c.id = v.subject_id
    left join design_pattern pt on v.subject_type = 'pattern' and pt.id = v.subject_id
    left join token_set ts on v.subject_type = 'token_set' and ts.id = v.subject_id
    left join token tk on v.subject_type = 'token' and tk.id = v.subject_id
    left join design_system sds on v.subject_type = 'design_system' and sds.id = v.subject_id
    ${whereAll(conds)}`;
  const [rows, states] = await Promise.all([
    d.execute<Row>(sql`
      select v.id, v.subject_type, v.subject_id, v.field, v.source_url, v.source_title, v.retrieved_at, v.content_hash, v.extraction_method, v.location, v.excerpt,
        v.state::text as state, v.confidence, ds.slug as system, coalesce(c.name, pt.name, ts.name, tk.name, sds.name) as subject_label, count(*) over() as total
      ${from}
      order by v.retrieved_at desc, v.id
      limit ${f.pageSize} offset ${(f.page - 1) * f.pageSize}`),
    d.execute<Row>(sql`select v.state::text as state, count(*)::int n ${from} group by 1`),
  ]);
  return {
    total: rows.rows.length ? num(rows.rows[0]!.total) : 0,
    byState: Object.fromEntries(states.rows.map((s) => [String(s.state), num(s.n)])),
    rows: rows.rows.map((v) => ({
      id: String(v.id),
      field: String(v.field),
      sourceUrl: String(v.source_url),
      sourceTitle: str(v.source_title),
      retrievedAt: v.retrieved_at as Date,
      contentHash: str(v.content_hash),
      extractionMethod: String(v.extraction_method),
      location: str(v.location),
      excerpt: str(v.excerpt),
      state: v.state as EvidenceRow["state"],
      confidence: num(v.confidence),
      subjectType: String(v.subject_type),
      subjectId: String(v.subject_id),
      subjectLabel: str(v.subject_label),
      system: str(v.system),
    })),
  };
}

/** Slugs + names for filter selects. */
export async function systemOptions(db?: DB): Promise<{ slug: string; name: string }[]> {
  const d = await d_(db);
  const r = await d.execute<{ slug: string; name: string }>(sql`select slug, name from design_system order by lower(name)`);
  return r.rows;
}

/* -------------------------------------------------------------------------- */
/* Public methodology figures (/about)                                          */
/* -------------------------------------------------------------------------- */

export interface MethodologyStats {
  registry: Record<string, number>;
  rankedCandidates: number;
  replacements: { from: string; to: string; toSlug: string; reason: "rejected" | "duplicate" | string }[];
  docAccess: Record<string, number>;
  evidenceByState: Record<string, number>;
  evidenceTotal: number;
  evidenceSources: number;
  classification: Record<string, number>;
  unclassified: number;
  componentsTotal: number;
  coverageStates: Record<string, number>;
  examples: { total: number; withCode: number };
  tokenSetsByRedistribution: Record<string, number>;
  tokens: number;
  documents: number;
  blockedDocuments: number;
  indexedSystems: number;
  lastIngestedAt: string | null;
}

export async function methodologyStats(db?: DB): Promise<MethodologyStats> {
  const d = await d_(db);
  const agg = (q: SQL) => sql`(select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (${q}) x)`;
  const r = await d.execute<Row>(sql`
    select
      ${agg(sql`select registry_status::text k, count(*)::int n from design_system group by 1`)} as registry,
      (select count(*)::int from design_system where registry_rank is not null) as ranked,
      (select coalesce(jsonb_agg(jsonb_build_object('from', coalesce(o.name, d.replaces_slug), 'to', d.name, 'toSlug', d.slug, 'reason', coalesce(o.registry_status::text, 'unknown')) order by d.name), '[]'::jsonb)
         from design_system d left join design_system o on o.slug = d.replaces_slug where d.replaces_slug is not null) as replacements,
      ${agg(sql`select doc_access::text k, count(*)::int n from design_system where registry_status = 'verified' group by 1`)} as doc_access,
      ${agg(sql`select state::text k, count(*)::int n from verification_evidence group by 1`)} as evidence,
      (select count(*)::int from verification_evidence) as evidence_total,
      (select count(distinct source_url)::int from verification_evidence) as evidence_sources,
      ${agg(sql`select classification_state::text k, count(*)::int n from component where publish_state = 'published' and component_type_id is not null group by 1`)} as classification,
      (select count(*)::int from component where publish_state = 'published' and component_type_id is null) as unclassified,
      (select count(*)::int from component where publish_state = 'published') as components,
      ${agg(sql`select value #>> '{}' k, count(*)::int n from component c, jsonb_each(c.coverage) where c.publish_state = 'published' group by 1`)} as coverage,
      (select count(*)::int from component_example) as examples,
      (select count(*)::int from component_example where code is not null) as examples_code,
      ${agg(sql`select redistribution::text k, count(*)::int n from token_set where publish_state = 'published' group by 1`)} as token_sets,
      (select count(*)::int from token t join token_set s on s.id = t.token_set_id where s.publish_state = 'published') as tokens,
      (select count(*)::int from source_document) as documents,
      (select count(*)::int from source_document where status = 'blocked') as blocked,
      (select count(*)::int from design_system where registry_status = 'verified' and ingestion_status in ('indexed', 'partial')) as indexed,
      (select max(last_ingested_at) from design_system) as last_ingested
  `);
  const x = r.rows[0]!;
  return {
    registry: x.registry as Record<string, number>,
    rankedCandidates: num(x.ranked),
    replacements: x.replacements as MethodologyStats["replacements"],
    docAccess: x.doc_access as Record<string, number>,
    evidenceByState: x.evidence as Record<string, number>,
    evidenceTotal: num(x.evidence_total),
    evidenceSources: num(x.evidence_sources),
    classification: x.classification as Record<string, number>,
    unclassified: num(x.unclassified),
    componentsTotal: num(x.components),
    coverageStates: x.coverage as Record<string, number>,
    examples: { total: num(x.examples), withCode: num(x.examples_code) },
    tokenSetsByRedistribution: x.token_sets as Record<string, number>,
    tokens: num(x.tokens),
    documents: num(x.documents),
    blockedDocuments: num(x.blocked),
    indexedSystems: num(x.indexed),
    lastIngestedAt: iso(x.last_ingested as Date | null),
  };
}
