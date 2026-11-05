import { AlertTriangleIcon, BadgeCheckIcon, CircleDashedIcon, CircleHelpIcon, SparklesIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { VerificationState } from "@/lib/contracts";
import { cn } from "@/lib/utils";

export const VERIFICATION_META: Record<VerificationState, { label: string; description: string; icon: typeof BadgeCheckIcon; className: string }> = {
  verified: {
    label: "Verified",
    description: "Confirmed against an official source. Evidence is stored with retrieval time and content hash.",
    icon: BadgeCheckIcon,
    className: "text-verified bg-verified-soft border-verified/25",
  },
  inferred: {
    label: "Inferred",
    description: "Derived by ATLAS heuristics (e.g. taxonomy matching). Not a claim made by the source.",
    icon: SparklesIcon,
    className: "text-inferred bg-inferred-soft border-inferred/25",
  },
  unverified: {
    label: "Unverified",
    description: "Recorded but not yet confirmed against an authoritative source.",
    icon: CircleHelpIcon,
    className: "text-muted-foreground bg-muted border-border",
  },
  unavailable: {
    label: "Unavailable",
    description: "ATLAS looked for this and the source does not provide it, or the source could not be reached.",
    icon: CircleDashedIcon,
    className: "text-unavailable bg-unavailable-soft border-dashed border-unavailable/40",
  },
  conflicting: {
    label: "Conflicting",
    description: "Sources disagree. Held for review and not presented as fact.",
    icon: AlertTriangleIcon,
    className: "text-conflicting bg-conflicting-soft border-conflicting/30",
  },
};

export function VerificationBadge({
  state,
  className,
  compact = false,
  detail,
}: {
  state: VerificationState;
  className?: string;
  compact?: boolean;
  detail?: string;
}) {
  const meta = VERIFICATION_META[state];
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
          {compact ? <span className="sr-only">{meta.label}</span> : meta.label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <p className="font-medium">{meta.label}</p>
        <p className="opacity-80">{detail ?? meta.description}</p>
      </TooltipContent>
    </Tooltip>
  );
}
