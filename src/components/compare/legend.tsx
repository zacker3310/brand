import { COVERAGE_META, CoverageChip } from "@/components/atlas/coverage-chip";
import { VerificationBadge } from "@/components/atlas/verification-badge";
import type { CoverageState } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { INFERRED_TEXT } from "./tone";

const ORDER: CoverageState[] = ["documented", "documented-none", "not-documented", "not-extracted", "inferred"];

const SHORT: Record<CoverageState, string> = {
  documented: "Value from the official source",
  "documented-none": "Source says it doesn't exist (absent capability)",
  "not-documented": "Source is silent (absent documentation)",
  "not-extracted": "ATLAS hasn't extracted it (unknown)",
  inferred: "Derived by ATLAS heuristics",
};

/** Legend for every state a comparison cell can show. */
export function CoverageLegend({ showAlignment = true }: { showAlignment?: boolean }) {
  return (
    <section aria-label="Legend" className="rounded-lg border bg-surface-1/50 px-4 py-3">
      <h2 className="type-eyebrow text-muted-foreground mb-2.5">Legend</h2>
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
        {ORDER.map((s) => (
          <li key={s} className="flex items-start gap-2 text-xs text-muted-foreground">
            <CoverageChip state={s} className={cn("shrink-0", s === "inferred" && INFERRED_TEXT)} />
            <span className="pt-px" title={COVERAGE_META[s].description}>
              {SHORT[s]}
            </span>
          </li>
        ))}
        <li className="flex items-start gap-2 text-xs text-muted-foreground">
          <VerificationBadge state="verified" className="shrink-0" />
          <span className="pt-px">Classification declared by the source</span>
        </li>
        {showAlignment && (
          <li className="flex items-start gap-2 text-xs text-muted-foreground">
            <span className={cn("shrink-0 rounded border border-inferred/30 bg-inferred-soft px-1.5 py-0.5 text-[11px] leading-none font-medium", INFERRED_TEXT)}>aligned by name</span>
            <span className="pt-px">Rows matched across systems by ATLAS (inferred)</span>
          </li>
        )}
      </ul>
    </section>
  );
}
