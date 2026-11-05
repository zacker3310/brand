/**
 * Component promotion: upsert by (design_system_id, slug); unchanged content hash only bumps
 * last_seen_run_id; changed content replaces child rows and writes a change_event with a
 * field-level diff. Absent components are retired (never deleted) when removals are allowed.
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { NormalizedComponent } from "@/lib/contracts";
import {
  componentAccessibility,
  componentExamples,
  componentFrameworks,
  componentProperties,
  componentRelationships,
  componentStates,
  components,
  componentVariants,
  tokenSets,
  tokens,
  tokenUsages,
} from "@/db/schema";
import { canonicalState, classifyComponentName } from "@/lib/taxonomy";
import { slugify } from "@/lib/utils";
import { diffPayload } from "../diff";
import { upsertEvidence } from "../evidence";
import { contentHash } from "../hash";
import type { ValidatedEntity } from "../validate";
import { avgConfidence, inSavepoint, newCounters, previousPayload, writeChange, type Counters, type PromoteContext } from "./promote-common";

type VerificationState = "verified" | "inferred" | "unverified" | "unavailable" | "conflicting";

export interface ComponentClassification {
  typeSlug: string | null;
  typeId: string | null;
  state: VerificationState;
  method: string | null;
  confidence: number | null;
}

/** canonicalType from the adapter, else the ATLAS heuristic classifier (always 'inferred'). */
export function classifyComponent(c: Pick<NormalizedComponent, "name" | "canonicalType" | "classification" | "aliases">, typeIds: Map<string, string>, knownTypes: Set<string>): ComponentClassification {
  if (c.canonicalType && knownTypes.has(c.canonicalType)) {
    return {
      typeSlug: c.canonicalType,
      typeId: typeIds.get(c.canonicalType) ?? null,
      state: c.classification?.state ?? "inferred",
      method: c.classification?.method ?? "adapter-declared",
      confidence: c.classification?.confidence ?? null,
    };
  }
  // An adapter may deliberately leave a component unclassified (e.g. MUI Collapse is a transition utility, not an
  // accordion). Honour that: method "adapter:unclassified" / "adapter-unclassified..." with no canonicalType.
  if (!c.canonicalType && c.classification?.method && /^adapter[:-]unclassified/.test(c.classification.method)) {
    return { typeSlug: null, typeId: null, state: "unverified", method: c.classification.method, confidence: null };
  }
  const cls = classifyComponentName(c.name) ?? c.aliases.map((a) => classifyComponentName(a)).find((x) => x) ?? null;
  if (cls) return { typeSlug: cls.slug, typeId: typeIds.get(cls.slug) ?? null, state: "inferred", method: `heuristic:${cls.method}`, confidence: cls.confidence };
  return { typeSlug: null, typeId: null, state: "unverified", method: null, confidence: null };
}

function uniqBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const childSlug = (name: string, i: number) => slugify(name) || `item-${i + 1}`;

