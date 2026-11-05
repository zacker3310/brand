import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type AliasStateName = "literal" | "resolved" | "theme-dependent" | "external" | "unresolved" | "cycle";

export const ALIAS_STATE_META: Record<AliasStateName, { label: string; short: string; description: string; className: string; bar: string }> = {
  literal: {
    label: "Literal",
    short: "Literal",
    description: "The source assigns a concrete value directly; nothing to resolve.",
    className: "border-border bg-muted text-foreground/80",
    bar: "bg-foreground/25",
  },
  resolved: {
    label: "Resolved",
    short: "Resolved",
    description: "An alias that ATLAS followed to a concrete value inside the indexed sets.",
    className: "border-verified/30 bg-verified-soft text-[color:color-mix(in_oklch,var(--verified)_70%,var(--foreground))]",
    bar: "bg-verified",
  },
  "theme-dependent": {
    label: "Theme-dependent",
    short: "Per theme",
    description: "An alias whose target exists only in themed sets, so it resolves to a different value per theme.",
    className: "border-info/30 bg-info-soft text-info",
    bar: "bg-info",
  },
  external: {
    label: "External",
    short: "External",
    description: "Points outside the token files ATLAS indexed (another package or file). The target value is not shown.",
    className: "border-dashed border-unavailable/50 text-[color:color-mix(in_oklch,var(--unavailable)_70%,var(--foreground))]",
    bar: "bg-unavailable",
  },
  unresolved: {
    label: "Unresolved",
    short: "Unresolved",
    description: "References a token ATLAS could not find. No value is shown rather than a guess.",
    className: "border-inferred/30 bg-inferred-soft text-[color:color-mix(in_oklch,var(--inferred)_70%,var(--foreground))]",
    bar: "bg-inferred",
  },
  cycle: {
    label: "Cycle",
    short: "Cycle",
    description: "Part of a reference loop, so it has no concrete value.",
    className: "border-conflicting/30 bg-conflicting-soft text-[color:color-mix(in_oklch,var(--conflicting)_70%,var(--foreground))]",
    bar: "bg-conflicting",
  },
};

export function aliasStateName(s: string | null | undefined): AliasStateName {
  if (!s || s === "literal") return "literal";
  return (s in ALIAS_STATE_META ? s : "unresolved") as AliasStateName;
}

export function AliasStateBadge({
  state,
  compact = false,
  className,
  tooltip = true,
}: {
  state: string | null | undefined;
  compact?: boolean;
  className?: string;
  /** false in dense lists: no tab stop, native title instead. */
  tooltip?: boolean;
}) {
  const name = aliasStateName(state);
  const meta = ALIAS_STATE_META[name];
  const cls = cn("inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap", meta.className, className);
  if (!tooltip) {
    return (
      <span className={cls} title={meta.description}>
        {compact ? meta.short : meta.label}
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn("inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap", meta.className, className)}
        >
          {compact ? meta.short : meta.label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <p className="font-medium">{meta.label}</p>
        <p className="opacity-80">{meta.description}</p>
      </TooltipContent>
    </Tooltip>
  );
}
