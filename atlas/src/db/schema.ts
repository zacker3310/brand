/**
 * ATLAS canonical database schema.
 *
 * Design rules (see docs/ARCHITECTURE.md):
 *  - Observations (source_document, source_snapshot, extraction) are separate from canonical
 *    published records (design_system, component, token, ...). Publishing promotes validated
 *    extractions into canonical tables; invalid/conflicting ones stay quarantined.
 *  - Every canonical record has a natural unique key so ingestion upserts are idempotent.
 *  - Unknown is never stored as a guess. Per-field `coverage` maps record whether a field was
 *    documented, documented as absent, not documented, not extracted, or inferred.
 *  - Provenance is stored in verification_evidence (polymorphic subject) and linked snapshots.
 *  - Raw page bodies are NOT stored in the database. Only hashes, metadata and bounded excerpts.
 *
 * OWNERSHIP: this file is foundational. Only the integrator edits it. Agents request changes.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CoverageMap,
  FieldChange,
  KeyboardInteraction,
  RegistryEvidenceSummary,
  RunStats,
  SystemCoverageSummary,
} from "@/lib/contracts";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

export const verificationState = pgEnum("verification_state", [
  "verified", // confirmed against an authoritative source, evidence stored
  "inferred", // heuristic / derived classification, explicitly not a source claim
  "unverified", // claimed by research input but not yet confirmed
  "unavailable", // looked for; the source does not provide it
  "conflicting", // multiple sources disagree; needs review
]);

export const systemCategory = pgEnum("system_category", [
  "design-system", // full system: principles, tokens, components, guidance
  "design-language", // guidelines/language, implementation optional (e.g. Apple HIG)
  "component-library", // styled component implementation
  "headless-library", // unstyled accessible primitives
  "css-framework", // CSS-first framework (Bootstrap, Bulma)
  "ui-framework", // app framework with UI kit (Ionic, Quasar, Framework7)
  "styling-engine", // styling system / tooling (Panda CSS)
  "web-components", // web-components implementation of a system
  "commercial-suite", // commercial component suites (Kendo, Syncfusion)
  "pattern-library", // patterns & guidance without full component kit
]);

export const maintenanceStatus = pgEnum("maintenance_status", [
  "active",
  "maintenance", // receives fixes, no major development
  "deprecated",
  "archived",
  "unknown",
]);

export const docAccess = pgEnum("doc_access", ["public", "partial", "private", "unknown"]);

export const registryStatus = pgEnum("registry_status", [
  "candidate", // in research queue
  "verified", // counted toward the 100
  "rejected", // inaccessible / unsuitable; kept with reason
  "duplicate", // same system as another entry; points to canonical
  "replaced", // rejected and replaced by another verified system
]);

export const ingestionStatus = pgEnum("ingestion_status", [
  "not_started",
  "queued",
  "running",
  "metadata_only", // registry facts verified, no deep adapter
  "partial", // some documents ingested, coverage incomplete
  "indexed", // adapter completed and published component/token data
  "failed",
  "blocked", // robots / terms / access controls prevent ingestion
  "unsupported", // no adapter and generic parsing not applicable
]);

export const publishState = pgEnum("publish_state", ["draft", "published", "quarantined", "retired"]);

export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "cancelled", "dead"]);

export const runStatus = pgEnum("run_status", ["pending", "running", "succeeded", "partial", "failed", "cancelled"]);

export const tokenCategory = pgEnum("token_category", [
  "color",
  "typography",
  "spacing",
  "shape", // radius, border width
  "elevation", // shadow, z-index
  "motion", // duration, easing
  "layout", // breakpoints, containers, grid
  "opacity",
  "other",
]);

export const tokenTier = pgEnum("token_tier", ["primitive", "semantic", "component"]);

export const redistribution = pgEnum("redistribution", ["permitted", "conditional", "restricted", "unknown"]);

/* -------------------------------------------------------------------------- */
/* Reference entities                                                          */
/* -------------------------------------------------------------------------- */

