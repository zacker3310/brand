import { CircleDashedIcon } from "lucide-react";
import { CoverageChip, VERIFICATION_META, VerificationBadge } from "@/components/atlas";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { VerificationState } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { describeClassificationMethod, LIFECYCLE_META } from "./lib/format";

/**
 * Canonical-type classification state. "Verified" means the source declares the pattern;
 * "Inferred" means ATLAS matched the name heuristically. The method is always one hover/focus away.
 */
export function ClassificationBadge({
  state,
  method,
  classified = true,
  compact = false,
  className,
}: {
  state: VerificationState;
  method: string | null;
  classified?: boolean;
  compact?: boolean;
  className?: string;
}) {
  if (!classified) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-dashed border-unavailable/50 px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap text-unavailable",
              className,
            )}
          >
            <CircleDashedIcon className="size-3" aria-hidden />
            {compact ? <span className="sr-only">Unclassified</span> : "Unclassified"}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          <p className="font-medium">Unclassified</p>
          <p className="opacity-80">ATLAS could not map this component to a canonical type with any confidence. It is not hidden or guessed.</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  const how = describeClassificationMethod(method);
  const detail = `${VERIFICATION_META[state].label} classification. ${
    state === "verified" ? "The official source identifies the pattern." : state === "inferred" ? "ATLAS heuristic, not a claim made by the source." : ""
  }${how ? ` ${how}` : ""}`;
  return <VerificationBadge state={state} detail={detail} compact={compact} className={className} />;
}

const TONE: Record<string, string> = {
  neutral: "border-border text-muted-foreground",
  info: "border-info/30 bg-info-soft text-info",
  warn: "border-conflicting/30 bg-conflicting-soft text-conflicting",
  muted: "border-border text-muted-foreground",
};

/** Lifecycle as documented by the source. "unknown" is shown as not extracted, never as stable. */
export function LifecycleBadge({
  lifecycle,
  hideStable = false,
  dense = false,
  className,
}: {
  lifecycle: string;
  hideStable?: boolean;
  /** Dense lists only flag noteworthy states (beta, experimental, deprecated); detail pages show everything. */
  dense?: boolean;
  className?: string;
}) {
  const meta = LIFECYCLE_META[lifecycle];
  if (!meta) return dense ? null : <CoverageChip state="not-extracted" label="Lifecycle" className={className} />;
  if ((hideStable || dense) && lifecycle === "stable") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none font-medium tracking-wide uppercase whitespace-nowrap",
        TONE[meta.tone],
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
