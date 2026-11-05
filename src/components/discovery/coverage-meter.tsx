import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { IngestionStatus } from "@/lib/contracts";
import { cn, formatCount } from "@/lib/utils";
import { depthOf } from "./lib/directory";
import { compactCount } from "./lib/format";

export interface CoverageCounts {
  components: number;
  tokens: number;
  patterns: number;
}

const ROWS: { key: keyof CoverageCounts; label: string }[] = [
  { key: "components", label: "Components" },
  { key: "tokens", label: "Tokens" },
  { key: "patterns", label: "Patterns" },
];

/**
 * Per-system indexed record counts. Bars are log-scaled against the library maximum so systems are
 * comparable at a glance; exact counts are always in text. Zero on an indexed system means "none
 * indexed" (the adapter may not cover that record kind), never "the system has none".
 */
export function CoverageMeter({
  counts,
  max,
  status,
  className,
  layout = "stack",
}: {
  counts: CoverageCounts;
  max: CoverageCounts;
  status: IngestionStatus;
  className?: string;
  layout?: "stack" | "inline";
}) {
  const depth = depthOf(status);
  const total = counts.components + counts.tokens + counts.patterns;
  if (depth === "metadata" && total === 0) return <MetadataOnly className={className} />;
  return (
    <dl className={cn(layout === "stack" ? "grid gap-1.5" : "grid grid-cols-3 gap-3", className)}>
      {ROWS.map(({ key, label }) => {
        const n = counts[key];
        const m = Math.max(max[key], 1);
        const pct = n > 0 ? Math.max(6, Math.round((Math.log1p(n) / Math.log1p(m)) * 100)) : 0;
        return (
          <div key={key} className={cn(layout === "stack" ? "grid grid-cols-[5.5rem_minmax(0,1fr)_3rem] items-center gap-2" : "space-y-1")}>
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className={cn(layout === "inline" && "order-first")}>
              {layout === "inline" ? (
                <span className="tabular text-sm font-medium">{n > 0 ? formatCount(n) : <NoneIndexed />}</span>
              ) : (
                <span className={cn("block h-1 overflow-hidden rounded-full bg-muted", n === 0 && "hatch")} aria-hidden>
                  <span className="block h-full rounded-full bg-primary/70 transition-[width] duration-500" style={{ width: `${pct}%` }} />
                </span>
              )}
            </dd>
            {layout === "stack" && (
              <dd className="tabular text-right text-xs font-medium" title={n > 0 ? formatCount(n) : undefined}>
                {n > 0 ? compactCount(n) : <NoneIndexed />}
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}

function NoneIndexed() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="relative z-10 cursor-help text-muted-foreground">
          —<span className="sr-only">none indexed</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">None indexed. The adapter has not extracted this record kind; this does not mean the system has none.</TooltipContent>
    </Tooltip>
  );
}

export function MetadataOnly({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "hatch relative z-10 flex cursor-help items-center justify-center rounded-md border border-dashed border-border text-[11px] font-medium text-muted-foreground",
            compact ? "px-2 py-1" : "h-[3.25rem] px-3",
            className,
          )}
        >
          Metadata only
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <p className="font-medium">Not deeply indexed yet</p>
        <p className="opacity-80">
          Registry facts (links, license, frameworks, maintenance) are verified. Components, tokens and patterns have not been extracted, so their counts are unknown, not zero.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
