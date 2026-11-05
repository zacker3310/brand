/**
 * Downloadable exports: systems, components and collections as JSON or CSV.
 * Contents: ATLAS metadata + names + ATLAS-authored summaries + official source URLs + disclaimer.
 * No documentation text, code or token values are included (token value exports live under
 * /tokens/export and only cover sets whose license permits redistribution).
 */
import type { CollectionDetail } from "@/server/queries/collections";
import type { ApiSystem, ExportComponentRow } from "./catalog";
import { CACHE } from "./http";
import { csvResponse, toCsv, type CsvColumn } from "./csv";
import { exportMeta, exportMetaLines } from "./meta";

export type ExportFormat = "json" | "csv";

const abs = (origin: string, path: string | null) => (path ? (path.startsWith("/") ? `${origin}${path}` : path) : null);

function jsonDownload(body: unknown, filename: string, cache: string): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function systemsExport(rows: ApiSystem[], format: ExportFormat, origin: string, registry: "verified" | "all"): Response {
  const meta = exportMeta(registry === "verified" ? "systems (verified registry)" : "systems (full registry incl. rejected and duplicate entries)", rows.length, [
    "summary is ATLAS-authored; urls point to official sources.",
    "frameworks/platforms list registry support claims with their verification state (JSON) or slugs (CSV).",
  ]);
  if (format === "json") {
    const data = rows.map((s) => ({
      slug: s.slug,
      name: s.name,
      aliases: s.aliases,
      category: s.category,
      organization: s.organization,
      summary: s.summary,
      urls: { ...s.urls, atlas: abs(origin, s.urls.atlas) },
      license: s.license,
      maintenanceStatus: s.maintenanceStatus,
      docAccess: s.docAccess,
      latestVersion: s.latestVersion,
      registry: s.registry,
      ingestion: s.ingestion,
      frameworks: s.frameworks,
      platforms: s.platforms,
      counts: s.counts,
    }));
    return jsonDownload({ meta, data }, `atlas-systems.json`, CACHE.export);
  }
  const cols: CsvColumn<ApiSystem>[] = [
    { header: "slug", value: (s) => s.slug },
    { header: "name", value: (s) => s.name },
    { header: "category", value: (s) => s.category },
    { header: "organization", value: (s) => s.organization?.name },
    { header: "summary", value: (s) => s.summary },
    { header: "homepage_url", value: (s) => s.urls.homepage },
    { header: "docs_url", value: (s) => s.urls.docs },
    { header: "repository_url", value: (s) => s.urls.repository },
    { header: "figma_url", value: (s) => s.urls.figma },
    { header: "storybook_url", value: (s) => s.urls.storybook },
    { header: "license_spdx", value: (s) => s.license?.spdxId },
    { header: "license_name", value: (s) => s.license?.name },
    { header: "license_redistribution", value: (s) => s.license?.redistribution },
    { header: "maintenance_status", value: (s) => s.maintenanceStatus },
    { header: "doc_access", value: (s) => s.docAccess },
    { header: "latest_version", value: (s) => s.latestVersion },
    { header: "registry_status", value: (s) => s.registry.status },
    { header: "registry_confidence", value: (s) => s.registry.confidence },
    { header: "last_verified_at", value: (s) => s.registry.lastVerifiedAt },
    { header: "duplicate_of", value: (s) => s.registry.duplicateOf },
    { header: "replaced_by", value: (s) => s.registry.replacedBy },
    { header: "ingestion_status", value: (s) => s.ingestion.status },
    { header: "last_ingested_at", value: (s) => s.ingestion.lastIngestedAt },
    { header: "frameworks", value: (s) => s.frameworks.map((f) => f.slug) },
    { header: "platforms", value: (s) => s.platforms.map((p) => p.slug) },
    { header: "components", value: (s) => s.counts.components },
    { header: "tokens", value: (s) => s.counts.tokens },
    { header: "patterns", value: (s) => s.counts.patterns },
    { header: "atlas_url", value: (s) => abs(origin, s.urls.atlas) },
  ];
  return csvResponse(toCsv(rows, cols, exportMetaLines(meta)), "atlas-systems.csv", CACHE.export);
}

