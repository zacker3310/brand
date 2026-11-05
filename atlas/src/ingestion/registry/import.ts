/**
 * Registry importer: data/registry/*.json (arrays of RegistryEntry) -> organization, license,
 * design_system (+ framework/platform/tag links), registry sources and per-check evidence.
 *
 * Rules:
 *  - Every entry is Zod-validated; invalid entries are reported and skipped (never half-imported).
 *  - publish_state 'published' only for registryStatus 'verified'; everything else stays 'draft'.
 *  - ingestion_status 'metadata_only' when verified and no adapter handles the slug; otherwise the
 *    existing ingestion status is kept (new rows start 'not_started').
 *  - Idempotent: re-importing identical files changes nothing; changed fields write a
 *    change_event ('updated' or 'status-changed') with field-level changes.
 *  - Shared reference rows (organization, license) are filled, never overwritten, so two entries
 *    that describe the same license slightly differently cannot flip-flop between imports.
 *  - Facts discovered by ingestion (latest version / release date backed by evidence) win over
 *    registry values once the system has been ingested.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { RegistryEntry, type FieldChange, type RegistryCheck, type RegistryEvidenceSummary } from "@/lib/contracts";
import { getDb, type DB } from "@/db/client";
import {
  changeEvents,
  designSystemFrameworks,
  designSystemPlatforms,
  designSystems,
  designSystemTags,
  frameworks,
  licenses,
  organizations,
  platforms,
  sourceDocuments,
  sources,
  tags,
  verificationEvidence,
} from "@/db/schema";
import { stableStringify, slugify } from "@/lib/utils";
import { adapterForSystem } from "../adapters";
import type { SourceAdapter } from "../types";
import { computeSystemCoverage, coverageChanged } from "../engine/coverage";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type SystemRow = typeof designSystems.$inferSelect;

export interface ImportIssue {
  file: string;
  index: number;
  slug: string | null;
  problems: string[];
}

export interface ImportReport {
  files: string[];
  entries: number;
  imported: number;
  created: string[];
  updated: string[];
  unchanged: string[];
  invalid: ImportIssue[];
  skipped: ImportIssue[];
  warnings: string[];
}

export interface ImportOptions {
  /** Directory of registry files (default data/registry). Ignored when `files` or `entries` is given. */
  dir?: string;
  files?: string[];
  /** Pre-loaded entries (tests). */
  entries?: { file: string; data: unknown }[];
  resolveAdapter?: (slug: string) => SourceAdapter | undefined;
  db?: DB;
}

export function registryFiles(dir = "data/registry"): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function loadFiles(files: string[], report: ImportReport): { file: string; data: unknown }[] {
  const out: { file: string; data: unknown }[] = [];
  for (const f of files) {
    try {
      out.push({ file: f, data: JSON.parse(readFileSync(f, "utf8")) });
    } catch (e) {
      report.invalid.push({ file: f, index: -1, slug: null, problems: [`unreadable JSON: ${(e as Error).message}`] });
    }
  }
  return out;
}

const norm = (u: string) => u.replace(/\/+$/, "");

/** Latest check per (field, url, method); checks whose url or finalUrl matches `url`. */
function checksFor(entry: RegistryEntry, url: string): RegistryCheck[] {
  return entry.checks.filter((c) => norm(c.url) === norm(url) || (c.finalUrl && norm(c.finalUrl) === norm(url)));
}

const latest = (cs: RegistryCheck[]) => [...cs].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];

function toDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Comparable form for change detection (dates as ISO, JSON stable). */
const cmp = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined ? null : stableStringify(v));

const bound = (v: unknown) => {
  const s = v instanceof Date ? v.toISOString() : typeof v === "string" ? v : v == null ? null : stableStringify(v);
  return typeof s === "string" && s.length > 200 ? `${s.slice(0, 199)}…` : s;
};

async function ensureOrganization(tx: Tx, org: RegistryEntry["organization"]): Promise<string> {
  await tx
    .insert(organizations)
    .values({ slug: org.slug, name: org.name, websiteUrl: org.websiteUrl })
    .onConflictDoUpdate({
      target: organizations.slug,
      set: { websiteUrl: sql`coalesce(${organizations.websiteUrl}, excluded.website_url)` },
      setWhere: sql`${organizations.websiteUrl} is null and excluded.website_url is not null`,
    });
  const [row] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, org.slug));
  return row!.id;
}

