import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CoverageState } from "@/lib/contracts";
import { cn } from "@/lib/utils";

/**
 * Coverage communicates WHY a field is empty. The distinction is the core honesty contract:
 *   documented-none  = the source says the capability doesn't exist (absent capability)
 *   not-documented   = the source doesn't document it (absent documentation, NOT absent capability)
 *   not-extracted    = ATLAS hasn't parsed it (unknown)
 */
export const COVERAGE_META: Record<CoverageState, { label: string; short: string; description: string; className: string }> = {
  documented: {
    label: "Documented",
    short: "Documented",
    description: "The official source documents this. Values shown are extracted from it.",
    className: "border-verified/30 bg-verified-soft text-verified",
  },
  "documented-none": {
    label: "Documented as none",
    short: "None (documented)",
    description: "The official source explicitly states this does not exist or is not supported. This is an absent capability.",
    className: "border-border bg-muted text-foreground",
  },
  "not-documented": {
    label: "Not documented",
    short: "Not documented",
    description: "ATLAS checked the official source and it does not document this. Absent documentation is not evidence of an absent capability.",
    className: "border-dashed border-unavailable/50 bg-transparent text-unavailable",
  },
  "not-extracted": {
    label: "Not extracted",
    short: "Not extracted",
    description: "ATLAS has not extracted this field for this record yet. Unknown, not empty.",
    className: "hatch border-dashed border-border text-muted-foreground",
  },
  inferred: {
    label: "Inferred",
    short: "Inferred",
    description: "Derived heuristically by ATLAS rather than stated by the source.",
    className: "border-inferred/30 bg-inferred-soft text-inferred",
  },
};

export function CoverageChip({
  state,
  className,
  label,
  note,
  focusable = true,
}: {
  state: CoverageState | undefined | null;
  className?: string;
  label?: string;
  /** Extra context shown in the tooltip (e.g. "system not deeply indexed"). */
  note?: string;
  /**
   * Dense tables: set false to avoid one tab stop per cell. The explanation is then exposed as
   * accessible text (title + sr-only) instead of a focus-triggered tooltip.
   */
  focusable?: boolean;
}) {
  const s: CoverageState = state ?? "not-extracted";
  const meta = COVERAGE_META[s];
  if (!focusable) {
    return (
      <span
        title={`${meta.label}: ${meta.description}${note ? ` ${note}` : ""}`}
        className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap", meta.className, className)}
      >
        {label ? `${label}: ` : ""}
        {meta.short}
        <span className="sr-only">. {meta.description}</span>
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap", meta.className, className)}
        >
          {label ? `${label}: ` : ""}
          {meta.short}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <p className="font-medium">{meta.label}</p>
        <p className="opacity-80">{meta.description}</p>
        {note && <p className="mt-1 opacity-80">{note}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Placeholder for an empty field that explains why it's empty. */
export function MissingValue({ state, className }: { state: CoverageState | undefined | null; className?: string }) {
  const s: CoverageState = state ?? "not-extracted";
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <CoverageChip state={s} />
    </span>
  );
}
