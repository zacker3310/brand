import Link from "next/link";
import { BookOpenIcon, GitBranchIcon } from "lucide-react";
import { SystemMark, VerificationBadge } from "@/components/atlas";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SYSTEM_CATEGORY_LABELS } from "@/lib/contracts";
import { cn, hostname } from "@/lib/utils";
import { Chip, DepthBadge, MaintenanceBadge } from "./badges";
import { CoverageMeter, type CoverageCounts } from "./coverage-meter";
import type { DirectoryRow } from "./lib/directory";
import { formatDate, percent } from "./lib/format";

const UI_FRAMEWORK = (f: DirectoryRow["frameworks"][number]) => f.slug !== "figma";

export function FrameworkChips({ frameworks, max = 4, className }: { frameworks: DirectoryRow["frameworks"]; max?: number; className?: string }) {
  const list = frameworks.filter(UI_FRAMEWORK);
  if (!list.length) return <span className={cn("text-[11px] text-muted-foreground", className)}>No framework recorded</span>;
  const shown = list.slice(0, max);
  const rest = list.slice(max);
  return (
    <ul className={cn("flex flex-wrap gap-1", className)} aria-label="Frameworks">
      {shown.map((f) => (
        <li key={f.slug}>
          <Chip
            className={cn(f.state !== "verified" && "border-dashed")}
            title={`${f.name} · ${f.support === "community" ? "community" : "official"} · ${f.state}${f.packageName ? ` · ${f.packageName}` : ""}`}
          >
            {f.name}
          </Chip>
        </li>
      ))}
      {rest.length > 0 && (
        <li>
          <Chip title={rest.map((f) => f.name).join(", ")}>+{rest.length}</Chip>
        </li>
      )}
    </ul>
  );
}

export function ConfidenceBadge({ confidence, verifiedAt, className }: { confidence: number; verifiedAt: string | null; className?: string }) {
  const date = formatDate(verifiedAt);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <VerificationBadge
        state="verified"
        detail={`Registry facts checked against official sources${date ? ` on ${date}` : ""}. Confidence ${percent(confidence)} reflects how many checks passed and how authoritative the sources were.`}
      />
      <span className="tabular font-mono text-[11px] text-muted-foreground">{percent(confidence)}</span>
    </span>
  );
}

function IconSourceLink({ href, label, icon: Icon }: { href: string; label: string; icon: typeof BookOpenIcon }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="relative z-10 grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Icon className="size-3.5" aria-hidden />
          <span className="sr-only">
            {label} ({hostname(href)}, opens in a new tab)
          </span>
        </a>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        {label} · {hostname(href)}
      </TooltipContent>
    </Tooltip>
  );
}

export function SystemCard({ row, max, headingLevel = 3 }: { row: DirectoryRow; max: CoverageCounts; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="group/card relative flex h-full flex-col rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20 focus-within:border-foreground/25">
      <div className="flex items-start gap-3">
        <SystemMark name={row.name} slug={row.slug} />
        <div className="min-w-0 flex-1">
          <H className="truncate text-[15px] leading-tight font-semibold tracking-tight">
            <Link href={`/systems/${row.slug}`} className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring">
              {row.name}
            </Link>
          </H>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {row.organization?.name ?? "Organization not recorded"} · {SYSTEM_CATEGORY_LABELS[row.category]}
          </p>
        </div>
        <MaintenanceBadge status={row.maintenance} hideActive className="relative z-10" />
      </div>
      {row.summary && <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{row.summary}</p>}
      <FrameworkChips frameworks={row.frameworks} className="relative z-10 mt-3" />
      <div className="mt-auto pt-4">
        <div className="border-t border-border/70 pt-3">
          <CoverageMeter counts={row.counts} max={max} status={row.ingestionStatus} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="relative z-10 flex min-w-0 flex-wrap items-center gap-1.5">
            <ConfidenceBadge confidence={row.confidence} verifiedAt={row.lastVerifiedAt} />
            {row.ingestionStatus === "indexed" || row.ingestionStatus === "partial" ? <DepthBadge status={row.ingestionStatus} /> : null}
          </div>
          <div className="flex shrink-0 items-center">
            {row.docsUrl && <IconSourceLink href={row.docsUrl} label="Official documentation" icon={BookOpenIcon} />}
            {row.repositoryUrl && <IconSourceLink href={row.repositoryUrl} label="Source repository" icon={GitBranchIcon} />}
          </div>
        </div>
      </div>
    </article>
  );
}
