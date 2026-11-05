import { COVERAGE_META } from "@/components/atlas";
import { COMPONENT_FIELDS, type CoverageMap, type CoverageState } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { coverageCounts, coverageSummaryText, FIELD_LABELS, fieldState } from "./lib/coverage";

export const STRIP_CELL: Record<CoverageState, string> = {
  documented: "bg-verified",
  "documented-none": "bg-foreground/45",
  inferred: "bg-inferred",
  "not-documented": "border border-dashed border-unavailable/70 bg-transparent",
  "not-extracted": "hatch border border-border bg-transparent",
};

/**
 * Twelve cells, one per COMPONENT_FIELD, in a fixed order so rows can be scanned vertically.
 * Exposed to assistive tech as a single image with a text summary (not 12 tab stops).
 */
export function CoverageStrip({ coverage, className, showCount = true }: { coverage: CoverageMap; className?: string; showCount?: boolean }) {
  const counts = coverageCounts(coverage);
  const summary = coverageSummaryText(coverage);
  const title = COMPONENT_FIELDS.map((f) => `${FIELD_LABELS[f]}: ${COVERAGE_META[fieldState(coverage, f)].label}`).join("\n");
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span role="img" aria-label={`Coverage: ${summary}`} title={title} className="inline-flex gap-[3px]">
        {COMPONENT_FIELDS.map((f) => (
          <span key={f} className={cn("h-3 w-1.5 rounded-[1.5px]", STRIP_CELL[fieldState(coverage, f)])} />
        ))}
      </span>
      {showCount && (
        <span className="tabular font-mono text-[11px] text-muted-foreground" aria-hidden>
          {counts.documented + counts["documented-none"]}/{COMPONENT_FIELDS.length}
        </span>
      )}
    </span>
  );
}

export function CoverageStripLegend({ className }: { className?: string }) {
  const order: CoverageState[] = ["documented", "documented-none", "inferred", "not-documented", "not-extracted"];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground", className)}>
      <span className="font-medium text-foreground/80">Coverage, 12 fields:</span>
      {order.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("h-3 w-1.5 rounded-[1.5px]", STRIP_CELL[s])} />
          {COVERAGE_META[s].label}
        </span>
      ))}
    </div>
  );
}