export const organizations = pgTable("organization", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  websiteUrl: text("website_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const licenses = pgTable("license", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(), // "mit", "apache-2.0", "proprietary-apple-hig"
  spdxId: text("spdx_id"), // null for non-SPDX/proprietary
  name: text("name").notNull(),
  url: text("url"),
  isOpenSource: boolean("is_open_source"),
  redistribution: redistribution("redistribution").notNull().default("unknown"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const frameworks = pgTable("framework", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(), // "react", "vue", "angular", "web-components", "flutter", "swiftui"
  name: text("name").notNull(),
  kind: text("kind").notNull().default("web"), // web | mobile | desktop | css | native
  websiteUrl: text("website_url"),
});

export const platforms = pgTable("platform", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(), // "web", "ios", "android", "macos", "windows", ...
  name: text("name").notNull(),
});

export const categories = pgTable(
  "category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    kind: text("kind").notNull(), // "component-group" | "pattern-group" | "system-tag-group"
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("category_kind_slug_uq").on(t.kind, t.slug)],
);

export const tags = pgTable("tag", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

/** Canonical component taxonomy (ATLAS-defined). Seeded from src/lib/taxonomy. */
export const componentTypes = pgTable(
  "component_type",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(), // "button", "combobox", "date-picker"
    name: text("name").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    description: text("description").notNull(), // ATLAS-authored canonical purpose
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`), // names that map here
    nearSynonyms: text("near_synonyms").array().notNull().default(sql`'{}'::text[]`), // related, NOT interchangeable
    ariaPattern: text("aria_pattern"), // WAI-ARIA APG pattern slug, ATLAS reference
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("component_type_category_idx").on(t.categoryId)],
);

/** Canonical pattern taxonomy (ATLAS-defined). */
export const patternTypes = pgTable("pattern_type", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
  sortOrder: integer("sort_order").notNull().default(0),
});

/* -------------------------------------------------------------------------- */
/* Design systems & registry                                                   */
/* -------------------------------------------------------------------------- */

export const designSystems = pgTable(
  "design_system",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`), // former / alternate names ("NextUI")
    organizationId: uuid("organization_id").references(() => organizations.id),
    category: systemCategory("category").notNull(),
    summary: text("summary"), // ATLAS-authored, concise, factual
    philosophy: text("philosophy"), // ATLAS-authored synthesis of documented principles (evidence-backed)
    principles: jsonb("principles").$type<{ name: string; sourceUrl: string }[]>(), // documented principle names only

    homepageUrl: text("homepage_url"),
    docsUrl: text("docs_url"),
    repositoryUrl: text("repository_url"),
    figmaUrl: text("figma_url"), // only when verified
    storybookUrl: text("storybook_url"),
    packages: jsonb("packages").$type<{ name: string; registry: "npm" | "pub" | "cocoapods" | "maven" | "nuget" | "other"; url: string }[]>(),

    licenseId: uuid("license_id").references(() => licenses.id),
    docAccess: docAccess("doc_access").notNull().default("unknown"),
    maintenanceStatus: maintenanceStatus("maintenance_status").notNull().default("unknown"),
    latestVersion: text("latest_version"),
    latestReleaseAt: ts("latest_release_at"),

    // Registry bookkeeping (the 100-candidate research queue)
    registryStatus: registryStatus("registry_status").notNull().default("candidate"),
    registryRank: integer("registry_rank"), // position in the initial research list (1..100), null for replacements
    registryNotes: text("registry_notes"), // classification / dedup reasoning
    duplicateOfSlug: text("duplicate_of_slug"),
    replacesSlug: text("replaces_slug"), // this entry replaced a rejected candidate
    replacedBySlug: text("replaced_by_slug"), // rejected/duplicate entry -> its replacement
    relatedSlugs: text("related_slugs").array().notNull().default(sql`'{}'::text[]`), // e.g. react-spectrum -> adobe-spectrum
    registryEvidence: jsonb("registry_evidence").$type<RegistryEvidenceSummary>(),

    ingestionStatus: ingestionStatus("ingestion_status").notNull().default("not_started"),
    adapterId: text("adapter_id"), // which adapter ingests it (null = metadata only)
    confidence: doublePrecision("confidence").notNull().default(0),
    lastVerifiedAt: ts("last_verified_at"),
    lastIngestedAt: ts("last_ingested_at"),
    coverage: jsonb("coverage").$type<SystemCoverageSummary>(), // derived counts, refreshed on publish
    publishState: publishState("publish_state").notNull().default("draft"),
    isFeatured: boolean("is_featured").notNull().default(false),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("design_system_category_idx").on(t.category),
    index("design_system_publish_idx").on(t.publishState, t.registryStatus),
    index("design_system_name_trgm").using("gin", t.name.op("gin_trgm_ops")),
  ],
);

