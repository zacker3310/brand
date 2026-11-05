import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { FieldChange, LicenseRef } from "@/lib/contracts";
import { changeEvents, extractions, licenses } from "@/db/schema";
import type { SnapshotLookup, Tx } from "../evidence";
import type { ValidatedEntity } from "../validate";

export interface Counters {
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
}

export const newCounters = (): Counters => ({ created: 0, updated: 0, unchanged: 0, removed: 0 });

export interface PromoteContext {
  tx: Tx;
  systemId: string;
  systemSlug: string;
  runId: string;
  licenseId: string | null;
  /** Redistribution of the system license; code examples are stored only when 'permitted'. */
  redistribution: string;
  typeIds: Map<string, string>;
  patternTypeIds: Map<string, string>;
  frameworkIds: Map<string, string>;
  lookup: SnapshotLookup;
  runDate: Date;
  /** Retire records missing from this bundle (only for complete, unlimited, error-free runs). */
  allowRemovals: boolean;
  /** Delete tokens missing from a re-extracted set (false for limited runs). */
  allowTokenDeletion: boolean;
  /** Called when promoting an entity failed; the entity is skipped (savepoint rolled back). */
  onEntityError: (e: ValidatedEntity, err: unknown) => Promise<void>;
}

export async function writeChange(
  pc: PromoteContext,
  ev: { entityType: string; entityId: string | null; entityLabel: string | null; changeKind: string; fieldChanges?: FieldChange[] | null },
) {
  await pc.tx.insert(changeEvents).values({
    designSystemId: pc.systemId,
    entityType: ev.entityType,
    entityId: ev.entityId,
    entityLabel: ev.entityLabel,
    changeKind: ev.changeKind,
    fieldChanges: ev.fieldChanges ?? null,
    runId: pc.runId,
  });
}

/** Most recent previously published payload of an entity (for field-level diffs). */
export async function previousPayload(pc: PromoteContext, kind: string, key: string): Promise<Record<string, unknown> | null> {
  const [row] = await pc.tx
    .select({ payload: extractions.payload })
    .from(extractions)
    .where(
      and(
        eq(extractions.designSystemId, pc.systemId),
        eq(extractions.entityKind, kind),
        eq(extractions.entityKey, key),
        eq(extractions.published, true),
        ne(extractions.runId, pc.runId),
      ),
    )
    .orderBy(desc(extractions.createdAt))
    .limit(1);
  return row?.payload ?? null;
}

/** Ensure a license row exists; existing registry facts are never overwritten by adapter output. */
export async function ensureLicense(tx: Tx, ref: LicenseRef): Promise<string> {
  await tx
    .insert(licenses)
    .values({ slug: ref.slug, spdxId: ref.spdxId, name: ref.name, url: ref.url, isOpenSource: ref.isOpenSource, redistribution: ref.redistribution, notes: ref.notes ?? null })
    .onConflictDoNothing({ target: licenses.slug });
  const [row] = await tx.select({ id: licenses.id }).from(licenses).where(eq(licenses.slug, ref.slug));
  return row!.id;
}

/** Run fn in a savepoint; on failure the entity is skipped and reported, the publish continues. */
export async function inSavepoint(pc: PromoteContext, e: ValidatedEntity, fn: (tx: Tx) => Promise<void>): Promise<boolean> {
  try {
    await pc.tx.transaction(async (sp) => {
      await fn(sp as unknown as Tx);
    });
    return true;
  } catch (err) {
    await pc.onEntityError(e, err);
    return false;
  }
}

export const avgConfidence = (ev: { confidence: number }[]) => (ev.length ? Math.round((ev.reduce((n, e) => n + e.confidence, 0) / ev.length) * 1000) / 1000 : 0);

/** Bulk update rows by id from a JSON record set. `columns` maps json key -> [sql column, pg type]. */
export async function bulkUpdate(tx: Tx, table: string, rows: Record<string, unknown>[], columns: Record<string, [string, string]>) {
  if (!rows.length) return;
  const keys = Object.keys(columns);
  const def = sql.raw(["id uuid", ...keys.map((k) => `${k} ${columns[k]![1]}`)].join(", "));
  const sets = sql.raw(keys.map((k) => `${columns[k]![0]} = v.${k}`).join(", "));
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    await tx.execute(sql`update ${sql.raw(table)} t set ${sets} from jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) as v(${def}) where t.id = v.id`);
  }
}
