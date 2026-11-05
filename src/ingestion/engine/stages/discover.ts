/**
 * discover: adapter.discover() -> upsert source + source_document rows. Documents that were not
 * rediscovered become status 'gone' (never deleted). Limited runs never mark documents gone.
 */
import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { sourceDocuments, sources } from "@/db/schema";
import type { DiscoveredDocument } from "../../types";
import { mergeStats, recordError, setCheckpointKey, type CheckpointDoc } from "../runs";
import { throwIfAborted, type StageContext } from "./context";

const isHttp = (u: string) => {
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:";
  } catch {
    return false;
  }
};

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function discoverStage(sc: StageContext): Promise<{ discovered: number; gone: number }> {
  const { db, run, system, adapter, actx } = sc;
  let raw: DiscoveredDocument[];
  try {
    raw = await adapter.discover(actx);
  } catch (e) {
    throwIfAborted(sc.signal);
    await recordError({ runId: run.id, jobId: sc.job.id, designSystemId: system.id, stage: "discover", code: "DISCOVER_FAILED", message: (e as Error).message ?? String(e) }, db);
    throw e;
  }
  throwIfAborted(sc.signal);

  // Dedupe by URL (lowest priority wins), drop non-http(s) URLs.
  const byUrl = new Map<string, DiscoveredDocument>();
  for (const d of raw ?? []) {
    if (!d || typeof d.url !== "string" || !isHttp(d.url) || !d.source || !isHttp(d.source.url)) {
      await recordError(
        { runId: run.id, jobId: sc.job.id, designSystemId: system.id, stage: "discover", code: "INVALID_URL", severity: "warning", message: `adapter discovered an invalid document URL`, url: String(d?.url ?? "").slice(0, 500) },
        db,
      );
      continue;
    }
    const prev = byUrl.get(d.url);
    if (!prev || (d.priority ?? 100) < (prev.priority ?? 100)) byUrl.set(d.url, JSON.parse(JSON.stringify(d)) as DiscoveredDocument);
  }
  const docs = [...byUrl.values()].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.url.localeCompare(b.url));

  // Sources (system + url).
  const srcByUrl = new Map<string, { kind: string; url: string; label?: string }>();
  for (const d of docs) if (!srcByUrl.has(d.source.url)) srcByUrl.set(d.source.url, d.source);
  const srcRows = [...srcByUrl.values()];
  for (const part of chunks(srcRows, 500)) {
    await db
      .insert(sources)
      .values(part.map((s) => ({ designSystemId: system.id, kind: s.kind, url: s.url, label: s.label ?? null, discoveredBy: `adapter:${adapter.id}` })))
      .onConflictDoNothing({ target: [sources.designSystemId, sources.url] });
  }
  const sourceIds = new Map<string, string>();
  for (const part of chunks(srcRows.map((s) => s.url), 500)) {
    const rows = await db.select({ id: sources.id, url: sources.url }).from(sources).where(and(eq(sources.designSystemId, system.id), inArray(sources.url, part)));
    for (const r of rows) sourceIds.set(r.url, r.id);
  }

  // Documents (system + url).
  for (const part of chunks(docs, 500)) {
    await db
      .insert(sourceDocuments)
      .values(part.map((d) => ({ sourceId: sourceIds.get(d.source.url)!, designSystemId: system.id, url: d.url, docKind: d.docKind, title: d.title ?? null, status: "active" })))
      .onConflictDoUpdate({
        target: [sourceDocuments.designSystemId, sourceDocuments.url],
        set: {
          sourceId: sql`excluded.source_id`,
          docKind: sql`excluded.doc_kind`,
          title: sql`coalesce(excluded.title, ${sourceDocuments.title})`,
          status: sql`'active'`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`(${sourceDocuments.sourceId}, ${sourceDocuments.docKind}, ${sourceDocuments.status}) is distinct from (excluded.source_id, excluded.doc_kind, 'active')
          or (excluded.title is not null and ${sourceDocuments.title} is distinct from excluded.title)`,
      });
  }
  const docIds = new Map<string, string>();
  for (const part of chunks(docs.map((d) => d.url), 500)) {
    const rows = await db
      .select({ id: sourceDocuments.id, url: sourceDocuments.url })
      .from(sourceDocuments)
      .where(and(eq(sourceDocuments.designSystemId, system.id), inArray(sourceDocuments.url, part)));
    for (const r of rows) docIds.set(r.url, r.id);
  }

  let gone = 0;
  const limited = sc.checkpoint.limit != null;
  if (!limited) {
    const ids = [...docIds.values()];
    const res = await db
      .update(sourceDocuments)
      .set({ status: "gone", updatedAt: sql`now()` })
      .where(and(eq(sourceDocuments.designSystemId, system.id), ne(sourceDocuments.status, "gone"), ids.length ? notInArray(sourceDocuments.id, ids) : sql`true`))
      .returning({ id: sourceDocuments.id });
    gone = res.length;
  }

  const cpDocs: CheckpointDoc[] = docs.map((d) => ({ id: docIds.get(d.url)!, doc: d }));
  await setCheckpointKey(run.id, "discover", { docs: cpDocs, gone, completedAt: new Date().toISOString() }, db);
  if (!sc.checkpoint.fetch) await setCheckpointKey(run.id, "fetch", { done: {} }, db);
  await mergeStats(run.id, { discovered: docs.length, gone }, db);
  sc.log.info(`discovered ${docs.length} documents (${gone} gone)`);
  return { discovered: docs.length, gone };
}