export const designSystemFrameworks = pgTable(
  "design_system_framework",
  {
    designSystemId: uuid("design_system_id")
      .notNull()
      .references(() => designSystems.id, { onDelete: "cascade" }),
    frameworkId: uuid("framework_id")
      .notNull()
      .references(() => frameworks.id),
    support: text("support").notNull().default("official"), // official | community
    packageName: text("package_name"),
    verificationState: verificationState("verification_state").notNull().default("unverified"),
    sourceUrl: text("source_url"),
  },
  (t) => [primaryKey({ columns: [t.designSystemId, t.frameworkId] })],
);

export const designSystemPlatforms = pgTable(
  "design_system_platform",
  {
    designSystemId: uuid("design_system_id")
      .notNull()
      .references(() => designSystems.id, { onDelete: "cascade" }),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => platforms.id),
    verificationState: verificationState("verification_state").notNull().default("unverified"),
    sourceUrl: text("source_url"),
  },
  (t) => [primaryKey({ columns: [t.designSystemId, t.platformId] })],
);

export const designSystemTags = pgTable(
  "design_system_tag",
  {
    designSystemId: uuid("design_system_id")
      .notNull()
      .references(() => designSystems.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id),
    verificationState: verificationState("verification_state").notNull().default("inferred"),
  },
  (t) => [primaryKey({ columns: [t.designSystemId, t.tagId] })],
);

/* -------------------------------------------------------------------------- */
/* Sources & observations                                                      */
/* -------------------------------------------------------------------------- */

export const sources = pgTable(
  "source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    designSystemId: uuid("design_system_id")
      .notNull()
      .references(() => designSystems.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // homepage | docs | repository | package | token-package | figma | storybook | sitemap | changelog
    url: text("url").notNull(),
    label: text("label"),
    isOfficial: boolean("is_official").notNull().default(true),
    robotsAllowed: boolean("robots_allowed"), // null = not checked
    lastCheckedAt: ts("last_checked_at"),
    lastStatus: integer("last_status"),
    lastError: text("last_error"),
    discoveredBy: text("discovered_by").notNull(), // "registry" | "adapter:primer" | "sitemap"
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("source_system_url_uq").on(t.designSystemId, t.url), index("source_kind_idx").on(t.kind)],
);

export const sourceDocuments = pgTable(
  "source_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    designSystemId: uuid("design_system_id")
      .notNull()
      .references(() => designSystems.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    docKind: text("doc_kind").notNull(), // adapter-defined: "component-docs-json" | "token-json" | "mdx" | "html" | ...
    title: text("title"),
    contentType: text("content_type"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastHash: text("last_hash"),
    lastFetchedAt: ts("last_fetched_at"),
    lastStatus: integer("last_status"),
    status: text("status").notNull().default("active"), // active | gone | blocked | error
    discoveredAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("source_document_system_url_uq").on(t.designSystemId, t.url),
    index("source_document_source_idx").on(t.sourceId),
  ],
);

/** One row per distinct content version of a document. Raw bodies live in the disk cache keyed by hash. */
export const sourceSnapshots = pgTable(
  "source_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceDocumentId: uuid("source_document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => ingestionRuns.id, { onDelete: "set null" }),
    contentHash: text("content_hash").notNull(), // sha256 hex of body
    httpStatus: integer("http_status").notNull(),
    contentType: text("content_type"),
    byteSize: integer("byte_size").notNull(),
    etag: text("etag"),
    lastModified: text("last_modified"),
    title: text("title"),
    excerpt: text("excerpt"), // bounded (<= 400 chars) for evidence display
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("snapshot_doc_hash_uq").on(t.sourceDocumentId, t.contentHash)],
);