async function replaceChildren(pc: PromoteContext, componentId: string, c: NormalizedComponent) {
  const tx = pc.tx;
  await tx.delete(componentVariants).where(eq(componentVariants.componentId, componentId));
  await tx.delete(componentStates).where(eq(componentStates.componentId, componentId));
  await tx.delete(componentProperties).where(eq(componentProperties.componentId, componentId));
  await tx.delete(componentExamples).where(eq(componentExamples.componentId, componentId));
  await tx.delete(componentAccessibility).where(eq(componentAccessibility.componentId, componentId));
  await tx.delete(componentFrameworks).where(eq(componentFrameworks.componentId, componentId));

  const variants = uniqBy(
    c.variants.map((v, i) => ({ componentId, axis: v.axis || "variant", slug: childSlug(v.name, i), name: v.name, description: v.description ?? null, sourceUrl: v.sourceUrl ?? null, location: v.location ?? null })),
    (v) => `${v.axis}:${v.slug}`,
  );
  if (variants.length) await tx.insert(componentVariants).values(variants);

  const states = uniqBy(
    c.states.map((s, i) => ({ componentId, slug: childSlug(s.name, i), name: s.name, canonicalState: s.canonical ?? canonicalState(s.name), description: s.description ?? null, sourceUrl: s.sourceUrl ?? null })),
    (s) => s.slug,
  );
  if (states.length) await tx.insert(componentStates).values(states);

  const props = uniqBy(
    c.properties.map((p) => ({
      componentId,
      implementation: p.implementation || "default",
      name: p.name,
      type: p.type ?? null,
      defaultValue: p.defaultValue ?? null,
      required: p.required ?? null,
      deprecated: p.deprecated ?? false,
      description: p.description ?? null,
      allowedValues: p.allowedValues ?? null,
      sourceUrl: p.sourceUrl ?? null,
    })),
    (p) => `${p.implementation}:${p.name}`,
  );
  for (let i = 0; i < props.length; i += 500) await tx.insert(componentProperties).values(props.slice(i, i + 500));

  const examples = uniqBy(
    c.examples.map((ex) => ({
      componentId,
      slug: ex.slug,
      title: ex.title,
      kind: ex.kind,
      language: ex.language ?? null,
      code: ex.code ?? null,
      url: ex.url ?? null,
      licenseId: ex.code ? pc.licenseId : null,
      attribution: ex.attribution ?? null,
    })),
    (ex) => ex.slug,
  );
  if (examples.length) await tx.insert(componentExamples).values(examples);

  if (c.accessibility) {
    const a = c.accessibility;
    await tx.insert(componentAccessibility).values({
      componentId,
      ariaPattern: a.ariaPattern ?? null,
      roles: a.roles ?? null,
      keyboard: a.keyboard ?? null,
      guidance: a.guidance ?? null,
      screenReader: a.screenReader ?? null,
      focusManagement: a.focusManagement ?? null,
      wcagCriteria: a.wcagCriteria ?? null,
      docsUrl: a.docsUrl ?? null,
      coverage: a.coverage ?? {},
    });
  }

  const fws = uniqBy(
    c.frameworks
      .filter((f) => pc.frameworkIds.has(f.slug))
      .map((f) => ({ componentId, frameworkId: pc.frameworkIds.get(f.slug)!, packageName: f.packageName ?? null, importName: f.importName ?? null, sourceUrl: f.sourceUrl ?? null })),
    (f) => f.frameworkId,
  );
  if (fws.length) await tx.insert(componentFrameworks).values(fws);
}

/** Strip code examples when the system license does not clearly permit redistribution. */
export function enforceExampleLicense(c: NormalizedComponent, redistribution: string): { component: NormalizedComponent; stripped: string[] } {
  if (redistribution === "permitted") return { component: c, stripped: [] };
  const stripped = c.examples.filter((e) => e.code).map((e) => e.slug);
  if (!stripped.length) return { component: c, stripped };
  return { component: { ...c, examples: c.examples.map((e) => (e.code ? { ...e, code: null } : e)) }, stripped };
}

export interface ComponentPromotion {
  counters: Counters;
  /** slug -> component id for every published component of the system after promotion. */
  slugToId: Map<string, string>;
  promotedKeys: Set<string>;
}

