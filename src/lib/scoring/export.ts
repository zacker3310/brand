/**
 * Plain-text projections of comparison cells and rubric results for JSON/CSV exports. Pure.
 */
import type { CoverageState } from "@/lib/contracts";
import { RUBRIC_DEFINITIONS } from "./definitions";
import type { CellValue, ComparisonColumn, ComponentMatrix, CompareTypeInfo, CriterionId, RubricResult } from "./types";

export const COVERAGE_TEXT: Record<CoverageState, string> = {
  documented: "documented",
  "documented-none": "documented as none (absent capability)",
  "not-documented": "not documented (absent documentation)",
  "not-extracted": "not extracted (unknown)",
  inferred: "inferred by ATLAS",
};

export const COMPARISON_DISCLAIMER =
  "Component names, documentation and trademarks belong to their respective owners. ATLAS stores short excerpts and links to official sources; verify facts there. Cross-system alignment (props, states, keys) is inferred by ATLAS.";

export function cellText(v: CellValue): string {
  switch (v.kind) {
    case "coverage":
      return `[${COVERAGE_TEXT[v.state]}]`;
    case "text":
      return v.text + (v.inferred ? " (inferred)" : "");
    case "description":
      return v.text + (v.href ? ` (${v.href})` : "");
    case "link":
      return `${v.label} (${v.href})`;
    case "chips":
      return v.items.map((i) => i.label).join("; ") + (v.inferred ? " (inferred)" : "");
    case "classification":
      return `${v.typeName}: ${v.state}${v.method ? `, ${v.method}` : ""}, confidence ${Math.round(v.confidence * 100)}%`;
    case "props":
      return v.entries
        .map((e) => `${e.implementation}: ${e.name}${e.type ? ` ${e.type}` : ""}${e.defaultValue ? ` = ${e.defaultValue}` : ""}${e.required ? " (required)" : ""}${e.deprecated ? " (deprecated)" : ""}`)
        .join("; ");
    case "keyboard":
      return v.entries.map((e) => `${e.keys}: ${e.action}`).join(" | ");
    case "tokens":
      return `${v.total} tokens: ${v.shown.map((t) => `${t.name}${t.valueText ? `=${t.valueText}` : ""}`).join("; ")}${v.total > v.shown.length ? `; +${v.total - v.shown.length} more` : ""}`;
    case "links":
      return (v.meta ? `${v.meta}: ` : "") + v.links.map((l) => l.href).join(" ");
    case "count":
      return `${v.value}${v.detail ? ` (${v.detail})` : ""}`;
  }
}

/** Machine-readable cell: coverage state is kept separate from the value. */
export function cellJson(v: CellValue): { coverage: CoverageState | null; value: string | null } {
  return v.kind === "coverage" ? { coverage: v.state, value: null } : { coverage: null, value: cellText(v) };
}

export interface ComparisonExportOptions {
  url: string;
  generatedAt: string;
}

export function componentComparisonJson(type: CompareTypeInfo, columns: ComparisonColumn[], matrix: ComponentMatrix, opts: ComparisonExportOptions) {
  return {
    atlas: {
      generator: "ATLAS",
      kind: "component-comparison",
      formatVersion: "1",
      generatedAt: opts.generatedAt,
      url: opts.url,
      disclaimer: COMPARISON_DISCLAIMER,
    },
    componentType: { slug: type.slug, name: type.name, description: type.description, ariaPattern: type.ariaPattern, note: "Canonical type and description are ATLAS-authored." },
    systems: columns.map((c) => ({
      slug: c.system.slug,
      name: c.system.name,
      docsUrl: c.system.docsUrl,
      component: c.component
        ? {
            slug: c.component.slug,
            name: c.component.name,
            docsUrl: c.component.docsUrl,
            sourceCodeUrl: c.component.sourceCodeUrl,
            accessibilityDocsUrl: c.component.accessibility?.docsUrl ?? null,
            classification: c.component.classification,
            evidence: c.component.evidence,
          }
        : null,
      missing: c.missing,
      otherCandidates: c.candidates.filter((x) => x.id !== c.component?.id).map((x) => x.slug),
    })),
    groups: matrix.groups.map((g) => ({
      id: g.id,
      title: g.title,
      note: g.note ?? null,
      rows: g.rows.map((r) => ({
        id: r.id,
        label: r.label,
        alignment: r.alignment ? `aligned by ${r.alignment.method} name (inferred)` : null,
        same: r.same,
        ...(r.span ? { all: cellJson(r.span) } : { cells: Object.fromEntries(Object.entries(r.cells).map(([s, c]) => [s, cellJson(c.value)])) }),
      })),
    })),
  };
}

/** Rows for CSV: group, attribute, alignment, then one column per system. */
export function componentComparisonRows(columns: ComparisonColumn[], matrix: ComponentMatrix): string[][] {
  const out: string[][] = [];
  for (const g of matrix.groups) {
    for (const r of g.rows) {
      const align = r.alignment ? `aligned by ${r.alignment.method} name (inferred)` : "";
      out.push([g.title, r.label, align, ...columns.map((c) => (r.span ? cellText(r.span) : r.cells[c.system.slug] ? cellText(r.cells[c.system.slug]!.value) : ""))]);
    }
  }
  out.push(["Sources", "Component docs", "", ...columns.map((c) => c.component?.docsUrl ?? c.system.docsUrl ?? "")]);
  return out;
}

export function systemComparisonJson(
  systems: { slug: string; name: string; docsUrl: string | null; homepageUrl: string | null; ingestionStatus: string }[],
  results: Record<string, RubricResult[]>,
  criteria: CriterionId[],
  opts: ComparisonExportOptions,
) {
  return {
    atlas: { generator: "ATLAS", kind: "system-comparison", formatVersion: "1", generatedAt: opts.generatedAt, url: opts.url, disclaimer: COMPARISON_DISCLAIMER },
    criteria: criteria.map((c) => ({ id: c, label: RUBRIC_DEFINITIONS[c].label, method: RUBRIC_DEFINITIONS[c].method, caveats: RUBRIC_DEFINITIONS[c].caveats })),
    systems: systems.map((s) => ({
      ...s,
      scores: (results[s.slug] ?? []).map((r) => ({
        criterion: r.criterion,
        score: r.score,
        status: r.status,
        confidence: r.confidence,
        evidenceCoverage: r.evidenceCoverage,
        explanation: r.explanation,
        caps: r.caps,
        inputs: r.inputs.map((i) => ({ key: i.key, label: i.label, display: i.display, known: i.value !== null, weight: i.weight, source: i.source })),
      })),
    })),
  };
}

export function systemComparisonRows(systems: { slug: string; name: string }[], results: Record<string, RubricResult[]>, criteria: CriterionId[]): string[][] {
  const out: string[][] = [];
  for (const c of criteria) {
    for (const s of systems) {
      const r = results[s.slug]?.find((x) => x.criterion === c);
      if (!r) continue;
      out.push([RUBRIC_DEFINITIONS[c].label, s.name, r.score === null ? "" : String(r.score), r.status, r.confidence, String(Math.round(r.evidenceCoverage * 100)), r.explanation]);
    }
  }
  return out;
}