export function componentsExport(rows: ExportComponentRow[], format: ExportFormat, origin: string): Response {
  const meta = exportMeta("components (published)", rows.length, [
    "type is the ATLAS taxonomy classification; classification_state says whether it is verified (source names the pattern) or inferred (ATLAS heuristic).",
    "docs_url / source_code_url are official sources; names are the systems' own component names.",
  ]);
  if (format === "json") {
    return jsonDownload({ meta, data: rows.map((r) => ({ ...r, atlasUrl: abs(origin, r.atlasUrl) })) }, "atlas-components.json", CACHE.export);
  }
  const cols: CsvColumn<ExportComponentRow>[] = [
    { header: "system", value: (r) => r.system },
    { header: "system_name", value: (r) => r.systemName },
    { header: "name", value: (r) => r.name },
    { header: "slug", value: (r) => r.slug },
    { header: "atlas_type", value: (r) => r.type },
    { header: "atlas_type_name", value: (r) => r.typeName },
    { header: "classification_state", value: (r) => r.classificationState },
    { header: "classification_method", value: (r) => r.classificationMethod },
    { header: "lifecycle", value: (r) => r.lifecycle },
    { header: "frameworks", value: (r) => r.frameworks },
    { header: "docs_url", value: (r) => r.docsUrl },
    { header: "source_code_url", value: (r) => r.sourceCodeUrl },
    { header: "atlas_url", value: (r) => abs(origin, r.atlasUrl) },
    { header: "last_changed_at", value: (r) => r.lastChangedAt },
  ];
  return csvResponse(toCsv(rows, cols, exportMetaLines(meta)), "atlas-components.csv", CACHE.export);
}

export function collectionExport(c: CollectionDetail, format: ExportFormat, origin: string): Response {
  const meta = exportMeta(`collection "${c.name}"`, c.items.length, [
    c.isCurated ? `ATLAS curated collection. Membership rule: ${c.description ?? "see ATLAS"}` : "Personal collection exported from ATLAS.",
    "status: present = in the index; retired = removed by its source and kept for history; missing = no longer in the index.",
  ]);
  const cache = c.isCurated ? CACHE.catalog : CACHE.owner;
  const filename = `atlas-collection-${c.slug}.${format}`;
  const status = (i: CollectionDetail["items"][number]) => (!i.exists ? "missing" : i.state === "retired" ? "retired" : "present");
  if (format === "json") {
    return jsonDownload(
      {
        meta,
        collection: { slug: c.slug, name: c.name, description: c.description, curated: c.isCurated, createdAt: c.createdAt, updatedAt: c.updatedAt, tags: c.tags },
        data: c.items.map((i) => ({
          position: i.position,
          entityType: i.entityType,
          entityId: i.entityId,
          title: i.title,
          subtitle: i.subtitle,
          system: i.systemSlug ? { slug: i.systemSlug, name: i.systemName } : null,
          status: status(i),
          note: i.note,
          tags: i.tags,
          officialSourceUrl: i.sourceUrl,
          atlasUrl: abs(origin, i.url),
          addedAt: i.addedAt,
        })),
      },
      filename,
      cache,
    );
  }
  const cols: CsvColumn<CollectionDetail["items"][number]>[] = [
    { header: "position", value: (i) => i.position + 1 },
    { header: "entity_type", value: (i) => i.entityType },
    { header: "title", value: (i) => i.title },
    { header: "system", value: (i) => i.systemName },
    { header: "subtitle", value: (i) => i.subtitle },
    { header: "status", value: status },
    { header: "note", value: (i) => i.note },
    { header: "tags", value: (i) => i.tags },
    { header: "official_source_url", value: (i) => i.sourceUrl },
    { header: "atlas_url", value: (i) => abs(origin, i.url) },
    { header: "added_at", value: (i) => i.addedAt },
  ];
  return csvResponse(toCsv(c.items, cols, exportMetaLines(meta)), filename, cache);
}
