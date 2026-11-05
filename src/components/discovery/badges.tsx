import { ArchiveIcon, CircleDotIcon, CircleSlashIcon, DatabaseIcon, LayersIcon, ListIcon, WrenchIcon, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { IngestionStatus, MaintenanceStatus, Redistribution } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { DEPTH_DESCRIPTIONS, DEPTH_LABELS, MAINTENANCE_LABELS, depthOf, type Depth } from "./lib/directory";

/**
 * Light-mode --inferred (oklch 0.58) on --inferred-soft measures 3.9:1, below WCAG AA for 11px text.
 * Until the token is darkened (requested), discovery surfaces use this AA-safe override (5.5:1).
 */
/** Former contrast override; tokens in globals.css now meet WCAG AA, so this is a no-op kept for call sites. */
export const INFERRED_TEXT = "";

/** Same for --conflicting on --conflicting-soft at 11px (axe measures it below 4.5:1 in light mode). */
export const CONFLICTING_TEXT = "text-[oklch(0.48_0.17_25)]! dark:text-conflicting!";

/**
 * Container-level fix for the kit's light-mode status text colors (inferred 3.9:1, unavailable 4.4:1,
 * conflicting 4.5:1 on their soft backgrounds at 11px). Applied to discovery page roots so kit
 * components rendered inside (VerificationBadge, CoverageChip, EvidenceList) meet WCAG AA too.
 * Dark mode keeps the original tokens (they pass). Remove once the tokens are darkened (requested).
 */
export const STATUS_CONTRAST_FIX =
  "[&_.text-inferred]:text-[oklch(0.5_0.11_65)] [&_.text-unavailable]:text-[oklch(0.47_0.012_260)] [&_.text-conflicting]:text-[oklch(0.48_0.17_25)] dark:[&_.text-inferred]:text-inferred dark:[&_.text-unavailable]:text-unavailable dark:[&_.text-conflicting]:text-conflicting";

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
    className: `border-conflicting/35 bg-conflicting-soft ${CONFLICTING_TEXT}`,
    description: "Officially deprecated. Prefer the recommended successor for new work.",
  },
  archived: {
    icon: ArchiveIcon,
    className: `border-conflicting/35 bg-conflicting-soft ${CONFLICTING_TEXT}`,
    description: "The official repository or site is archived; no further releases are expected.",
  },
  unknown: {
    icon: CircleDotIcon,
    className: "border-dashed border-border text-muted-foreground",
    description: "ATLAS could not establish maintenance status from official sources.",
  },
};

/** Maintenance status. Archived/deprecated are visually distinct (the only red in a card). */
export function MaintenanceBadge({
  status,
  hideActive = false,
  interactive = true,
  className,
}: {
  status: MaintenanceStatus;
  hideActive?: boolean;
  /** false: static label with a native title (dense lists); true: focusable tooltip. */
  interactive?: boolean;
  className?: string;
}) {
  if (hideActive && status === "active") return null;
  const meta = MAINTENANCE_META[status];
  const Icon = meta.icon;
  const cls = cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap", meta.className, className);
  if (!interactive) {
    return (
      <span className={cls} title={`Maintenance: ${MAINTENANCE_LABELS[status]}. ${meta.description}`}>
        <Icon className="size-3" aria-hidden />
        {MAINTENANCE_LABELS[status]}
      </span>
    );
  }
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

const DEPTH_ICON: Record<Depth, LucideIcon> = { indexed: LayersIcon, partial: LayersIcon, inventory: ListIcon, metadata: DatabaseIcon };

export function DepthBadge({ status, className, interactive = true }: { status: IngestionStatus; className?: string; interactive?: boolean }) {
  const depth = depthOf(status);
  const Icon = DEPTH_ICON[depth];
  const cls = cn(
    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap",
    depth === "indexed" && "border-info/30 bg-info-soft text-info",
    depth === "partial" && "border-info/30 border-dashed text-info",
    depth === "inventory" && "border-border text-foreground/80",
    depth === "metadata" && "border-dashed border-border text-muted-foreground",
    className,
  );
  if (!interactive) {
    return (
      <span className={cls} title={`${DEPTH_LABELS[depth]}: ${DEPTH_DESCRIPTIONS[depth]}`}>
        <Icon className="size-3" aria-hidden />
        {DEPTH_LABELS[depth]}
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap",
            depth === "indexed" && "border-info/30 bg-info-soft text-info",
            depth === "partial" && "border-info/30 border-dashed text-info",
            depth === "inventory" && "border-border text-foreground/80",
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
        {status !== "indexed" && status !== "partial" && status !== "inventory" && status !== "metadata_only" && (
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
    <span title={title} className={cn("inline-flex items-center rounded-md border border-border/80 bg-surface-1 px-1.5 py-0.5 text-[11px] leading-none whitespace-nowrap text-muted-foreground", className)}>
      {children}
    </span>
  );
}