async function ensureLicense(tx: Tx, lic: NonNullable<RegistryEntry["license"]>): Promise<string> {
  await tx
    .insert(licenses)
    .values({ slug: lic.slug, spdxId: lic.spdxId, name: lic.name, url: lic.url, isOpenSource: lic.isOpenSource, redistribution: lic.redistribution, notes: lic.notes ?? null })
    .onConflictDoUpdate({
      target: licenses.slug,
      set: {
        spdxId: sql`coalesce(${licenses.spdxId}, excluded.spdx_id)`,
        url: sql`coalesce(${licenses.url}, excluded.url)`,
        isOpenSource: sql`coalesce(${licenses.isOpenSource}, excluded.is_open_source)`,
        redistribution: sql`case when ${licenses.redistribution} = 'unknown' then excluded.redistribution else ${licenses.redistribution} end`,
        notes: sql`coalesce(${licenses.notes}, excluded.notes)`,
      },
      setWhere: sql`(${licenses.spdxId} is null and excluded.spdx_id is not null) or (${licenses.url} is null and excluded.url is not null)
        or (${licenses.isOpenSource} is null and excluded.is_open_source is not null)
        or (${licenses.redistribution} = 'unknown' and excluded.redistribution <> 'unknown') or (${licenses.notes} is null and excluded.notes is not null)`,
    });
  const [row] = await tx.select({ id: licenses.id }).from(licenses).where(eq(licenses.slug, lic.slug));
  return row!.id;
}

interface LinkSync {
  changes: FieldChange[];
  warnings: string[];
}

