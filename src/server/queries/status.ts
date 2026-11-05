import { sql, type SQL } from "drizzle-orm";

/**
 * The index depth of a system's *published* records, for public read models.
 *
 * `design_system.ingestion_status` doubles as a workflow state: the engine sets it to `queued` /
 * `running` when a re-ingest starts (and `failed` when one fails) while the records the previous run
 * published stay live. Public pages describe what is published, so for those transient states this
 * falls back to the status the most recent successful publish recorded (`ingestion_run.checkpoint
 * ->'publish'->>'ingestionStatus'`). A system that never completed a publish keeps its raw status.
 * Ops views keep reading the raw column: they are about the workflow.
 *
 * `alias` is the SQL alias of a `design_system` row in the surrounding query (internal constant).
 */
export function publishedIngestionStatus(alias: string): SQL {
  const ds = sql.raw(alias);
  return sql`(case when ${ds}.ingestion_status in ('queued', 'running', 'failed') then coalesce((
      select r.checkpoint->'publish'->>'ingestionStatus' from ingestion_run r
      where r.design_system_id = ${ds}.id and r.status = 'succeeded' and r.checkpoint->'publish'->>'ingestionStatus' is not null
      order by r.finished_at desc nulls last limit 1
    ), ${ds}.ingestion_status::text) else ${ds}.ingestion_status::text end)`;
}