/* -------------------------------------------------------------------------- */
/* Ingestion operations                                                        */
/* -------------------------------------------------------------------------- */

export const ingestionRuns = pgTable(
  "ingestion_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    designSystemId: uuid("design_system_id").references(() => designSystems.id, { onDelete: "cascade" }),
    adapterId: text("adapter_id"),
    adapterVersion: text("adapter_version"),
    kind: text("kind").notNull(), // full | incremental | verify-registry | link-check
    status: runStatus("status").notNull().default("pending"),
    stage: text("stage"), // current stage: discover | fetch | parse | normalize | validate | publish | done
    triggeredBy: text("triggered_by").notNull().default("cli"),
    checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>(), // resumability cursor
    stats: jsonb("stats").$type<RunStats>(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("run_system_idx").on(t.designSystemId, t.createdAt)],
);

/** Durable PostgreSQL job queue (claimed with FOR UPDATE SKIP LOCKED). */
export const ingestionJobs = pgTable(
  "ingestion_job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queue: text("queue").notNull().default("ingest"),
    kind: text("kind").notNull(), // run-system | discover | fetch | parse | publish | verify-url | refresh-all
    runId: uuid("run_id").references(() => ingestionRuns.id, { onDelete: "cascade" }),
    designSystemId: uuid("design_system_id").references(() => designSystems.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text("dedupe_key"), // unique among live jobs -> idempotent enqueue
    status: jobStatus("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(100), // lower runs first
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: ts("run_at").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("job_claim_idx").on(t.queue, t.status, t.priority, t.runAt),
    uniqueIndex("job_live_dedupe_uq")
      .on(t.dedupeKey)
      .where(sql`${t.status} in ('queued','running') and ${t.dedupeKey} is not null`),
    index("job_run_idx").on(t.runId),
  ],
);

export const ingestionErrors = pgTable(
  "ingestion_error",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").references(() => ingestionRuns.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => ingestionJobs.id, { onDelete: "set null" }),
    designSystemId: uuid("design_system_id").references(() => designSystems.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(), // discover | fetch | parse | normalize | validate | publish
    severity: text("severity").notNull().default("error"), // error | warning
    code: text("code").notNull(), // HTTP_404 | ROBOTS_DISALLOWED | PARSE_FAILED | VALIDATION_* ...
    message: text("message").notNull(),
    url: text("url"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
  },
  (t) => [index("ingestion_error_system_idx").on(t.designSystemId, t.createdAt), index("ingestion_error_run_idx").on(t.runId)],
);

/**
 * Parse-stage output per (document content version, adapter version). Derived data: lets runs
 * resume after parse and skip re-parsing unchanged documents. Holds extracted facts, not pages.
 */
export const parsedFragments = pgTable(
  "parsed_fragment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceDocumentId: uuid("source_document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "cascade" }),
    adapterId: text("adapter_id").notNull(),
    adapterVersion: text("adapter_version").notNull(),
    contentHash: text("content_hash").notNull(),
    fragments: jsonb("fragments").$type<unknown[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("parsed_fragment_uq").on(t.sourceDocumentId, t.adapterId, t.adapterVersion, t.contentHash)],
);

/**
 * Staging area: one normalized observation per (run, entity). Validation results attached.
 * Publish promotes `valid` rows to canonical tables. Others are visible in Ops as quarantined.
 */
export const extractions = pgTable(
  "extraction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => ingestionRuns.id, { onDelete: "cascade" }),
    designSystemId: uuid("design_system_id")
      .notNull()
      .references(() => designSystems.id, { onDelete: "cascade" }),
    entityKind: text("entity_kind").notNull(), // component | token-set | pattern | system-facts
    entityKey: text("entity_key").notNull(), // natural key inside the system (slug)
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    contentHash: text("content_hash").notNull(),
    validation: text("validation").notNull().default("pending"), // pending | valid | warning | invalid | conflict
    issues: jsonb("issues").$type<{ code: string; message: string; path?: string; severity: "error" | "warning" }[]>(),
    published: boolean("published").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("extraction_run_entity_uq").on(t.runId, t.entityKind, t.entityKey),
    index("extraction_system_idx").on(t.designSystemId, t.validation),
    index("extraction_lookup_idx").on(t.designSystemId, t.entityKind, t.entityKey, t.published, t.createdAt),
  ],
);

