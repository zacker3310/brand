/**
 * verification_evidence upserts (unique subject/field/sourceUrl/method) with snapshot linking.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { EvidenceInput } from "@/lib/contracts";
import type { DB } from "@/db/client";
import { verificationEvidence } from "@/db/schema";

export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type SubjectType = "design_system" | "component" | "token_set" | "token" | "pattern" | "source";

/** Resolves an evidence entry to a fetched snapshot (by content hash, then by document/evidence URL). */
export interface SnapshotLookup {
  byUrl: Map<string, string>;
  byHash: Map<string, string>;
}

const normUrl = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "");

export function buildSnapshotLookup(entries: { url: string; evidenceUrl?: string | null; hash: string | null; snapshotId: string }[]): SnapshotLookup {
  const byUrl = new Map<string, string>();
  const byHash = new Map<string, string>();
  for (const e of entries) {
    byUrl.set(normUrl(e.url), e.snapshotId);
    if (e.evidenceUrl) byUrl.set(normUrl(e.evidenceUrl), e.snapshotId);
    if (e.hash) byHash.set(e.hash, e.snapshotId);
  }
  return { byUrl, byHash };
}

export function snapshotFor(lookup: SnapshotLookup, e: Pick<EvidenceInput, "sourceUrl" | "contentHash">): string | null {
  if (e.contentHash && lookup.byHash.has(e.contentHash)) return lookup.byHash.get(e.contentHash)!;
  return lookup.byUrl.get(normUrl(e.sourceUrl)) ?? null;
}

const bounded = (s: string | null | undefined, max: number) => {
  if (!s) return null;
  const c = s.replace(/\s+/g, " ").trim();
  return c.length > max ? `${c.slice(0, max - 1)}…` : c;
};

function toDate(iso: string, fallback: Date): Date {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export interface UpsertEvidenceOptions {
  subjectType: SubjectType;
  subjectId: string;
  designSystemId: string;
  evidence: EvidenceInput[];
  lookup: SnapshotLookup;
  fallbackDate: Date;
  /** Delete this subject's evidence rows that are no longer produced (except registry research). */
  replace?: boolean;
  claim?: (e: EvidenceInput) => unknown;
}

/** Upsert evidence rows. Returns the number of rows inserted or changed. */
export async function upsertEvidence(tx: Tx, o: UpsertEvidenceOptions): Promise<number> {
  const seen = new Map<string, EvidenceInput>();
  for (const e of o.evidence) {
    const k = `${e.field}\u0000${e.sourceUrl}\u0000${e.extractionMethod}`;
    if (!seen.has(k)) seen.set(k, e);
  }
  const rows = [...seen.values()].map((e) => ({
    subjectType: o.subjectType,
    subjectId: o.subjectId,
    designSystemId: o.designSystemId,
    field: e.field,
    claim: o.claim ? (o.claim(e) ?? null) : null,
    sourceUrl: e.sourceUrl,
    sourceTitle: e.sourceTitle ?? null,
    retrievedAt: toDate(e.retrievedAt, o.fallbackDate),
    contentHash: e.contentHash ?? null,
    snapshotId: snapshotFor(o.lookup, e),
    extractionMethod: e.extractionMethod,
    location: e.location ?? null,
    excerpt: bounded(e.excerpt, 300),
    state: e.state,
    confidence: e.confidence,
  }));
  let changed = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await tx
      .insert(verificationEvidence)
      .values(chunk)
      .onConflictDoUpdate({
        target: [verificationEvidence.subjectType, verificationEvidence.subjectId, verificationEvidence.field, verificationEvidence.sourceUrl, verificationEvidence.extractionMethod],
        set: {
          claim: sql`excluded.claim`,
          sourceTitle: sql`excluded.source_title`,
          retrievedAt: sql`excluded.retrieved_at`,
          contentHash: sql`excluded.content_hash`,
          snapshotId: sql`coalesce(excluded.snapshot_id, ${verificationEvidence.snapshotId})`,
          location: sql`excluded.location`,
          excerpt: sql`excluded.excerpt`,
          state: sql`excluded.state`,
          confidence: sql`excluded.confidence`,
        },
        setWhere: sql`(${verificationEvidence.claim}, ${verificationEvidence.sourceTitle}, ${verificationEvidence.contentHash}, ${verificationEvidence.location}, ${verificationEvidence.excerpt}, ${verificationEvidence.state}, ${verificationEvidence.confidence}, ${verificationEvidence.retrievedAt})
          is distinct from (excluded.claim, excluded.source_title, excluded.content_hash, excluded.location, excluded.excerpt, excluded.state, excluded.confidence, excluded.retrieved_at)
          or (excluded.snapshot_id is not null and ${verificationEvidence.snapshotId} is distinct from excluded.snapshot_id)`,
      })
      .returning({ id: verificationEvidence.id });
    changed += res.length;
  }
  if (o.replace) {
    const keep = rows.map((r) => sql`(${r.field}, ${r.sourceUrl}, ${r.extractionMethod})`);
    const base = and(
      eq(verificationEvidence.subjectType, o.subjectType),
      eq(verificationEvidence.subjectId, o.subjectId),
      sql`${verificationEvidence.extractionMethod} not like 'registry-research:%'`,
    );
    await tx
      .delete(verificationEvidence)
      .where(keep.length ? and(base, sql`(${verificationEvidence.field}, ${verificationEvidence.sourceUrl}, ${verificationEvidence.extractionMethod}) not in (${sql.join(keep, sql`, `)})`) : base);
  }
  return changed;
}

/** Delete evidence for subjects that no longer exist (e.g. tokens removed from a set). */
export async function deleteEvidenceFor(tx: Tx, subjectType: SubjectType, subjectIds: string[]) {
  if (!subjectIds.length) return;
  await tx.delete(verificationEvidence).where(and(eq(verificationEvidence.subjectType, subjectType), inArray(verificationEvidence.subjectId, subjectIds)));
}