async function syncFrameworks(tx: Tx, systemId: string, entry: RegistryEntry, fwIds: Map<string, string>, out: LinkSync) {
  const desired = new Map<string, { frameworkId: string; support: string; packageName: string | null; verificationState: "verified" | "unverified"; sourceUrl: string | null }>();
  for (const f of entry.frameworks) {
    const id = fwIds.get(f.slug);
    if (!id) {
      out.warnings.push(`${entry.slug}: unknown framework slug "${f.slug}" skipped`);
      continue;
    }
    const pkgCheck = f.packageName ? latest(entry.checks.filter((c) => c.field === `package:${f.packageName}` && c.ok)) : undefined;
    const pkg = f.packageName ? entry.packages.find((p) => p.name === f.packageName) : undefined;
    desired.set(id, {
      frameworkId: id,
      support: f.support,
      packageName: f.packageName ?? null,
      verificationState: pkgCheck ? "verified" : "unverified",
      sourceUrl: pkgCheck?.url ?? pkg?.url ?? null,
    });
  }
  const have = await tx.select().from(designSystemFrameworks).where(eq(designSystemFrameworks.designSystemId, systemId));
  const haveMap = new Map(have.map((h) => [h.frameworkId, h]));
  const slugById = new Map([...fwIds].map(([s, id]) => [id, s]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [id, d] of desired) {
    const h = haveMap.get(id);
    if (!h) {
      await tx.insert(designSystemFrameworks).values({ designSystemId: systemId, ...d });
      added.push(slugById.get(id)!);
    } else if (h.support !== d.support || h.packageName !== d.packageName || h.verificationState !== d.verificationState || h.sourceUrl !== d.sourceUrl) {
      await tx
        .update(designSystemFrameworks)
        .set({ support: d.support, packageName: d.packageName, verificationState: d.verificationState, sourceUrl: d.sourceUrl })
        .where(and(eq(designSystemFrameworks.designSystemId, systemId), eq(designSystemFrameworks.frameworkId, id)));
      changed.push(slugById.get(id)!);
    }
  }
  const gone = have.filter((h) => !desired.has(h.frameworkId)).map((h) => h.frameworkId);
  if (gone.length) {
    await tx.delete(designSystemFrameworks).where(and(eq(designSystemFrameworks.designSystemId, systemId), inArray(designSystemFrameworks.frameworkId, gone)));
    removed.push(...gone.map((g) => slugById.get(g) ?? g));
  }
  if (added.length || removed.length || changed.length)
    out.changes.push({ field: "frameworks", before: have.map((h) => slugById.get(h.frameworkId)).sort(), after: [...desired.keys()].map((k) => slugById.get(k)).sort(), summary: `frameworks: +${added.length} -${removed.length} ~${changed.length}` });
}

async function syncPlatforms(tx: Tx, systemId: string, entry: RegistryEntry, plIds: Map<string, string>, out: LinkSync) {
  const desired = new Set<string>();
  for (const p of entry.platforms) {
    const id = plIds.get(p);
    if (!id) out.warnings.push(`${entry.slug}: unknown platform slug "${p}" skipped`);
    else desired.add(id);
  }
  const have = await tx.select({ platformId: designSystemPlatforms.platformId }).from(designSystemPlatforms).where(eq(designSystemPlatforms.designSystemId, systemId));
  const haveSet = new Set(have.map((h) => h.platformId));
  const add = [...desired].filter((d) => !haveSet.has(d));
  const del = [...haveSet].filter((h) => !desired.has(h));
  if (add.length) await tx.insert(designSystemPlatforms).values(add.map((platformId) => ({ designSystemId: systemId, platformId, verificationState: "unverified" as const })));
  if (del.length) await tx.delete(designSystemPlatforms).where(and(eq(designSystemPlatforms.designSystemId, systemId), inArray(designSystemPlatforms.platformId, del)));
  if (add.length || del.length) {
    const slugById = new Map([...plIds].map(([s, id]) => [id, s]));
    out.changes.push({ field: "platforms", before: [...haveSet].map((x) => slugById.get(x)).sort(), after: [...desired].map((x) => slugById.get(x)).sort(), summary: `platforms: +${add.length} -${del.length}` });
  }
}

async function syncTags(tx: Tx, systemId: string, entry: RegistryEntry, out: LinkSync) {
  const wanted = new Map<string, string>();
  for (const t of entry.tags) {
    const slug = slugify(t);
    if (slug && !wanted.has(slug)) wanted.set(slug, t);
  }
  if (wanted.size) await tx.insert(tags).values([...wanted].map(([slug, name]) => ({ slug, name }))).onConflictDoNothing({ target: tags.slug });
  const tagRows = wanted.size ? await tx.select({ id: tags.id, slug: tags.slug }).from(tags).where(inArray(tags.slug, [...wanted.keys()])) : [];
  const desired = new Set(tagRows.map((t) => t.id));
  const have = await tx.select({ tagId: designSystemTags.tagId }).from(designSystemTags).where(eq(designSystemTags.designSystemId, systemId));
  const haveSet = new Set(have.map((h) => h.tagId));
  const add = [...desired].filter((d) => !haveSet.has(d));
  const del = [...haveSet].filter((h) => !desired.has(h));
  if (add.length) await tx.insert(designSystemTags).values(add.map((tagId) => ({ designSystemId: systemId, tagId, verificationState: "inferred" as const })));
  if (del.length) await tx.delete(designSystemTags).where(and(eq(designSystemTags.designSystemId, systemId), inArray(designSystemTags.tagId, del)));
  if (add.length || del.length) out.changes.push({ field: "tags", summary: `tags: +${add.length} -${del.length}`, after: [...wanted.keys()].sort() });
}

async function syncSources(tx: Tx, systemId: string, entry: RegistryEntry) {
  const desired = new Map<string, { kind: string; label: string | null }>();
  const add = (url: string | null, kind: string, label: string | null) => {
    if (url && !desired.has(url)) desired.set(url, { kind, label });
  };
  add(entry.homepageUrl, "homepage", `${entry.name} homepage`);
  add(entry.docsUrl, "docs", `${entry.name} documentation`);
  add(entry.repositoryUrl, "repository", "Source repository");
  add(entry.figmaUrl, "figma", "Figma community file");
  add(entry.storybookUrl, "storybook", "Storybook");
  for (const p of entry.packages) add(p.url, "package", p.name);
  let changed = 0;
  for (const [url, d] of desired) {
    const c = latest(checksFor(entry, url));
    const values = {
      designSystemId: systemId,
      kind: d.kind,
      url,
      label: d.label,
      isOfficial: true,
      lastCheckedAt: c ? toDate(c.checkedAt) : null,
      lastStatus: c?.status ?? null,
      lastError: c && !c.ok ? (c.note ?? `check failed (status ${c.status ?? "network error"})`).slice(0, 400) : null,
      discoveredBy: "registry",
    };
    const res = await tx
      .insert(sources)
      .values(values)
      .onConflictDoUpdate({
        target: [sources.designSystemId, sources.url],
        set: { kind: sql`excluded.kind`, label: sql`excluded.label`, lastCheckedAt: sql`excluded.last_checked_at`, lastStatus: sql`excluded.last_status`, lastError: sql`excluded.last_error`, updatedAt: sql`now()` },
        setWhere: sql`${sources.discoveredBy} = 'registry' and (${sources.kind}, ${sources.label}, ${sources.lastCheckedAt}, ${sources.lastStatus}, ${sources.lastError}) is distinct from (excluded.kind, excluded.label, excluded.last_checked_at, excluded.last_status, excluded.last_error)`,
      })
      .returning({ id: sources.id });
    changed += res.length;
  }
  // Registry sources no longer listed are removed unless documents hang off them.
  const urls = [...desired.keys()];
  const stale = await tx
    .select({ id: sources.id, url: sources.url })
    .from(sources)
    .where(
      and(
        eq(sources.designSystemId, systemId),
        eq(sources.discoveredBy, "registry"),
        urls.length ? notInArray(sources.url, urls) : sql`true`,
        sql`not exists (select 1 from ${sourceDocuments} d where d.source_id = ${sources.id})`,
      ),
    );
  if (stale.length) await tx.delete(sources).where(inArray(sources.id, stale.map((s) => s.id)));
  return { changed, removed: stale.length };
}

async function syncEvidence(tx: Tx, systemId: string, entry: RegistryEntry): Promise<number> {
  const byKey = new Map<string, RegistryCheck>();
  for (const c of entry.checks) {
    const k = `${c.field}\u0000${c.url}\u0000${c.method}`;
    const prev = byKey.get(k);
    if (!prev || c.checkedAt > prev.checkedAt) byKey.set(k, c);
  }
  const rows = [...byKey.values()].map((c) => ({
    subjectType: "design_system",
    subjectId: systemId,
    designSystemId: systemId,
    field: c.field,
    claim: { status: c.status, ok: c.ok, finalUrl: c.finalUrl ?? null },
    sourceUrl: c.url,
    sourceTitle: null,
    retrievedAt: toDate(c.checkedAt) ?? new Date(entry.verifiedAt),
    contentHash: null,
    extractionMethod: `registry-research:${c.method}`,
    location: null,
    excerpt: c.note ? (c.note.length > 300 ? `${c.note.slice(0, 299)}…` : c.note) : null,
    state: c.ok ? ("verified" as const) : ("unavailable" as const),
    confidence: entry.confidence,
  }));
  let changed = 0;
  if (rows.length) {
    const res = await tx
      .insert(verificationEvidence)
      .values(rows)
      .onConflictDoUpdate({
        target: [verificationEvidence.subjectType, verificationEvidence.subjectId, verificationEvidence.field, verificationEvidence.sourceUrl, verificationEvidence.extractionMethod],
        set: { claim: sql`excluded.claim`, retrievedAt: sql`excluded.retrieved_at`, excerpt: sql`excluded.excerpt`, state: sql`excluded.state`, confidence: sql`excluded.confidence` },
        setWhere: sql`(${verificationEvidence.claim}, ${verificationEvidence.retrievedAt}, ${verificationEvidence.excerpt}, ${verificationEvidence.state}, ${verificationEvidence.confidence}) is distinct from (excluded.claim, excluded.retrieved_at, excluded.excerpt, excluded.state, excluded.confidence)`,
      })
      .returning({ id: verificationEvidence.id });
    changed = res.length;
  }
  const keep = rows.map((r) => sql`(${r.field}, ${r.sourceUrl}, ${r.extractionMethod})`);
  await tx.delete(verificationEvidence).where(
    and(
      eq(verificationEvidence.subjectType, "design_system"),
      eq(verificationEvidence.subjectId, systemId),
      sql`${verificationEvidence.extractionMethod} like 'registry-research:%'`,
      keep.length ? sql`(${verificationEvidence.field}, ${verificationEvidence.sourceUrl}, ${verificationEvidence.extractionMethod}) not in (${sql.join(keep, sql`, `)})` : sql`true`,
    ),
  );
  return changed;
}

const STATUS_FIELDS = new Set(["registryStatus", "publishState", "maintenanceStatus", "ingestionStatus"]);

async function importEntry(
  tx: Tx,
  entry: RegistryEntry,
  ctx: { fwIds: Map<string, string>; plIds: Map<string, string>; resolveAdapter: (slug: string) => SourceAdapter | undefined; warnings: string[] },
): Promise<"created" | "updated" | "unchanged"> {
  const organizationId = await ensureOrganization(tx, entry.organization);
  const licenseId = entry.license ? await ensureLicense(tx, entry.license) : null;
  const [existing] = await tx.select().from(designSystems).where(eq(designSystems.slug, entry.slug));
  const adapter = ctx.resolveAdapter(entry.slug);
  const verified = entry.registryStatus === "verified";
  let ingestionStatus: SystemRow["ingestionStatus"] = existing?.ingestionStatus ?? "not_started";
  if (verified && !adapter) {
    if (!existing || ["not_started", "metadata_only", "unsupported"].includes(existing.ingestionStatus)) ingestionStatus = "metadata_only";
  } else if (existing?.ingestionStatus === "metadata_only") ingestionStatus = "not_started";
  const evidenceSummary: RegistryEvidenceSummary = {
    checks: entry.checks.map((c) => ({ field: c.field, url: c.url, status: c.status, ok: c.ok, checkedAt: c.checkedAt, ...(c.note ? { note: c.note } : {}) })),
  };
  const ingested = !!existing?.lastIngestedAt;
  const values = {
    slug: entry.slug,
    name: entry.name,
    aliases: entry.aliases ?? [],
    relatedSlugs: entry.relatedSlugs ?? [],
    replacedBySlug: entry.replacedBy ?? null,
    organizationId,
    category: entry.category,
    summary: entry.summary,
    homepageUrl: entry.homepageUrl,
    docsUrl: entry.docsUrl,
    repositoryUrl: entry.repositoryUrl,
    figmaUrl: entry.figmaUrl,
    storybookUrl: entry.storybookUrl,
    packages: entry.packages,
    licenseId,
    docAccess: entry.docAccess,
    maintenanceStatus: entry.maintenanceStatus,
    latestVersion: ingested && existing?.latestVersion ? existing.latestVersion : entry.latestVersion,
    latestReleaseAt: ingested && existing?.latestReleaseAt ? existing.latestReleaseAt : toDate(entry.latestReleaseAt),
    registryStatus: entry.registryStatus,
    registryRank: entry.rank,
    registryNotes: entry.notes,
    duplicateOfSlug: entry.duplicateOf,
    replacesSlug: entry.replacesSlug,
    registryEvidence: evidenceSummary,
    ingestionStatus,
    adapterId: adapter?.id ?? null,
    confidence: entry.confidence,
    lastVerifiedAt: toDate(entry.verifiedAt),
    publishState: verified ? ("published" as const) : ("draft" as const),
  };

  let systemId: string;
  let kind: "created" | "updated" | "unchanged" = "unchanged";
  const changes: FieldChange[] = [];
  if (!existing) {
    const [row] = await tx.insert(designSystems).values(values).returning({ id: designSystems.id });
    systemId = row!.id;
    kind = "created";
  } else {
    systemId = existing.id;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values) as [keyof typeof values, unknown][]) {
      const before = (existing as Record<string, unknown>)[k];
      if (cmp(before) !== cmp(v)) {
        patch[k] = v;
        changes.push({ field: k, before: bound(before), after: bound(v), summary: `${k} changed` });
      }
    }
    if (Object.keys(patch).length) {
      await tx.update(designSystems).set(patch).where(eq(designSystems.id, systemId));
      kind = "updated";
    }
  }

  const links: LinkSync = { changes: [], warnings: ctx.warnings };
  await syncFrameworks(tx, systemId, entry, ctx.fwIds, links);
  await syncPlatforms(tx, systemId, entry, ctx.plIds, links);
  await syncTags(tx, systemId, entry, links);
  const src = await syncSources(tx, systemId, entry);
  const ev = await syncEvidence(tx, systemId, entry);
  if (kind !== "created") {
    changes.push(...links.changes);
    if (src.changed || src.removed) changes.push({ field: "sources", summary: `sources: ${src.changed} upserted, ${src.removed} removed` });
    if (ev) changes.push({ field: "evidence", summary: `registry evidence: ${ev} check(s) added or changed` });
    if (changes.length && kind === "unchanged") kind = "updated";
  }

  const coverage = await computeSystemCoverage(tx, systemId);
  const [cur] = await tx.select({ coverage: designSystems.coverage }).from(designSystems).where(eq(designSystems.id, systemId));
  if (coverageChanged(cur?.coverage, coverage)) await tx.update(designSystems).set({ coverage }).where(eq(designSystems.id, systemId));

  if (kind === "created") {
    await tx.insert(changeEvents).values({ designSystemId: systemId, entityType: "design_system", entityId: systemId, entityLabel: entry.name, changeKind: "created", fieldChanges: [{ field: "registryStatus", after: entry.registryStatus, summary: `imported from registry (${entry.registryStatus})` }] });
  } else if (kind === "updated") {
    const statusChange = changes.some((c) => STATUS_FIELDS.has(c.field));
    await tx.insert(changeEvents).values({ designSystemId: systemId, entityType: "design_system", entityId: systemId, entityLabel: entry.name, changeKind: statusChange ? "status-changed" : "updated", fieldChanges: changes });
  }
  return kind;
}

