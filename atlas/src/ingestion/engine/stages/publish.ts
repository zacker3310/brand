/**
 * publish: current fragments -> adapter.normalize -> contract + generic + adapter validation ->
 * one extraction row per entity -> promotion of valid/warning extractions inside a transaction
 * (per-entity savepoints, per-system advisory lock) -> coverage, ingestion status, search reindex.
 *
 * Invalid / conflicting extractions are quarantined: they stay in `extraction` for Ops and never
 * touch published records. Retirement of absent records only happens for complete runs (no
 * limit, no fetch/parse errors, no bundle-level validation errors).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { NormalizedBundle, type NormalizedComponent, type RunStats, type ValidationIssue } from "@/lib/contracts";
import { componentTypes, designSystems, extractions, frameworks, licenses, patternTypes, sourceSnapshots } from "@/db/schema";
import { COMPONENT_TYPES, PATTERN_TYPES } from "@/lib/taxonomy";
import type { ParsedFragment } from "../../types";
import { engineConfig } from "../config";
import { computeSystemCoverage, coverageChanged } from "../coverage";
import { buildSnapshotLookup, type Tx } from "../evidence";
import { contentHash, toJson } from "../hash";
import { finishRun, mergeStats, recordError, setCheckpointKey } from "../runs";
import { validateBundle, type ValidatedEntity } from "../validate";
import { NonRetryableError, type StageContext } from "./context";
import { fetchStats } from "./fetch";
import { parseStats } from "./parse";
import { promoteComponents, enforceExampleLicense, syncRelationships, syncTokenUsages } from "./promote-components";
import type { PromoteContext } from "./promote-common";
import { promoteFacts, promotePatterns } from "./promote-patterns";
import { promoteTokenSets } from "./promote-tokens";
import { parsedFragments } from "@/db/schema";

const KNOWN_COMPONENT_TYPES = new Set(COMPONENT_TYPES.map((c) => c.slug));
const KNOWN_PATTERN_TYPES = new Set(PATTERN_TYPES.map((p) => p.slug));

export interface PublishSummary {
  runStatus: "succeeded" | "partial" | "failed";
  ingestionStatus: "indexed" | "partial" | "failed";
  stats: RunStats;
  bundleIssues: ValidationIssue[];
}

async function loadFragments(sc: StageContext): Promise<ParsedFragment[]> {
  const parseDone = sc.checkpoint.parse?.done ?? {};
  const docs = (sc.checkpoint.discover?.docs ?? []).filter((cd) => {
    const o = parseDone[cd.id];
    return o && (o.outcome === "parsed" || o.outcome === "reused") && o.hash;
  });
  if (!docs.length) return [];
  const rows = [];
  for (let i = 0; i < docs.length; i += 500) {
    rows.push(
      ...(await sc.db
        .select({ docId: parsedFragments.sourceDocumentId, hash: parsedFragments.contentHash, fragments: parsedFragments.fragments })
        .from(parsedFragments)
        .where(
          and(
            eq(parsedFragments.adapterId, sc.adapter.id),
            eq(parsedFragments.adapterVersion, sc.adapter.version),
            inArray(parsedFragments.sourceDocumentId, docs.slice(i, i + 500).map((d) => d.id)),
          ),
        )),
    );
  }
  const byKey = new Map(rows.map((r) => [`${r.docId}:${r.hash}`, r.fragments as ParsedFragment[]]));
  // Discovery order (priority, then URL) keeps normalize input deterministic across runs.
  return docs.flatMap((cd) => byKey.get(`${cd.id}:${parseDone[cd.id]!.hash}`) ?? []);
}

function recomputeValidation(e: ValidatedEntity) {
  const own = e.issues.filter((i) => i.entityKind !== "token");
  e.validation = own.some((i) => i.code === "CONFLICT") ? "conflict" : own.some((i) => i.severity === "error") ? "invalid" : e.issues.length ? "warning" : "valid";
}

export async function publishStage(sc: StageContext): Promise<PublishSummary> {
  const { db, run, system, adapter, actx } = sc;
  const fragments = await loadFragments(sc);

  let bundle: unknown;
  try {
    bundle = toJson(await adapter.normalize(actx, fragments));
  } catch (e) {
    await recordError({ runId: run.id, jobId: sc.job.id, designSystemId: system.id, stage: "normalize", code: "NORMALIZE_FAILED", message: (e as Error).message ?? String(e) }, db);
    throw new NonRetryableError(`normalize failed: ${(e as Error).message}`);
  }
  const contract = NormalizedBundle.safeParse(bundle);
  let adapterIssues: ValidationIssue[] = [];
  const extraBundleIssues: ValidationIssue[] = [];
  if (adapter.validate) {
    try {
      adapterIssues = adapter.validate(actx, (contract.success ? contract.data : bundle) as NormalizedBundle) ?? [];
    } catch (e) {
      extraBundleIssues.push({ entityKind: "bundle", entityKey: system.slug, code: "ADAPTER_VALIDATE_FAILED", message: (e as Error).message ?? String(e), severity: "warning" });
    }
  }
  if (!contract.success) {
    extraBundleIssues.push({ entityKind: "bundle", entityKey: system.slug, code: "CONTRACT", message: `bundle failed NormalizedBundle contract (${contract.error.issues.length} issues); entities validated individually`, severity: "warning" });
  }
  const v = validateBundle(bundle, { systemSlug: system.slug, adapterIssues });
  v.bundleIssues.push(...extraBundleIssues);

  // License-aware example code: store code only when redistribution is permitted.
  const [lic] = system.licenseId ? await db.select({ redistribution: licenses.redistribution }).from(licenses).where(eq(licenses.id, system.licenseId)) : [];
  const redistribution = lic?.redistribution ?? "unknown";
  for (const e of v.entities) {
    if (e.kind !== "component" || !e.parsed || e.validation === "conflict") continue;
    const { component, stripped } = enforceExampleLicense(e.payload as unknown as NormalizedComponent, redistribution);
    if (stripped.length) {
      e.payload = component as unknown as Record<string, unknown>;
      e.hash = contentHash(e.payload);
      e.issues.push({ entityKind: "component", entityKey: e.key, code: "LICENSE_CODE_STRIPPED", message: `code removed from ${stripped.length} example(s): system license redistribution is "${redistribution}"`, severity: "warning" });
      recomputeValidation(e);
    }
  }

  // Staging rows (one per entity per run).
  for (let i = 0; i < v.entities.length; i += 200) {
    const chunk = v.entities.slice(i, i + 200).map((e) => ({
      runId: run.id,
      designSystemId: system.id,
      entityKind: e.kind,
      entityKey: e.key,
      payload: e.payload,
      contentHash: e.hash,
      validation: e.validation,
      issues: e.issues.map((x) => ({ code: x.code, message: x.message, path: x.entityKind === "token" ? `token:${x.entityKey}` : x.path, severity: x.severity })),
      published: false,
    }));
    await db
      .insert(extractions)
      .values(chunk)
      .onConflictDoUpdate({
        target: [extractions.runId, extractions.entityKind, extractions.entityKey],
        set: { payload: sql`excluded.payload`, contentHash: sql`excluded.content_hash`, validation: sql`excluded.validation`, issues: sql`excluded.issues`, published: false },
      });
  }
  for (const issue of v.bundleIssues) {
    await recordError({ runId: run.id, jobId: sc.job.id, designSystemId: system.id, stage: "validate", code: issue.code, message: issue.message, severity: issue.severity }, db);
  }
  const quarantined = v.entities.filter((e) => e.validation === "invalid" || e.validation === "conflict");
  for (const q of quarantined.slice(0, 200)) {
    const first = q.issues.find((i) => i.severity === "error") ?? q.issues[0];
    await recordError(
      {
        runId: run.id,
        jobId: sc.job.id,
        designSystemId: system.id,
        stage: "validate",
        severity: "warning",
        code: `QUARANTINED_${first?.code ?? "INVALID"}`,
        message: `${q.kind} "${q.key}" quarantined: ${first?.message ?? q.validation}`,
        details: { entityKind: q.kind, entityKey: q.key, validation: q.validation, issues: q.issues.slice(0, 5) },
      },
      db,
    );
  }

  const fstats = fetchStats(sc.checkpoint.fetch?.done ?? {});
  const pstats = parseStats(sc.checkpoint.parse?.done ?? {});
  const limited = sc.checkpoint.limit != null;
  const allowRemovals = !limited && fstats.fetchErrors === 0 && pstats.parseErrors === 0 && !v.blockRemovals;
  if (!allowRemovals) sc.log.info(`removals disabled for this run (limited=${limited}, fetchErrors=${fstats.fetchErrors}, parseErrors=${pstats.parseErrors}, bundleErrors=${v.blockRemovals})`);

  const promotable = (kind: ValidatedEntity["kind"]) => v.entities.filter((e) => e.kind === kind && e.parsed && (e.validation === "valid" || e.validation === "warning"));
  const keysOf = (kind: ValidatedEntity["kind"]) => new Set(v.entities.filter((e) => e.kind === kind).map((e) => e.key));

  // Snapshot links for evidence: documents used in this run -> their current snapshot.
  const parseDone = sc.checkpoint.parse?.done ?? {};
  const usedDocs = (sc.checkpoint.discover?.docs ?? []).filter((cd) => parseDone[cd.id]?.hash);
  const snaps = usedDocs.length
    ? await db
        .select({ id: sourceSnapshots.id, docId: sourceSnapshots.sourceDocumentId, hash: sourceSnapshots.contentHash })
        .from(sourceSnapshots)
        .where(inArray(sourceSnapshots.sourceDocumentId, usedDocs.map((d) => d.id)))
    : [];
  const snapByKey = new Map(snaps.map((s) => [`${s.docId}:${s.hash}`, s.id]));
  const lookup = buildSnapshotLookup(
    usedDocs
      .map((cd) => ({ url: cd.doc.url, evidenceUrl: cd.doc.evidenceUrl ?? null, hash: parseDone[cd.id]!.hash, snapshotId: snapByKey.get(`${cd.id}:${parseDone[cd.id]!.hash}`) ?? "" }))
      .filter((x) => x.snapshotId),
  );

  const typeIds = new Map((await db.select({ id: componentTypes.id, slug: componentTypes.slug }).from(componentTypes)).map((r) => [r.slug, r.id]));
  const patternTypeIds = new Map((await db.select({ id: patternTypes.id, slug: patternTypes.slug }).from(patternTypes)).map((r) => [r.slug, r.id]));
  const frameworkIds = new Map((await db.select({ id: frameworks.id, slug: frameworks.slug }).from(frameworks)).map((r) => [r.slug, r.id]));
  const runDate = new Date();
  const entityErrors: { e: ValidatedEntity; err: unknown }[] = [];

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`atlas:publish:${system.id}`}))`);
    const pc: PromoteContext = {
      tx: tx as unknown as Tx,
      systemId: system.id,
      systemSlug: system.slug,
      runId: run.id,
      licenseId: system.licenseId,
      redistribution,
      typeIds,
      patternTypeIds,
      frameworkIds,
      lookup,
      runDate,
      allowRemovals,
      allowTokenDeletion: !limited,
      onEntityError: async (e, err) => {
        entityErrors.push({ e, err });
      },
    };
    const tok = await promoteTokenSets(pc, promotable("token-set"), keysOf("token-set"));
    const comps = await promoteComponents(pc, v.blockComponents ? [] : promotable("component"), v.blockComponents ? new Set() : keysOf("component"), KNOWN_COMPONENT_TYPES);
    const compEntities = promotable("component").filter((e) => comps.promotedKeys.has(e.key));
    await syncRelationships(pc, compEntities, comps.slugToId);
    await syncTokenUsages(pc, compEntities, comps.slugToId);
    const pats = await promotePatterns(pc, promotable("pattern"), keysOf("pattern"), comps.slugToId, KNOWN_PATTERN_TYPES);
    const factsEntity = promotable("system-facts")[0];
    const facts = factsEntity ? await promoteFacts(pc, factsEntity) : null;

    const published: [string, Set<string>][] = [
      ["component", comps.promotedKeys],
      ["token-set", tok.promotedKeys],
      ["pattern", pats.promotedKeys],
      ["system-facts", facts && facts !== "failed" ? new Set(["facts"]) : new Set()],
    ];
    for (const [kind, keys] of published) {
      const list = [...keys];
      for (let i = 0; i < list.length; i += 1000) {
        await tx
          .update(extractions)
          .set({ published: true })
          .where(and(eq(extractions.runId, run.id), eq(extractions.entityKind, kind), inArray(extractions.entityKey, list.slice(i, i + 1000))));
      }
    }
    return { tok, comps, pats, facts };
  });

  for (const { e, err } of entityErrors) {
    await recordError({ runId: run.id, jobId: sc.job.id, designSystemId: system.id, stage: "publish", code: "PROMOTE_FAILED", message: `${e.kind} "${e.key}": ${(err as Error).message ?? String(err)}` }, db);
    await db
      .update(extractions)
      .set({ validation: "invalid", issues: sql`coalesce(${extractions.issues}, '[]'::jsonb) || ${JSON.stringify([{ code: "PROMOTE_FAILED", message: String((err as Error).message ?? err).slice(0, 500), severity: "error" }])}::jsonb` })
      .where(and(eq(extractions.runId, run.id), eq(extractions.entityKind, e.kind), eq(extractions.entityKey, e.key)));
  }

  const coverage = await computeSystemCoverage(db, system.id);
  const [current] = await db.select({ coverage: designSystems.coverage }).from(designSystems).where(eq(designSystems.id, system.id));
  const publishedNow = coverage.components + coverage.tokens;
  const fatal = v.blockRemovals;
  const fetchParseErrors = fstats.fetchErrors + pstats.parseErrors;
  const ingestionStatus: PublishSummary["ingestionStatus"] = publishedNow === 0 ? "failed" : fatal || fetchParseErrors > 0 ? "partial" : "indexed";
  const { tok, comps, pats, facts } = result;
  const promotedCount = comps.promotedKeys.size + tok.promotedKeys.size + pats.promotedKeys.size + (facts && facts !== "failed" ? 1 : 0);
  const runStatus: PublishSummary["runStatus"] =
    promotedCount === 0 && (fatal || publishedNow === 0) ? "failed" : fatal || fetchParseErrors > 0 || quarantined.length > 0 || entityErrors.length > 0 ? "partial" : "succeeded";
  await db
    .update(designSystems)
    .set({
      ...(coverageChanged(current?.coverage, coverage) ? { coverage } : {}),
      ingestionStatus,
      lastIngestedAt: runDate,
      adapterId: sql`coalesce(${designSystems.adapterId}, ${adapter.id})`,
    })
    .where(eq(designSystems.id, system.id));

  await setCheckpointKey(run.id, "publish", { ingestionStatus, completedAt: runDate.toISOString() }, db);
  const sum = (k: "created" | "updated" | "unchanged" | "removed") => tok.counters[k] + comps.counters[k] + pats.counters[k];
  const promotedTokens = promotable("token-set")
    .filter((e) => tok.promotedKeys.has(e.key))
    .reduce((n, e) => n + ((e.payload.tokens as unknown[])?.length ?? 0) - (e.droppedTokens?.length ?? 0), 0);
  const stats: RunStats = {
    extracted: v.entities.length,
    valid: v.entities.filter((e) => e.validation === "valid").length,
    warnings: v.entities.filter((e) => e.validation === "warning").length,
    quarantined: quarantined.length,
    published: promotedCount,
    created: sum("created"),
    updated: sum("updated") + (facts === "updated" ? 1 : 0),
    unchanged: sum("unchanged") + (facts === "unchanged" ? 1 : 0),
    removed: sum("removed"),
    components: comps.promotedKeys.size,
    tokens: promotedTokens,
    tokenSets: tok.promotedKeys.size,
    patterns: pats.promotedKeys.size,
    tokensAdded: tok.tokensAdded,
    tokensUpdated: tok.tokensUpdated,
    tokensRemoved: tok.tokensRemoved,
    promoteErrors: entityErrors.length,
    bundleErrors: v.bundleIssues.filter((i) => i.severity === "error").length,
  };
  await mergeStats(run.id, stats, db);
  await finishRun(run.id, runStatus, db);
  try {
    await engineConfig().reindex(system.slug);
  } catch (e) {
    await recordError({ runId: run.id, jobId: sc.job.id, designSystemId: system.id, stage: "publish", code: "REINDEX_FAILED", severity: "warning", message: (e as Error).message ?? String(e) }, db);
  }
  sc.log.info(`publish ${runStatus}`, { ...stats, ingestionStatus });
  return { runStatus, ingestionStatus, stats, bundleIssues: v.bundleIssues };
}