export async function promoteComponents(pc: PromoteContext, entities: ValidatedEntity[], allKeys: Set<string>, knownTypes: Set<string>): Promise<ComponentPromotion> {
  const tx = pc.tx;
  const counters = newCounters();
  const existingRows = await tx
    .select({ id: components.id, slug: components.slug, contentHash: components.contentHash, publishState: components.publishState, componentTypeId: components.componentTypeId, name: components.name })
    .from(components)
    .where(eq(components.designSystemId, pc.systemId));
  const existing = new Map(existingRows.map((r) => [r.slug, r]));
  const promotedKeys = new Set<string>();
  const unchangedIds: string[] = [];

  for (const e of entities) {
    const c = e.payload as unknown as NormalizedComponent;
    const cls = classifyComponent(c, pc.typeIds, knownTypes);
    const fwIds = [...new Set(c.frameworks.map((f) => pc.frameworkIds.get(f.slug)).filter((x): x is string => !!x))].sort();
    const rowHash = contentHash({ p: e.hash, typeId: cls.typeId, cls: [cls.state, cls.method, cls.confidence], license: pc.licenseId, fw: fwIds });
    const prev = existing.get(e.key);
    if (prev && prev.contentHash === rowHash && prev.publishState === "published") {
      unchangedIds.push(prev.id);
      promotedKeys.add(e.key);
      counters.unchanged++;
      continue;
    }
    const ok = await inSavepoint(pc, e, async () => {
      const values = {
        designSystemId: pc.systemId,
        componentTypeId: cls.typeId,
        classificationState: cls.state,
        classificationMethod: cls.method,
        slug: c.slug,
        name: c.name,
        aliases: c.aliases,
        description: c.description ?? null,
        docsUrl: c.docsUrl ?? null,
        sourceCodeUrl: c.sourceCodeUrl ?? null,
        lifecycle: c.lifecycle,
        // [] means "the source says there are none" only when coverage says so; otherwise unknown (audit deep-1).
        sizes: c.sizes?.length || c.coverage.sizes === "documented-none" ? (c.sizes ?? []) : null,
        responsiveGuidance: c.responsiveGuidance ?? null,
        coverage: c.coverage,
        licenseId: pc.licenseId,
        confidence: avgConfidence(c.evidence),
        publishState: "published" as const,
        contentHash: rowHash,
        lastChangedAt: pc.runDate,
        lastSeenRunId: pc.runId,
      };
      const { designSystemId: _d, slug: _s, ...updatable } = values;
      const [row] = await tx
        .insert(components)
        .values(values)
        .onConflictDoUpdate({ target: [components.designSystemId, components.slug], set: { ...updatable, updatedAt: sql`now()` } })
        .returning({ id: components.id });
      const id = row!.id;
      await replaceChildren(pc, id, c);
      await upsertEvidence(tx, { subjectType: "component", subjectId: id, designSystemId: pc.systemId, evidence: c.evidence, lookup: pc.lookup, fallbackDate: pc.runDate, replace: true });
      if (!prev) {
        await writeChange(pc, { entityType: "component", entityId: id, entityLabel: c.name, changeKind: "created", fieldChanges: null });
        counters.created++;
      } else {
        const before = await previousPayload(pc, "component", e.key);
        const changes = diffPayload(before, e.payload);
        if (prev.publishState !== "published") changes.unshift({ field: "publishState", before: prev.publishState, after: "published", summary: `publishState: ${prev.publishState} -> published` });
        if (prev.componentTypeId !== cls.typeId) changes.push({ field: "componentType", before: prev.componentTypeId, after: cls.typeSlug, summary: `componentType: ${cls.typeSlug ?? "unclassified"} (${cls.method ?? "none"})` });
        if (!changes.length) changes.push({ field: "*", summary: "derived fields changed (license, framework or taxonomy links)" });
        await writeChange(pc, { entityType: "component", entityId: id, entityLabel: c.name, changeKind: "updated", fieldChanges: changes });
        counters.updated++;
      }
    });
    if (ok) promotedKeys.add(e.key);
  }

  for (let i = 0; i < unchangedIds.length; i += 1000) {
    await tx.update(components).set({ lastSeenRunId: pc.runId }).where(inArray(components.id, unchangedIds.slice(i, i + 1000)));
  }

  if (pc.allowRemovals) {
    const gone = await tx
      .update(components)
      .set({ publishState: "retired", lastChangedAt: pc.runDate, updatedAt: sql`now()` })
      .where(
        and(
          eq(components.designSystemId, pc.systemId),
          eq(components.publishState, "published"),
          allKeys.size ? notInArray(components.slug, [...allKeys]) : sql`true`,
        ),
      )
      .returning({ id: components.id, name: components.name });
    for (const g of gone) {
      await writeChange(pc, { entityType: "component", entityId: g.id, entityLabel: g.name, changeKind: "removed", fieldChanges: [{ field: "publishState", before: "published", after: "retired", summary: "not present in source; retired" }] });
      counters.removed++;
    }
  }

  const all = await tx
    .select({ id: components.id, slug: components.slug })
    .from(components)
    .where(and(eq(components.designSystemId, pc.systemId), eq(components.publishState, "published")));
  return { counters, slugToId: new Map(all.map((r) => [r.slug, r.id])), promotedKeys };
}