/** Polymorphic provenance: every published claim points to one or more evidence rows. */
export const verificationEvidence = pgTable(
  "verification_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectType: text("subject_type").notNull(), // design_system | component | token_set | token | pattern | source
    subjectId: uuid("subject_id").notNull(),
    designSystemId: uuid("design_system_id").references(() => designSystems.id, { onDelete: "cascade" }),
    field: text("field").notNull(), // "docsUrl", "variants", "license", "*" (whole record)
    claim: jsonb("claim").$type<unknown>(),
    sourceUrl: text("source_url").notNull(),
    sourceTitle: text("source_title"),
    retrievedAt: ts("retrieved_at").notNull(),
    contentHash: text("content_hash"),
    snapshotId: uuid("snapshot_id").references(() => sourceSnapshots.id, { onDelete: "set null" }),
    extractionMethod: text("extraction_method").notNull(), // registry-research | http-check | adapter:<id>:<parser> | heuristic:<name>
    location: text("location"), // JSON pointer / selector / file path#Lnn
    excerpt: text("excerpt"), // bounded permitted excerpt (<= 300 chars)
    state: verificationState("state").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("evidence_subject_idx").on(t.subjectType, t.subjectId),
    index("evidence_system_idx").on(t.designSystemId),
    uniqueIndex("evidence_dedupe_uq").on(t.subjectType, t.subjectId, t.field, t.sourceUrl, t.extractionMethod),
  ],
);

export const changeEvents = pgTable(
  "change_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    designSystemId: uuid("design_system_id").references(() => designSystems.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(), // design_system | component | token_set | pattern | source_document
    entityId: uuid("entity_id"),
    entityLabel: text("entity_label"),
    changeKind: text("change_kind").notNull(), // created | updated | removed | source-changed | verified | status-changed
    fieldChanges: jsonb("field_changes").$type<FieldChange[]>(),
    runId: uuid("run_id").references(() => ingestionRuns.id, { onDelete: "set null" }),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
  },
  (t) => [index("change_event_system_idx").on(t.designSystemId, t.occurredAt), index("change_event_time_idx").on(t.occurredAt)],
);

/* -------------------------------------------------------------------------- */
/* Components                                                                  */
/* -------------------------------------------------------------------------- */

