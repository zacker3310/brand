/**
 * fetch: conditional fetch of every discovered document through PoliteFetcher (or adapter.fetch).
 * New content hash -> source_snapshot row; same hash -> bump last_seen_at. Failures are recorded
 * as ingestion_error and never fail the run by themselves. Each completed document is
 * checkpointed so an interrupted fetch resumes without refetching.
 */
import { inArray, sql } from "drizzle-orm";
import { sourceDocuments, sourceSnapshots } from "@/db/schema";
import type { FetchResult } from "../../http";
import { ensureCached } from "../cache";
import { engineConfig } from "../config";
import { sha256 } from "../hash";
import { checkpointDoc, mergeStats, recordError, type CheckpointDoc, type FetchOutcome } from "../runs";
import { AbortedError, interleaveByHost, pool, throwIfAborted, type StageContext } from "./context";

interface PrevDoc {
  id: string;
  etag: string | null;
  lastModified: string | null;
  lastHash: string | null;
  contentType: string | null;
}

export function fetchErrorCode(r: Pick<FetchResult, "blockedByRobots" | "error" | "status" | "ok" | "body">): string {
  if (r.blockedByRobots || r.error === "ROBOTS_DISALLOWED") return "ROBOTS_DISALLOWED";
  if (r.error === "TIMEOUT") return "TIMEOUT";
  if (r.error === "BODY_TOO_LARGE") return "BODY_TOO_LARGE";
  if (r.status >= 400) return `HTTP_${r.status}`;
  if (r.ok && r.body === null) return "EMPTY_BODY";
  if (r.error) return `NETWORK_${r.error.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase().slice(0, 40)}`;
  return "FETCH_FAILED";
}

/** Transient failures keep using the last known good content (doc stays active, run is partial). */
export function isTransient(code: string): boolean {
  return code === "TIMEOUT" || code === "HTTP_429" || /^HTTP_5\d\d$/.test(code) || code.startsWith("NETWORK_");
}

function failedResult(url: string, message: string): FetchResult {
  return {
    url,
    finalUrl: url,
    status: 0,
    ok: false,
    notModified: false,
    fromCache: false,
    contentType: null,
    etag: null,
    lastModified: null,
    body: null,
    hash: null,
    byteSize: 0,
    fetchedAt: new Date().toISOString(),
    attempts: 0,
    blockedByRobots: false,
    error: message,
  };
}

