import Link from "next/link";
import { SystemMark } from "@/components/atlas/system-mark";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RUBRIC_DEFINITIONS } from "@/lib/scoring/definitions";
import type { Confidence, CriterionId, RubricResult } from "@/lib/scoring/types";
import { cn } from "@/lib/utils";

export interface ScoredSystem {
  slug: string;
  name: string;
  ingestionStatus: string;
  results: RubricResult[];
}

const CONF_LEVEL: Record<Confidence, number> = { insufficient: 0, low: 1, medium: 2, high: 3 };
const CONF_LABEL: Record<Confidence, string> = { insufficient: "Insufficient", low: "Low", medium: "Medium", high: "High" };

export const isIndexedStatus = (s: string) => s === "indexed" || s === "partial";

export function ConfidenceMeter({ confidence, className }: { confidence: Confidence; className?: string }) {
  const level = CONF_LEVEL[confidence];
  return (
    <span className={cn("inline-flex items-end gap-[2px]", className)} aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cn("w-[3px] rounded-[1px]", i === 1 ? "h-1.5" : i === 2 ? "h-2" : "h-2.5", i <= level ? "bg-foreground/70" : "bg-border")} />
      ))}
    </span>
  );
}

export function ScoreValue({ r, size = "md" }: { r: RubricResult; size?: "md" | "lg" }) {
  if (r.score === null) {
    const notIndexed = r.status === "not-indexed";
    return (
      <span className={cn("inline-flex items-center rounded border border-dashed px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap", notIndexed ? "text-unavailable" : "hatch text-muted-foreground")}>
        {notIndexed ? "Not indexed" : "Insufficient data"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-baseline gap-0.5">
      <span className={cn("tabular font-semibold tracking-tight", size === "lg" ? "text-2xl" : "text-xl")}>{r.score}</span>
      <span className="text-[11px] text-subtle-foreground">/100</span>
    </span>
  );
}

export function ScoreBar({ score }: { score: number | null }) {
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      {score !== null && <span className="block h-full rounded-full bg-primary/80 transition-[width] duration-500" style={{ width: `${score}%` }} />}
    </span>
  );
}

export function ConfidenceLine({ r }: { r: RubricResult }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <ConfidenceMeter confidence={r.confidence} />
      <span>
        {r.score === null ? "" : `${CONF_LABEL[r.confidence]} confidence · `}
        <span className="tabular">{Math.round(r.evidenceCoverage * 100)}%</span> evidence
      </span>
    </span>
  );
}

function ScoreCell({ r, system }: { r: RubricResult; system: string }) {
  const label =
    r.score === null
      ? `${r.status === "not-indexed" ? "Not indexed" : "Insufficient data"}. ${Math.round(r.evidenceCoverage * 100)}% evidence coverage.`
      : `${r.score} of 100, ${CONF_LABEL[r.confidence].toLowerCase()} confidence, ${Math.round(r.evidenceCoverage * 100)}% evidence coverage.`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={`#${r.criterion}-${system}`}
          className={cn(
            "block space-y-1.5 rounded-md p-2 transition-colors hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none",
            r.score === null && "opacity-90",
          )}
          aria-label={`${RUBRIC_DEFINITIONS[r.criterion].label}: ${label} Show evidence.`}
        >
          <ScoreValue r={r} />
          <ScoreBar score={r.score} />
          <ConfidenceLine r={r} />
        </Link>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{r.explanation}</TooltipContent>
    </Tooltip>
  );
}

export function IngestionTag({ status }: { status: string }) {
  const indexed = isIndexedStatus(status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] leading-none font-medium whitespace-nowrap",
        indexed ? "border-verified/30 bg-verified-soft text-verified" : "border-dashed border-unavailable/50 text-unavailable",
      )}
    >
      {indexed ? (status === "partial" ? "Partially indexed" : "Indexed") : "Metadata only"}
    </span>
  );
}

/** Criteria x systems matrix. Scrolls inside its own container on small screens (sticky first column). */
export function Scorecard({ systems, criteria }: { systems: ScoredSystem[]; criteria: CriterionId[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card" role="region" aria-label="Scorecard" tabIndex={0}>
      <table className="w-full min-w-[36rem] border-separate border-spacing-0 text-left">
        <caption className="sr-only">Scores per criterion (rows) for each system (columns). Select a score for its evidence.</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-40 border-b bg-card px-3 py-3 align-bottom sm:w-56">
              <span className="type-eyebrow">Criterion</span>
            </th>
            {systems.map((s) => (
              <th key={s.slug} scope="col" className="min-w-32 border-b border-l border-l-border/60 px-3 py-3 align-top font-normal">
                <div className="flex items-start gap-2">
                  <SystemMark name={s.name} slug={s.slug} size="sm" />
                  <div className="min-w-0 space-y-1">
                    <Link href={`/systems/${s.slug}`} className="block text-sm leading-tight font-semibold hover:underline">
                      {s.name}
                    </Link>
                    <IngestionTag status={s.ingestionStatus} />
                  </div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {criteria.map((c) => {
            const d = RUBRIC_DEFINITIONS[c];
            return (
              <tr key={c} className="group">
                <th scope="row" className="sticky left-0 z-10 border-t bg-card px-3 py-2.5 align-top font-normal group-first:border-t-0">
                  <Link href={`#${c}`} className="block text-sm leading-tight font-medium hover:underline">
                    {d.label}
                  </Link>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{d.short}</span>
                </th>
                {systems.map((s) => {
                  const r = s.results.find((x) => x.criterion === c);
                  return (
                    <td key={s.slug} className="border-t border-l border-l-border/60 px-1.5 py-1 align-top group-first:border-t-0">
                      {r && <ScoreCell r={r} system={s.slug} />}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
