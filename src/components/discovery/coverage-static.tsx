import { COVERAGE_META, VERIFICATION_META } from "@/components/atlas";
import type { CoverageState, VerificationState } from "@/lib/contracts";
import { cn } from "@/lib/utils";

/**
 * Non-interactive twins of the kit's CoverageChip / VerificationBadge for dense lists (component
 * rows, directory cards). Same visual language; the explanation lives in one visible legend per
 * section (CoverageLegend) plus a native title, instead of hundreds of focusable tooltips.
 */
export function StaticCoverageChip({ state, className, label }: { state: CoverageState | null | undefined; className?: string; label?: string }) {
  const s: CoverageState = state ?? "not-extracted";
  const meta = COVERAGE_META[s];
  return (
    <span
      title={`${meta.label}: ${meta.description}`}
      className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap", meta.className, className)}
    >
      {label ? `${label}: ` : ""}
      {meta.short}
    </span>
  );
}

export function StaticVerificationBadge({ state, className, title, children }: { state: VerificationState; className?: string; title?: string; children?: React.ReactNode }) {
  const meta = VERIFICATION_META[state];
  const Icon = meta.icon;
  return (
    <span
      title={title ?? meta.description}
      className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap", meta.className, className)}
    >
      <Icon className="size-3" aria-hidden />
      {children ?? meta.label}
    </span>
  );
}

const LEGEND: { state: CoverageState; text: string }[] = [
  { state: "documented", text: "values extracted from the official source" },
  { state: "documented-none", text: "the source says it doesn't exist" },
  { state: "not-documented", text: "checked; the source doesn't cover it" },
  { state: "not-extracted", text: "not parsed yet; unknown, not empty" },
];

/** One visible key for the coverage chips in a section. */
export function CoverageLegend({ states, className }: { states?: CoverageState[]; className?: string }) {
  const items = states ? LEGEND.filter((l) => states.includes(l.state)) : LEGEND;
  if (!items.length) return null;
  return (
    <dl className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground", className)} aria-label="Coverage key">
      {items.map((l) => (
        <div key={l.state} className="flex items-center gap-1.5">
          <dt>
            <StaticCoverageChip state={l.state} />
          </dt>
          <dd>{l.text}</dd>
        </div>
      ))}
    </dl>
  );
}