/** Import registry files. Each entry is applied in its own transaction. */
export async function importRegistry(opts: ImportOptions = {}): Promise<ImportReport> {
  const db = opts.db ?? getDb();
  const report: ImportReport = { files: [], entries: 0, imported: 0, created: [], updated: [], unchanged: [], invalid: [], skipped: [], warnings: [] };
  const loaded = opts.entries ?? loadFiles(opts.files ?? registryFiles(opts.dir), report);
  report.files = [...new Set(loaded.map((l) => l.file))];
  const resolveAdapter = opts.resolveAdapter ?? adapterForSystem;
  const fwIds = new Map((await db.select({ id: frameworks.id, slug: frameworks.slug }).from(frameworks)).map((r) => [r.slug, r.id]));
  const plIds = new Map((await db.select({ id: platforms.id, slug: platforms.slug }).from(platforms)).map((r) => [r.slug, r.id]));
  if (!fwIds.size || !plIds.size) report.warnings.push("framework/platform reference data is empty; run seedReferenceData() first");

  const valid: { file: string; index: number; entry: RegistryEntry }[] = [];
  for (const { file, data } of loaded) {
    if (!Array.isArray(data)) {
      report.invalid.push({ file, index: -1, slug: null, problems: ["file is not a JSON array"] });
      continue;
    }
    data.forEach((raw, index) => {
      report.entries++;
      const r = RegistryEntry.safeParse(raw);
      const slug = typeof (raw as { slug?: unknown })?.slug === "string" ? ((raw as { slug: string }).slug) : null;
      if (!r.success) report.invalid.push({ file, index, slug, problems: r.error.issues.slice(0, 12).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) });
      else valid.push({ file, index, entry: r.data });
    });
  }
  const seen = new Map<string, string>();
  for (const v of valid) {
    const first = seen.get(v.entry.slug);
    if (first) {
      report.skipped.push({ file: v.file, index: v.index, slug: v.entry.slug, problems: [`duplicate slug; first defined in ${first}`] });
      continue;
    }
    seen.set(v.entry.slug, v.file);
    try {
      const kind = await db.transaction((tx) => importEntry(tx as unknown as Tx, v.entry, { fwIds, plIds, resolveAdapter, warnings: report.warnings }));
      report.imported++;
      report[kind].push(v.entry.slug);
    } catch (e) {
      report.skipped.push({ file: v.file, index: v.index, slug: v.entry.slug, problems: [`import failed: ${(e as Error).message}`] });
    }
  }
  return report;
}