export async function fetchOne(sc: StageContext, cd: CheckpointDoc, prev: PrevDoc | undefined): Promise<FetchOutcome> {
  const { db, run, system, adapter, actx } = sc;
  const conditional = (sc.checkpoint.kind ?? "incremental") === "incremental";
  const prevInfo = { etag: conditional ? (prev?.etag ?? null) : null, lastModified: conditional ? (prev?.lastModified ?? null) : null, lastHash: prev?.lastHash ?? null };
  let result: FetchResult;
  try {
    result = adapter.fetch
      ? await adapter.fetch(actx, cd.doc, prevInfo)
      : await actx.http.get(cd.doc.url, { etag: prevInfo.etag, lastModified: prevInfo.lastModified, lastHash: prevInfo.lastHash, signal: sc.signal });
  } catch (e) {
    throwIfAborted(sc.signal);
    result = failedResult(cd.doc.url, (e as Error).message ?? String(e));
  }
  if (sc.signal.aborted) throw new AbortedError("fetch aborted");

  if (result.ok && result.body !== null && !result.blockedByRobots) {
    const hash = result.hash ?? sha256(result.body);
    await ensureCached(hash, result.body);
    const unchanged = result.notModified || hash === prev?.lastHash;
    await db
      .insert(sourceSnapshots)
      .values({
        sourceDocumentId: cd.id,
        runId: run.id,
        contentHash: hash,
        httpStatus: result.status,
        contentType: result.contentType ?? prev?.contentType ?? null,
        byteSize: result.byteSize || Buffer.byteLength(result.body),
        etag: result.etag,
        lastModified: result.lastModified,
        title: cd.doc.title ?? null,
      })
      .onConflictDoUpdate({ target: [sourceSnapshots.sourceDocumentId, sourceSnapshots.contentHash], set: { lastSeenAt: sql`now()` } });
    await db
      .update(sourceDocuments)
      .set({
        etag: result.etag ?? (unchanged ? (prev?.etag ?? null) : null),
        lastModified: result.lastModified ?? (unchanged ? (prev?.lastModified ?? null) : null),
        lastHash: hash,
        lastFetchedAt: new Date(result.fetchedAt),
        lastStatus: result.status,
        contentType: result.contentType ?? prev?.contentType ?? null,
        status: "active",
        updatedAt: sql`now()`,
      })
      .where(sql`${sourceDocuments.id} = ${cd.id}`);
    return {
      outcome: unchanged ? "unchanged" : "changed",
      hash,
      status: result.status,
      finalUrl: result.finalUrl,
      contentType: result.contentType ?? prev?.contentType ?? null,
      fetchedAt: result.fetchedAt,
    };
  }

  const code = fetchErrorCode(result);
  const blocked = code === "ROBOTS_DISALLOWED";
  const stale = !blocked && isTransient(code) && !!prev?.lastHash;
  await recordError(
    {
      runId: run.id,
      jobId: sc.job.id,
      designSystemId: system.id,
      stage: "fetch",
      code,
      message: `${code}${result.error && result.error !== code ? `: ${result.error}` : ""}${stale ? " (using last known content)" : ""}`,
      url: cd.doc.url,
      details: { status: result.status, attempts: result.attempts, finalUrl: result.finalUrl },
    },
    db,
  );
  await db
    .update(sourceDocuments)
    .set({ lastStatus: result.status || null, status: stale ? "active" : blocked ? "blocked" : "error", updatedAt: sql`now()` })
    .where(sql`${sourceDocuments.id} = ${cd.id}`);
  return {
    outcome: blocked ? "blocked" : stale ? "stale" : "error",
    hash: stale ? prev!.lastHash : null,
    status: result.status,
    finalUrl: result.finalUrl,
    contentType: prev?.contentType ?? null,
    fetchedAt: null,
    error: code,
  };
}

export function fetchStats(done: Record<string, FetchOutcome>) {
  const v = Object.values(done);
  const n = (k: FetchOutcome["outcome"]) => v.filter((o) => o.outcome === k).length;
  return { fetched: n("changed"), notModified: n("unchanged"), stale: n("stale"), fetchErrors: n("error") + n("blocked") + n("stale"), robotsBlocked: n("blocked") };
}

export async function fetchStage(sc: StageContext): Promise<ReturnType<typeof fetchStats>> {
  const { db, run } = sc;
  const docs = sc.checkpoint.discover?.docs ?? [];
  const done: Record<string, FetchOutcome> = { ...(sc.checkpoint.fetch?.done ?? {}) };
  const pending = interleaveByHost(
    docs.filter((d) => !done[d.id]),
    (d) => d.doc.url,
  );
  const prevRows = pending.length
    ? await db
        .select({ id: sourceDocuments.id, etag: sourceDocuments.etag, lastModified: sourceDocuments.lastModified, lastHash: sourceDocuments.lastHash, contentType: sourceDocuments.contentType })
        .from(sourceDocuments)
        .where(inArray(sourceDocuments.id, pending.map((d) => d.id)))
    : [];
  const prev = new Map(prevRows.map((r) => [r.id, r]));
  sc.log.info(`fetching ${pending.length} documents (${docs.length - pending.length} already checkpointed)`);
  const cfg = engineConfig();
  let completed = Object.keys(done).length;
  await pool(
    pending,
    cfg.fetchConcurrency,
    async (cd) => {
      const outcome = await fetchOne(sc, cd, prev.get(cd.id));
      await checkpointDoc(run.id, "fetch", cd.id, outcome, db);
      done[cd.id] = outcome;
      const index = completed++;
      await cfg.hooks.afterDocument?.({ stage: "fetch", runId: run.id, documentId: cd.id, index });
    },
    sc.signal,
  );
  const stats = fetchStats(done);
  await mergeStats(run.id, stats, db);
  sc.log.info(`fetch done`, stats);
  return stats;
}
