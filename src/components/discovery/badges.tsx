import { ArchiveIcon, CircleDotIcon, CircleSlashIcon, DatabaseIcon, LayersIcon, WrenchIcon, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { IngestionStatus, MaintenanceStatus, Redistribution } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { DEPTH_DESCRIPTIONS, DEPTH_LABELS, MAINTENANCE_LABELS, depthOf, type Depth } from "./lib/directory";

/**
 * Light-mode --inferred (oklch 0.58) on --inferred-soft measures 3.9:1, below WCAG AA for 11px text.
 * Until the token is darkened (requested), discovery surfaces use this AA-safe override (5.5:1).
 */
export const INFERRED_TEXT = "text-[oklch(0.5_0.11_65)]! dark:text-inferred!";

const MAINTENANCE_META: Record<MaintenanceStatus, { icon: LucideIcon; className: string; description: string }> = {
  active: {
    icon: CircleDotIcon,
    className: "border-verified/25 text-verified",
    description: "Recent releases or commits were verified against official package or repository metadata.",
  },
  maintenance: {
    icon: WrenchIcon,
    className: `border-inferred/30 ${INFERRED_TEXT}`,
    description: "Receives fixes but no major development, per official sources.",
  },
  deprecated: {
    icon: CircleSlashIcon,
    className: "border-conflicting/35 bg-conflicting-soft text-conflicting",
    description: "Officially deprecated. Prefer the recommended successor for new work.",
  },
  archived: {
    icon: ArchiveIcon,
    className: "border-conflicting/35 bg-conflicting-soft text-conflicting",
    description: "The official repository or site is archived; no further releases are expected.",
  },
  unknown: {
    icon: CircleDotIcon,
    className: "border-dashed border-border text-muted-foreground",
    description: "ATLAS could not establish maintenance status from official sources.",
  },
};

/** Maintenance status. Archived/deprecated are visually distinct (the only red in a card). */
export function MaintenanceBadge({ status, hideActive = false, className }: { status: MaintenanceStatus; hideActive?: boolean; className?: string }) {
  if (hideActive && status === "active") return null;
  const meta = MAINTENANCE_META[status];
  const Icon = meta.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap",
            meta.className,
            className,
          )}
        >
          <Icon className="size-3" aria-hidden />
          {MAINTENANCE_LABELS[status]}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <p className="font-medium">Maintenance: {MAINTENANCE_LABELS[status]}</p>
        <p className="opacity-80">{meta.description}</p>
      </TooltipContent>
    </Tooltip>
  );
}

const DEPTH_ICON: Record<Depth, LucideIcon> = { indexed: LayersIcon, partial: LayersIcon, metadata: DatabaseIcon };

export function DepthBadge({ status, className }: { status: IngestionStatus; className?: string }) {
  const depth = depthOf(status);
  const Icon = DEPTH_ICON[depth];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap",
            depth === "indexed" && "border-info/30 bg-info-soft text-info",
            depth === "partial" && "border-info/30 border-dashed text-info",
            depth === "metadata" && "border-dashed border-border text-muted-foreground",
            className,
          )}
        >
          <Icon className="size-3" aria-hidden />
          {DEPTH_LABELS[depth]}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <p className="font-medium">{DEPTH_LABELS[depth]}</p>
        <p className="opacity-80">{DEPTH_DESCRIPTIONS[depth]}</p>
        {status !== "indexed" && status !== "partial" && status !== "metadata_only" && (
          <p className="mt-1 font-mono opacity-70">ingestion status: {status.replace(/_/g, " ")}</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

const REDISTRIBUTION_META: Record<Redistribution, { label: string; description: string }> = {
  permitted: { label: "Redistribution permitted", description: "The license permits ATLAS to store short excerpts and code examples with attribution." },
  conditional: { label: "Redistribution conditional", description: "Redistribution is allowed under conditions (attribution, notices, field-of-use). ATLAS stores facts and links, with excerpts kept minimal." },
  restricted: { label: "Redistribution restricted", description: "Proprietary or restrictive terms. ATLAS stores facts and links only, never code." },
  unknown: { label: "Redistribution unknown", description: "Terms not established; ATLAS treats content as link-only." },
};

export function RedistributionNote({ value, className }: { value: Redistribution; className?: string }) {
  const meta = REDISTRIBUTION_META[value];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn("cursor-help text-xs text-muted-foreground underline decoration-dotted underline-offset-2", className)}>
          {meta.label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{meta.description}</TooltipContent>
    </Tooltip>
  );
}

/** Small neutral chip (frameworks, platforms, tags). */
export function Chip({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center rounded-md border border-border/80 bg-surface-1 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground", className)}>
      {children}
    </span>
  );
}
