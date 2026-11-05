/**
 * parse: adapter.parse() per fetched document body. Output is persisted in parsed_fragment keyed
 * by (document, adapterId, adapterVersion, contentHash) and reused when that key already exists,
 * so unchanged documents are never re-parsed. Parse exceptions are recorded and skipped.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { parsedFragments, sourceDocuments, sourceSnapshots } from "@/db/schema";
import type { FetchResult } from "../../http";
import type { ParsedFragment } from "../../types";
import { readCachedBody } from "../cache";
import { engineConfig } from "../config";
import { toJson } from "../hash";
import { checkpointDoc, mergeStats, recordError, type CheckpointDoc, type FetchOutcome, type ParseOutcome } from "../runs";
import { pool, throwIfAborted, type StageContext } from "./context";

const USABLE = new Set<FetchOutcome["outcome"]>(["changed", "unchanged", "stale"]);

export function usableDocs(sc: StageContext): { cd: CheckpointDoc; fo: FetchOutcome }[] {
  const fetched = sc.checkpoint.fetch?.done ?? {};
  return (sc.checkpoint.discover?.docs ?? [])
    .map((cd) => ({ cd, fo: fetched[cd.id]! }))
    .filter((x) => x.fo && USABLE.has(x.fo.outcome) && !!x.fo.hash);
}

/** Get the body for a document version from cache; refetch when the cache lost it. */
async function loadBody(sc: StageContext, cd: CheckpointDoc, fo: FetchOutcome): Promise<{ body: string; hash: string; result: FetchResult } | null> {
  const hash = fo.hash!;
  const cached = await readCachedBody(hash);
  const base: FetchResult = {
    url: cd.doc.url,
    finalUrl: fo.finalUrl ?? cd.doc.url,
    status: fo.status,
    ok: true,
    notModified: fo.outcome === "unchanged" && fo.status === 304,
    fromCache: true,
    contentType: fo.contentType,
    etag: null,
    lastModified: null,
    body: cached,
    hash,
    byteSize: cached ? Buffer.byteLength(cached) : 0,
    fetchedAt: fo.fetchedAt ?? sc.actx.runStartedAt,
    attempts: 0,
    blockedByRobots: false,
    error: null,
  };
  if (cached !== null) return { body: cached, hash, result: base };
  // Cache miss: refetch unconditionally.
  const res = sc.adapter.fetch ? await sc.adapter.fetch(sc.actx, cd.doc, {}) : await sc.actx.http.get(cd.doc.url, { signal: sc.signal });
  if (!res.ok || res.body === null) return null;
  const newHash = res.hash!;
  if (newHash !== hash) {
    // Content changed between fetch and parse: record the new version so provenance stays exact.
    await sc.db
      .insert(sourceSnapshots)
      .values({ sourceDocumentId: cd.id, runId: sc.run.id, contentHash: newHash, httpStatus: res.status, contentType: res.contentType, byteSize: res.byteSize, etag: res.etag, lastModified: res.lastModified, title: cd.doc.title ?? null })
      .onConflictDoUpdate({ target: [sourceSnapshots.sourceDocumentId, sourceSnapshots.contentHash], set: { lastSeenAt: sql`now()` } });
    await sc.db
      .update(sourceDocuments)
      .set({ lastHash: newHash, etag: res.etag, lastModified: res.lastModified, lastFetchedAt: new Date(res.fetchedAt), lastStatus: res.status, updatedAt: sql`now()` })
      .where(eq(sourceDocuments.id, cd.id));
  }
  return { body: res.body, hash: newHash, result: res };
}

export function parseStats(done: Record<string, ParseOutcome>) {
  const v = Object.values(done);
  return {
    parsed: v.filter((o) => o.outcome === "parsed").length,
    parseReused: v.filter((o) => o.outcome === "reused").length,
    parseErrors: v.filter((o) => o.outcome === "error").length,
    fragments: v.reduce((n, o) => n + o.fragments, 0),
  };
}

export async function parseStage(sc: StageContext): Promise<ReturnType<typeof parseStats>> {
  const { db, run, system, adapter } = sc;
  const done: Record<string, ParseOutcome> = { ...(sc.checkpoint.parse?.done ?? {}) };
  const docs = usableDocs(sc);
  const pending = docs.filter((x) => !done[x.cd.id] || done[x.cd.id]!.hash !== x.fo.hash);
  const existing = new Map<string, number>();
  if (pending.length) {
    const rows = await db
      .select({ docId: parsedFragments.sourceDocumentId, hash: parsedFragments.contentHash, n: sql<number>`jsonb_array_length(${parsedFragments.fragments})::int` })
      .from(parsedFragments)
      .where(and(eq(parsedFragments.adapterId, adapter.id), eq(parsedFragments.adapterVersion, adapter.version), inArray(parsedFragments.sourceDocumentId, pending.map((x) => x.cd.id))));
    for (const r of rows) existing.set(`${r.docId}:${r.hash}`, r.n);
  }
  sc.log.info(`parsing ${pending.length} documents (${docs.length - pending.length} already checkpointed)`);
  const cfg = engineConfig();
  let completed = Object.keys(done).length;
  await pool(
    pending,
    cfg.parseConcurrency,
    async ({ cd, fo }) => {
      let outcome: ParseOutcome;
      const reuse = existing.get(`${cd.id}:${fo.hash}`);
      if (reuse !== undefined) {
        outcome = { outcome: "reused", hash: fo.hash, fragments: reuse };
      } else {
        try {
          const loaded = await loadBody(sc, cd, fo);
          if (!loaded) throw Object.assign(new Error("document body unavailable (cache miss and refetch failed)"), { code: "PARSE_NO_BODY" });
          const reuse2 = loaded.hash !== fo.hash ? undefined : existing.get(`${cd.id}:${loaded.hash}`);
          if (reuse2 !== undefined) {
            outcome = { outcome: "reused", hash: loaded.hash, fragments: reuse2 };
          } else {
            const out = await adapter.parse(sc.actx, { doc: cd.doc, result: loaded.result });
            throwIfAborted(sc.signal);
            const list: ParsedFragment[] = out == null ? [] : Array.isArray(out) ? out : [out];
            const json = toJson(list);
            await db
              .insert(parsedFragments)
              .values({ sourceDocumentId: cd.id, adapterId: adapter.id, adapterVersion: adapter.version, contentHash: loaded.hash, fragments: json })
              .onConflictDoNothing({ target: [parsedFragments.sourceDocumentId, parsedFragments.adapterId, parsedFragments.adapterVersion, parsedFragments.contentHash] });
            outcome = { outcome: "parsed", hash: loaded.hash, fragments: json.length };
          }
        } catch (e) {
          throwIfAborted(sc.signal);
          const code = (e as { code?: string }).code === "PARSE_NO_BODY" ? "PARSE_NO_BODY" : "PARSE_FAILED";
          await recordError({ runId: run.id, jobId: sc.job.id, designSystemId: system.id, stage: "parse", code, message: (e as Error).message ?? String(e), url: cd.doc.url, details: { docKind: cd.doc.docKind } }, db);
          outcome = { outcome: "error", hash: fo.hash, fragments: 0 };
        }
      }
      await checkpointDoc(run.id, "parse", cd.id, outcome, db);
      done[cd.id] = outcome;
      const index = completed++;
      await cfg.hooks.afterDocument?.({ stage: "parse", runId: run.id, documentId: cd.id, index });
    },
    sc.signal,
  );
  const stats = parseStats(done);
  await mergeStats(run.id, stats, db);
  sc.log.info(`parse done`, stats);
  return stats;
}
