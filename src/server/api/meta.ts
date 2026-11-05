/**
 * Metadata attached to every ATLAS export (systems, components, collections).
 * Exports are reference lists: names, ATLAS-authored summaries and links to official sources.
 */

export const EXPORT_DISCLAIMER =
  "Names, trademarks and documentation belong to their owners; this export is a reference list, not a license grant.";

export const EXPORT_FORMAT_VERSION = "1";

export interface ExportMeta {
  generator: "ATLAS";
  formatVersion: string;
  dataset: string;
  generatedAt: string;
  recordCount: number;
  source: string;
  disclaimer: string;
  notes: string[];
}

export function exportMeta(dataset: string, recordCount: number, notes: string[] = [], now = new Date()): ExportMeta {
  return {
    generator: "ATLAS",
    formatVersion: EXPORT_FORMAT_VERSION,
    dataset,
    generatedAt: now.toISOString(),
    recordCount,
    source: "ATLAS design system index. Every record links to its official source; verify facts there before relying on them.",
    disclaimer: EXPORT_DISCLAIMER,
    notes,
  };
}

/** The same metadata as CSV comment lines. */
export function exportMetaLines(m: ExportMeta): string[] {
  return [
    `ATLAS export: ${m.dataset} (format v${m.formatVersion})`,
    `generated_at: ${m.generatedAt}`,
    `records: ${m.recordCount}`,
    `source: ${m.source}`,
    `disclaimer: ${m.disclaimer}`,
    ...m.notes.map((n) => `note: ${n}`),
  ];
}
