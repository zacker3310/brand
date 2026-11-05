/**
 * Pattern promotion (system+slug; pattern_component links by component slug) and system facts
 * (latest version / philosophy / principles / frameworks, applied only when backed by evidence).
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { FieldChange, NormalizedPattern, NormalizedSystemFacts } from "@/lib/contracts";
import { designPatterns, designSystemFrameworks, designSystems, patternComponents } from "@/db/schema";
import { classifyPatternName } from "@/lib/taxonomy";
import { diffPayload } from "../diff";
import { upsertEvidence } from "../evidence";
import { contentHash } from "../hash";
import type { ValidatedEntity } from "../validate";
import { avgConfidence, inSavepoint, newCounters, previousPayload, writeChange, type Counters, type PromoteContext } from "./promote-common";

export function classifyPattern(p: Pick<NormalizedPattern, "name" | "canonicalType" | "classification">, patternTypeIds: Map<string, string>, known: Set<string>) {
  if (p.canonicalType && known.has(p.canonicalType)) {
    return { typeSlug: p.canonicalType, typeId: patternTypeIds.get(p.canonicalType) ?? null, state: p.classification?.state ?? ("inferred" as const), method: p.classification?.method ?? "adapter-declared" };
  }
  const cls = classifyPatternName(p.name);
  if (cls) return { typeSlug: cls.slug, typeId: patternTypeIds.get(cls.slug) ?? null, state: "inferred" as const, method: `heuristic:${cls.method}` };
  return { typeSlug: null, typeId: null, state: "unverified" as const, method: null };
}

export async function promotePatterns(
  pc: PromoteContext,
  entities: ValidatedEntity[],
  allKeys: Set<string>,
  slugToComponentId: Map<string, string>,
  knownPatternTypes: Set<string>,
): Promise<{ counters: Counters; promotedKeys: Set<string> }> {
  const tx = pc.tx;
  const counters = newCounters();
  const promotedKeys = new Set<string>();
  const existing = new Map(
    (await tx.select({ id: designPatterns.id, slug: designPatterns.slug, contentHash: designPatterns.contentHash, publishState: designPatterns.publishState }).from(designPatterns).where(eq(designPatterns.designSystemId, pc.systemId))).map((r) => [r.slug, r]),
  );
  for (const e of entities) {
    const p = e.payload as unknown as NormalizedPattern;
    const cls = classifyPattern(p, pc.patternTypeIds, knownPatternTypes);
    const rowHash = contentHash({ p: e.hash, typeId: cls.typeId, cls: [cls.state, cls.method] });
    const prev = existing.get(e.key);
    const ok = await inSavepoint(pc, e, async () => {
      let id = prev?.id;
      if (!(prev && prev.contentHash === rowHash && prev.publishState === "published")) {
        const values = {
          designSystemId: pc.systemId,
          patternTypeId: cls.typeId,
          classificationState: cls.state,
          slug: p.slug,
          name: p.name,
          description: p.description ?? null,
          docsUrl: p.docsUrl ?? null,
          coverage: p.coverage,
          confidence: avgConfidence(p.evidence),
          publishState: "published" as const,
          contentHash: rowHash,
        };
        const { designSystemId: _d, slug: _s, ...updatable } = values;
        const [row] = await tx
          .insert(designPatterns)
          .values(values)
          .onConflictDoUpdate({ target: [designPatterns.designSystemId, designPatterns.slug], set: { ...updatable, updatedAt: sql`now()` } })
          .returning({ id: designPatterns.id });
        id = row!.id;
        await upsertEvidence(tx, { subjectType: "pattern", subjectId: id, designSystemId: pc.systemId, evidence: p.evidence, lookup: pc.lookup, fallbackDate: pc.runDate, replace: true });
        if (!prev) {
          await writeChange(pc, { entityType: "pattern", entityId: id, entityLabel: p.name, changeKind: "created" });
          counters.created++;
        } else {
          const changes = diffPayload(await previousPayload(pc, "pattern", e.key), e.payload);
          if (prev.publishState !== "published") changes.unshift({ field: "publishState", before: prev.publishState, after: "published", summary: `publishState: ${prev.publishState} -> published` });
          if (!changes.length) changes.push({ field: "*", summary: "derived fields changed (taxonomy link)" });
          await writeChange(pc, { entityType: "pattern", entityId: id, entityLabel: p.name, changeKind: "updated", fieldChanges: changes });
          counters.updated++;
        }
      } else {
        counters.unchanged++;
      }
      // Links are diff-synced every run: component slugs may resolve differently as components appear.
      const wanted = new Set(p.componentSlugs.map((s) => slugToComponentId.get(s)).filter((x): x is string => !!x));
      const have = await tx.select({ componentId: patternComponents.componentId }).from(patternComponents).where(eq(patternComponents.patternId, id!));
      const haveSet = new Set(have.map((h) => h.componentId));
      const del = [...haveSet].filter((c) => !wanted.has(c));
      const add = [...wanted].filter((c) => !haveSet.has(c));
      if (del.length) await tx.delete(patternComponents).where(and(eq(patternComponents.patternId, id!), inArray(patternComponents.componentId, del)));
      if (add.length) await tx.insert(patternComponents).values(add.map((componentId) => ({ patternId: id!, componentId })));
    });
    if (ok) promotedKeys.add(e.key);
  }
  if (pc.allowRemovals) {
    const gone = await tx
      .update(designPatterns)
      .set({ publishState: "retired", updatedAt: sql`now()` })
      .where(and(eq(designPatterns.designSystemId, pc.systemId), eq(designPatterns.publishState, "published"), allKeys.size ? notInArray(designPatterns.slug, [...allKeys]) : sql`true`))
      .returning({ id: designPatterns.id, name: designPatterns.name });
    for (const g of gone) {
      await writeChange(pc, { entityType: "pattern", entityId: g.id, entityLabel: g.name, changeKind: "removed", fieldChanges: [{ field: "publishState", before: "published", after: "retired", summary: "not present in source; retired" }] });
      counters.removed++;
    }
  }
  return { counters, promotedKeys };
}

/** Apply evidence-backed system facts to design_system. Returns true when anything changed. */
export async function promoteFacts(pc: PromoteContext, e: ValidatedEntity): Promise<"created" | "updated" | "unchanged" | "failed"> {
  const tx = pc.tx;
  const f = e.payload as unknown as NormalizedSystemFacts;
  const fields = new Set(f.evidence.map((x) => x.field));
  const has = (field: string) => fields.has(field) || fields.has("*");
  let result: "updated" | "unchanged" = "unchanged";
  const ok = await inSavepoint(pc, e, async () => {
    const [ds] = await tx.select().from(designSystems).where(eq(designSystems.id, pc.systemId));
    if (!ds) throw new Error("design system missing");
    const patch: Partial<typeof designSystems.$inferInsert> = {};
    const changes: FieldChange[] = [];
    if (f.latestVersion && has("latestVersion") && f.latestVersion !== ds.latestVersion) {
      patch.latestVersion = f.latestVersion;
      changes.push({ field: "latestVersion", before: ds.latestVersion, after: f.latestVersion, summary: `latestVersion: ${ds.latestVersion ?? "unknown"} -> ${f.latestVersion}` });
    }
    if (f.latestReleaseAt && has("latestReleaseAt")) {
      const d = new Date(f.latestReleaseAt);
      if (!Number.isNaN(d.getTime()) && d.getTime() !== ds.latestReleaseAt?.getTime()) {
        patch.latestReleaseAt = d;
        changes.push({ field: "latestReleaseAt", before: ds.latestReleaseAt?.toISOString() ?? null, after: d.toISOString(), summary: "latestReleaseAt changed" });
      }
    }
    if (f.philosophy && has("philosophy") && f.philosophy !== ds.philosophy) {
      patch.philosophy = f.philosophy;
      changes.push({ field: "philosophy", summary: ds.philosophy ? "philosophy changed" : "philosophy set" });
    }
    if (f.principles && has("principles") && contentHash(f.principles) !== contentHash(ds.principles ?? null)) {
      patch.principles = f.principles;
      changes.push({ field: "principles", before: ds.principles?.length ?? 0, after: f.principles.length, summary: `principles: ${f.principles.length} documented` });
    }
    if (Object.keys(patch).length) {
      await tx.update(designSystems).set(patch).where(eq(designSystems.id, pc.systemId));
      await writeChange(pc, { entityType: "design_system", entityId: pc.systemId, entityLabel: ds.name, changeKind: "updated", fieldChanges: changes });
      result = "updated";
    }
    if (f.frameworks?.length && has("frameworks")) {
      const fwEvidence = f.evidence.find((x) => x.field === "frameworks") ?? f.evidence.find((x) => x.field === "*");
      const rows = f.frameworks
        .filter((fw) => pc.frameworkIds.has(fw.slug))
        .map((fw) => ({ designSystemId: pc.systemId, frameworkId: pc.frameworkIds.get(fw.slug)!, packageName: fw.packageName ?? null, verificationState: fwEvidence?.state ?? ("inferred" as const), sourceUrl: fwEvidence?.sourceUrl ?? null }));
      // Registry research owns this table; ingestion only adds frameworks it is missing.
      if (rows.length) await tx.insert(designSystemFrameworks).values(rows).onConflictDoNothing();
    }
    const prevPayload = await previousPayload(pc, "system-facts", "facts");
    const sameAsBefore = prevPayload !== null && contentHash(prevPayload) === e.hash;
    if (f.evidence.length && !(sameAsBefore && result === "unchanged")) {
      await upsertEvidence(tx, { subjectType: "design_system", subjectId: pc.systemId, designSystemId: pc.systemId, evidence: f.evidence, lookup: pc.lookup, fallbackDate: pc.runDate, replace: false, claim: (ev) => (ev.field in f ? { [ev.field]: (f as Record<string, unknown>)[ev.field] } : null) });
    }
  });
  return ok ? result : "failed";
}