/** Diff-sync component_relationship rows for promoted components (targets resolved by slug). */
export async function syncRelationships(pc: PromoteContext, entities: ValidatedEntity[], slugToId: Map<string, string>) {
  const tx = pc.tx;
  const desired = new Map<string, { fromComponentId: string; toComponentId: string | null; toComponentTypeId: string | null; kind: string; verificationState: "verified" | "inferred"; sourceUrl: string | null }>();
  const fromIds: string[] = [];
  for (const e of entities) {
    const c = e.payload as unknown as NormalizedComponent;
    const from = slugToId.get(c.slug);
    if (!from) continue;
    fromIds.push(from);
    const state = c.evidence.some((x) => x.state === "verified") ? "verified" : "inferred";
    for (const r of c.relationships) {
      const to = r.targetSlug ? (slugToId.get(r.targetSlug) ?? null) : null;
      const toType = r.targetType ? (pc.typeIds.get(r.targetType) ?? null) : null;
      if (!to && !toType) continue;
      if (to === from) continue;
      const k = `${from}|${r.kind}|${to}|${toType}`;
      if (!desired.has(k)) desired.set(k, { fromComponentId: from, toComponentId: to, toComponentTypeId: toType, kind: r.kind, verificationState: state, sourceUrl: c.docsUrl ?? null });
    }
  }
  if (!fromIds.length) return;
  const existing = [];
  for (let i = 0; i < fromIds.length; i += 1000) {
    existing.push(...(await tx.select().from(componentRelationships).where(inArray(componentRelationships.fromComponentId, fromIds.slice(i, i + 1000)))));
  }
  const keyOf = (r: { fromComponentId: string; kind: string; toComponentId: string | null; toComponentTypeId: string | null }) => `${r.fromComponentId}|${r.kind}|${r.toComponentId}|${r.toComponentTypeId}`;
  const have = new Map(existing.map((r) => [keyOf(r), r]));
  const toDelete = existing.filter((r) => !desired.has(keyOf(r))).map((r) => r.id);
  const toInsert = [...desired.entries()].filter(([k]) => !have.has(k)).map(([, v]) => v);
  for (const [k, v] of desired) {
    const h = have.get(k);
    if (h && (h.verificationState !== v.verificationState || h.sourceUrl !== v.sourceUrl)) {
      await tx.update(componentRelationships).set({ verificationState: v.verificationState, sourceUrl: v.sourceUrl }).where(eq(componentRelationships.id, h.id));
    }
  }
  if (toDelete.length) await tx.delete(componentRelationships).where(inArray(componentRelationships.id, toDelete));
  for (let i = 0; i < toInsert.length; i += 500) await tx.insert(componentRelationships).values(toInsert.slice(i, i + 500));
}

/** Diff-sync token_usage rows: documented token names resolved against published tokens of the system. */
export async function syncTokenUsages(pc: PromoteContext, entities: ValidatedEntity[], slugToId: Map<string, string>) {
  const tx = pc.tx;
  const wanted = entities.flatMap((e) => {
    const c = e.payload as unknown as NormalizedComponent;
    const id = slugToId.get(c.slug);
    return id ? c.tokenUsages.map((u) => ({ componentId: id, tokenName: u.tokenName, property: u.property ?? null, sourceUrl: c.docsUrl ?? null })) : [];
  });
  const componentIds = [...new Set(entities.map((e) => slugToId.get(e.key)).filter((x): x is string => !!x))];
  if (!componentIds.length) return;
  const byName = new Map<string, string[]>();
  if (wanted.length) {
    const toks = await tx
      .select({ id: tokens.id, name: tokens.name, cssVar: tokens.cssVar })
      .from(tokens)
      .innerJoin(tokenSets, eq(tokenSets.id, tokens.tokenSetId))
      .where(and(eq(tokens.designSystemId, pc.systemId), eq(tokenSets.publishState, "published")));
    for (const t of toks) {
      for (const k of [t.name, t.cssVar].filter((x): x is string => !!x)) {
        const l = byName.get(k) ?? [];
        l.push(t.id);
        byName.set(k, l);
      }
    }
  }
  const desired = new Map<string, { tokenId: string; componentId: string; property: string | null; sourceUrl: string | null }>();
  for (const w of wanted) {
    const ids = byName.get(w.tokenName) ?? byName.get(w.tokenName.startsWith("--") ? w.tokenName : `--${w.tokenName}`) ?? [];
    for (const tokenId of ids) {
      const k = `${tokenId}|${w.componentId}|${w.property}`;
      if (!desired.has(k)) desired.set(k, { tokenId, componentId: w.componentId, property: w.property, sourceUrl: w.sourceUrl });
    }
  }
  const existing = [];
  for (let i = 0; i < componentIds.length; i += 1000) existing.push(...(await tx.select().from(tokenUsages).where(inArray(tokenUsages.componentId, componentIds.slice(i, i + 1000)))));
  const keyOf = (r: { tokenId: string; componentId: string; property: string | null }) => `${r.tokenId}|${r.componentId}|${r.property}`;
  const have = new Set(existing.map(keyOf));
  const toDelete = existing.filter((r) => !desired.has(keyOf(r))).map((r) => r.id);
  const toInsert = [...desired.entries()].filter(([k]) => !have.has(k)).map(([, v]) => v);
  if (toDelete.length) await tx.delete(tokenUsages).where(inArray(tokenUsages.id, toDelete));
  for (let i = 0; i < toInsert.length; i += 500) await tx.insert(tokenUsages).values(toInsert.slice(i, i + 500));
}