export const components = pgTable(
  "component",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    designSystemId: uuid("design_system_id")
      .notNull()
      .references(() => designSystems.id, { onDelete: "cascade" }),
    componentTypeId: uuid("component_type_id").references(() => componentTypes.id), // null = unclassified
    classificationState: verificationState("classification_state").notNull().default("inferred"),
    classificationMethod: text("classification_method"), // "alias-exact:button" | "adapter-declared" | "heuristic:name-token"
    slug: text("slug").notNull(),
    name: text("name").notNull(), // system-specific original name
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`), // source terminology
    description: text("description"), // concise permitted excerpt or ATLAS paraphrase, null if not documented
    docsUrl: text("docs_url"),
    sourceCodeUrl: text("source_code_url"),
    lifecycle: text("lifecycle").notNull().default("unknown"), // stable | beta | experimental | deprecated | unknown
    sizes: text("sizes").array(), // null = not extracted, [] = documented none
    responsiveGuidance: text("responsive_guidance"),
    coverage: jsonb("coverage").$type<CoverageMap>().notNull().default({}),
    licenseId: uuid("license_id").references(() => licenses.id),
    confidence: doublePrecision("confidence").notNull().default(0),
    publishState: publishState("publish_state").notNull().default("published"),
    contentHash: text("content_hash"),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastChangedAt: ts("last_changed_at").notNull().defaultNow(),
    lastSeenRunId: uuid("last_seen_run_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("component_system_slug_uq").on(t.designSystemId, t.slug),
    index("component_type_idx").on(t.componentTypeId),
    index("component_name_trgm").using("gin", t.name.op("gin_trgm_ops")),
  ],
);

export const componentFrameworks = pgTable(
  "component_framework",
  {
    componentId: uuid("component_id")
      .notNull()
      .references(() => components.id, { onDelete: "cascade" }),
    frameworkId: uuid("framework_id")
      .notNull()
      .references(() => frameworks.id),
    packageName: text("package_name"),
    importName: text("import_name"),
    sourceUrl: text("source_url"),
  },
  (t) => [primaryKey({ columns: [t.componentId, t.frameworkId] })],
);

export const componentVariants = pgTable(
  "component_variant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    componentId: uuid("component_id")
      .notNull()
      .references(() => components.id, { onDelete: "cascade" }),
    axis: text("axis").notNull().default("variant"), // variant | appearance | size | emphasis | shape | density | tone
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    sourceUrl: text("source_url"),
    location: text("location"),
  },
  (t) => [uniqueIndex("variant_component_axis_slug_uq").on(t.componentId, t.axis, t.slug)],
);

export const componentStates = pgTable(
  "component_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    componentId: uuid("component_id")
      .notNull()
      .references(() => components.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    canonicalState: text("canonical_state"), // hover | focus | active | disabled | loading | selected | error | readonly | ...
    description: text("description"),
    sourceUrl: text("source_url"),
  },
  (t) => [uniqueIndex("state_component_slug_uq").on(t.componentId, t.slug)],
);

export const componentProperties = pgTable(
  "component_property",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    componentId: uuid("component_id")
      .notNull()
      .references(() => components.id, { onDelete: "cascade" }),
    implementation: text("implementation").notNull().default("default"), // framework slug or "default"
    name: text("name").notNull(),
    type: text("type"),
    defaultValue: text("default_value"),
    required: boolean("required"),
    deprecated: boolean("deprecated").notNull().default(false),
    description: text("description"),
    allowedValues: text("allowed_values").array(),
    sourceUrl: text("source_url"),
  },
  (t) => [uniqueIndex("property_component_impl_name_uq").on(t.componentId, t.implementation, t.name)],
);

export const componentExamples = pgTable(
  "component_example",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    componentId: uuid("component_id")
      .notNull()
      .references(() => components.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    kind: text("kind").notNull(), // code-snippet | docs-link | storybook-link | atlas-representation
    language: text("language"),
    code: text("code"), // only when license permits redistribution; null otherwise
    url: text("url"),
    licenseId: uuid("license_id").references(() => licenses.id),
    attribution: text("attribution"),
  },
  (t) => [uniqueIndex("example_component_slug_uq").on(t.componentId, t.slug)],
);

export const componentAccessibility = pgTable("component_accessibility", {
  componentId: uuid("component_id")
    .primaryKey()
    .references(() => components.id, { onDelete: "cascade" }),
  ariaPattern: text("aria_pattern"),
  roles: text("roles").array(),
  keyboard: jsonb("keyboard").$type<KeyboardInteraction[]>(),
  guidance: text("guidance"), // concise paraphrase / permitted excerpt
  screenReader: text("screen_reader"),
  focusManagement: text("focus_management"),
  wcagCriteria: text("wcag_criteria").array(),
  docsUrl: text("docs_url"),
  coverage: jsonb("coverage").$type<CoverageMap>().notNull().default({}),
});

export const componentRelationships = pgTable(
  "component_relationship",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromComponentId: uuid("from_component_id")
      .notNull()
      .references(() => components.id, { onDelete: "cascade" }),
    toComponentId: uuid("to_component_id").references(() => components.id, { onDelete: "cascade" }),
    toComponentTypeId: uuid("to_component_type_id").references(() => componentTypes.id),
    kind: text("kind").notNull(), // related | composes | composed-of | alternative | subcomponent | see-also
    verificationState: verificationState("verification_state").notNull().default("verified"),
    sourceUrl: text("source_url"),
  },
  (t) => [
    uniqueIndex("relationship_uq").on(t.fromComponentId, t.kind, t.toComponentId, t.toComponentTypeId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Tokens                                                                      */
/* -------------------------------------------------------------------------- */

export const tokenSets = pgTable(
  "token_set",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    designSystemId: uuid("design_system_id")
      .notNull()
      .references(() => designSystems.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(), // "base", "light", "dark", "typography"
    name: text("name").notNull(),
    theme: text("theme"), // light | dark | high-contrast | null (theme-agnostic)
    format: text("format").notNull(), // dtcg | style-dictionary | css-vars | js-module | scss
    sourceUrl: text("source_url").notNull(),
    packageName: text("package_name"),
    packageVersion: text("package_version"),
    licenseId: uuid("license_id").references(() => licenses.id),
    redistribution: redistribution("redistribution").notNull().default("unknown"),
    tokenCount: integer("token_count").notNull().default(0),
    publishState: publishState("publish_state").notNull().default("published"),
    contentHash: text("content_hash"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("token_set_system_slug_uq").on(t.designSystemId, t.slug)],
);

export const tokens = pgTable(
  "token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenSetId: uuid("token_set_id")
      .notNull()
      .references(() => tokenSets.id, { onDelete: "cascade" }),
    designSystemId: uuid("design_system_id")
      .notNull()
      .references(() => designSystems.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // original dotted path or variable name
    path: text("path").array().notNull(),
    cssVar: text("css_var"),
    category: tokenCategory("category").notNull(),
    type: text("type"), // DTCG $type when known: color | dimension | fontFamily | fontWeight | duration | cubicBezier | shadow | typography | number ...
    tier: tokenTier("tier"),
    tierState: verificationState("tier_state").notNull().default("inferred"),
    rawValue: jsonb("raw_value").$type<unknown>(), // as authored (may contain references)
    resolvedValue: jsonb("resolved_value").$type<unknown>(), // after alias resolution (null if unresolved)
    valueText: text("value_text"), // display string of resolved value
    isAlias: boolean("is_alias").notNull().default(false),
    aliasState: text("alias_state"), // literal | resolved | unresolved | cycle | external | null
    description: text("description"),
    deprecated: boolean("deprecated").notNull().default(false),
    location: text("location"), // file path + JSON pointer
  },
  (t) => [
    uniqueIndex("token_set_name_uq").on(t.tokenSetId, t.name),
    index("token_system_category_idx").on(t.designSystemId, t.category),
    index("token_name_trgm").using("gin", t.name.op("gin_trgm_ops")),
  ],
);

export const tokenAliases = pgTable(
  "token_alias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => tokens.id, { onDelete: "cascade" }),
    targetRef: text("target_ref").notNull(), // raw reference string, e.g. "{base.color.blue.5}"
    targetTokenId: uuid("target_token_id").references(() => tokens.id, { onDelete: "set null" }),
    state: text("state").notNull(), // resolved | unresolved | cycle | external
    depth: integer("depth"), // chain length to a concrete value
  },
  (t) => [uniqueIndex("token_alias_uq").on(t.tokenId, t.targetRef), index("token_alias_target_idx").on(t.targetTokenId)],
);

export const tokenUsages = pgTable(
  "token_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => tokens.id, { onDelete: "cascade" }),
    componentId: uuid("component_id")
      .notNull()
      .references(() => components.id, { onDelete: "cascade" }),
    property: text("property"), // css property / role where documented
    sourceUrl: text("source_url"),
  },
  (t) => [uniqueIndex("token_usage_uq").on(t.tokenId, t.componentId, t.property)],
);

/* -------------------------------------------------------------------------- */
/* Patterns                                                                    */
/* -------------------------------------------------------------------------- */

export const designPatterns = pgTable(
  "design_pattern",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    designSystemId: uuid("design_system_id")
      .notNull()
      .references(() => designSystems.id, { onDelete: "cascade" }),
    patternTypeId: uuid("pattern_type_id").references(() => patternTypes.id),
    classificationState: verificationState("classification_state").notNull().default("inferred"),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    docsUrl: text("docs_url"),
    coverage: jsonb("coverage").$type<CoverageMap>().notNull().default({}),
    confidence: doublePrecision("confidence").notNull().default(0),
    publishState: publishState("publish_state").notNull().default("published"),
    contentHash: text("content_hash"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("pattern_system_slug_uq").on(t.designSystemId, t.slug), index("pattern_type_idx").on(t.patternTypeId)],
);

export const patternComponents = pgTable(
  "pattern_component",
  {
    patternId: uuid("pattern_id")
      .notNull()
      .references(() => designPatterns.id, { onDelete: "cascade" }),
    componentId: uuid("component_id")
      .notNull()
      .references(() => components.id, { onDelete: "cascade" }),
    role: text("role"),
  },
  (t) => [primaryKey({ columns: [t.patternId, t.componentId] })],
);

/* -------------------------------------------------------------------------- */
/* Assets                                                                      */
/* -------------------------------------------------------------------------- */

export const assetReferences = pgTable(
  "asset_reference",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    designSystemId: uuid("design_system_id").references(() => designSystems.id, { onDelete: "cascade" }),
    componentId: uuid("component_id").references(() => components.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // logo | screenshot | preview | figma-file | atlas-representation
    url: text("url").notNull(),
    permission: text("permission").notNull(), // official-permitted | licensed-package | atlas-generated | link-only
    licenseId: uuid("license_id").references(() => licenses.id),
    attribution: text("attribution"),
    alt: text("alt"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("asset_uq").on(t.designSystemId, t.componentId, t.kind, t.url)],
);

/* -------------------------------------------------------------------------- */
/* Users, collections, comparisons                                             */
/* -------------------------------------------------------------------------- */

/** Optional authenticated layer (future). Anonymous owners use a signed cookie id in owner_id. */
export const appUsers = pgTable("app_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
  displayName: text("display_name"),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const collections = pgTable(
  "collection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(), // anon:<uuid> or user:<uuid>
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    visibility: text("visibility").notNull().default("private"), // private | unlisted | public
    isCurated: boolean("is_curated").notNull().default(false), // ATLAS editorial collections
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("collection_owner_slug_uq").on(t.ownerId, t.slug)],
);

export const collectionItems = pgTable(
  "collection_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(), // system | component | token | pattern | comparison | component-type
    entityId: uuid("entity_id").notNull(),
    note: text("note"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    position: integer("position").notNull().default(0),
    addedAt: createdAt(),
  },
  (t) => [uniqueIndex("collection_item_uq").on(t.collectionId, t.entityType, t.entityId)],
);

export const bookmarks = pgTable(
  "bookmark",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("bookmark_uq").on(t.ownerId, t.entityType, t.entityId)],
);

export const comparisons = pgTable("comparison", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  ownerId: text("owner_id"), // null = ATLAS editorial
  title: text("title").notNull(),
  componentTypeId: uuid("component_type_id").references(() => componentTypes.id),
  systemSlugs: text("system_slugs").array().notNull(),
  criteria: jsonb("criteria").$type<string[]>(),
  isFeatured: boolean("is_featured").notNull().default(false),
  viewCount: integer("view_count").notNull().default(0),
  createdAt: createdAt(),
});

/* -------------------------------------------------------------------------- */
/* Search index (abstraction backing store for the Postgres search provider)   */
/* -------------------------------------------------------------------------- */

export const searchDocuments = pgTable(
  "search_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(), // system | component | component-type | pattern | pattern-type | token | framework | category
    entityId: uuid("entity_id").notNull(),
    systemSlug: text("system_slug"),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    body: text("body"),
    keywords: text("keywords"), // space-separated aliases/synonyms
    url: text("url").notNull(),
    facets: jsonb("facets").$type<Record<string, string[] | string | number | boolean | null>>().notNull().default({}),
    boost: doublePrecision("boost").notNull().default(1),
    tsv: tsvector("tsv").generatedAlwaysAs(
      sql`setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('simple'::regconfig, coalesce(keywords, '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce(subtitle, '')), 'B') || setweight(to_tsvector('english'::regconfig, coalesce(body, '')), 'C')`,
    ),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("search_document_entity_uq").on(t.entityType, t.entityId),
    index("search_document_tsv_idx").using("gin", t.tsv),
    index("search_document_title_trgm").using("gin", t.title.op("gin_trgm_ops")),
    index("search_document_type_idx").on(t.entityType),
  ],
);
