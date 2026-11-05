import Link from "next/link";
import { ArrowUpRightIcon, BookOpenIcon, ChevronRightIcon, GitBranchIcon, HomeIcon } from "lucide-react";
import { SystemMark, VerificationBadge } from "@/components/atlas";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SYSTEM_CATEGORY_LABELS } from "@/lib/contracts";
import { hostname } from "@/lib/utils";
import type { SystemDetail } from "@/server/queries/systems";
import { DepthBadge, MaintenanceBadge, RedistributionNote } from "../badges";
import { formatDate, percent } from "../lib/format";

function ExternalButton({ href, label, icon: Icon }: { href: string; label: string; icon: typeof HomeIcon }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-card px-2.5 text-[13px] font-medium shadow-xs transition-colors hover:bg-accent"
    >
      <Icon className="size-3.5 text-muted-foreground" aria-hidden />
      {label}
      <ArrowUpRightIcon className="size-3 text-muted-foreground" aria-hidden />
      <span className="sr-only">({hostname(href)}, opens in a new tab)</span>
    </a>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px]">{children}</dd>
    </div>
  );
}

export function SystemHeader({ detail }: { detail: SystemDetail }) {
  const { core, lastRetrievedAt } = detail;
  // official documentation hosts first, then by evidence volume
  const official = new Set([hostname(core.docsUrl), hostname(core.homepageUrl)].filter(Boolean));
  const evidenceHosts = [...detail.evidenceHosts].sort((a, b) => Number(official.has(b.host)) - Number(official.has(a.host)) || b.count - a.count);
  const latestRelease = formatDate(core.latestReleaseAt);
  const lastVerified = formatDate(core.lastVerifiedAt);
  const lastIngested = formatDate(core.lastIngestedAt);
  return (
    <header className="space-y-6 border-b border-border/70 pb-8">
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-1 text-xs text-muted-foreground">
          <li>
            <Link href="/systems" className="hover:text-foreground">
              Design systems
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRightIcon className="size-3" />
          </li>
          <li aria-current="page" className="truncate text-foreground">
            {core.name}
          </li>
        </ol>
      </nav>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <SystemMark name={core.name} slug={core.slug} size="lg" className="mt-1 hidden sm:grid" />
          <div className="min-w-0 space-y-3">
            <p className="type-eyebrow">
              {SYSTEM_CATEGORY_LABELS[core.category]}
              {core.organization && <> · {core.organization.name}</>}
            </p>
            <h1 className="type-display text-4xl break-words sm:text-5xl md:text-6xl">{core.name}</h1>
            {core.aliases.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Also known as <span className="text-foreground/85">{core.aliases.join(" · ")}</span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <VerificationBadge
                state="verified"
                detail={`Registry facts checked against official sources${lastVerified ? ` on ${lastVerified}` : ""}. Confidence ${percent(core.confidence)}.`}
              />
              <span className="tabular font-mono text-[11px] text-muted-foreground">{percent(core.confidence)} confidence</span>
              <span className="mx-1 h-3 w-px bg-border" aria-hidden />
              <MaintenanceBadge status={core.maintenance} />
              <DepthBadge status={core.ingestionStatus} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {core.docsUrl && <ExternalButton href={core.docsUrl} label="Docs" icon={BookOpenIcon} />}
          {core.repositoryUrl && <ExternalButton href={core.repositoryUrl} label="Repository" icon={GitBranchIcon} />}
          {core.homepageUrl && core.homepageUrl !== core.docsUrl && <ExternalButton href={core.homepageUrl} label="Homepage" icon={HomeIcon} />}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border bg-surface-1 p-4 sm:grid-cols-3 lg:grid-cols-5">
        <Meta label="License">
          {core.license ? (
            <span className="flex flex-col">
              <span className="truncate" title={core.license.name}>
                {core.license.spdxId ?? core.license.name}
              </span>
              <RedistributionNote value={core.license.redistribution} className="truncate" />
            </span>
          ) : (
            <span className="text-muted-foreground">Not recorded</span>
          )}
        </Meta>
        <Meta label="Latest version">
          {core.latestVersion ? (
            <span className="flex flex-col">
              <span className="font-mono">{core.latestVersion}</span>
              {latestRelease && (
                <time dateTime={core.latestReleaseAt!} className="text-xs text-muted-foreground">
                  released {latestRelease}
                </time>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">Not recorded</span>
          )}
        </Meta>
        <Meta label="Last verified">
          {lastVerified ? <time dateTime={core.lastVerifiedAt!}>{lastVerified}</time> : <span className="text-muted-foreground">Never</span>}
        </Meta>
        <Meta label="Last ingested">
          {lastIngested ? (
            <time dateTime={core.lastIngestedAt!}>{lastIngested}</time>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="cursor-help text-muted-foreground underline decoration-dotted underline-offset-2">
                  Not ingested
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">No adapter run has published components, tokens or patterns for this system yet.</TooltipContent>
            </Tooltip>
          )}
        </Meta>
        <Meta label="Sources">
          <span className="flex flex-col">
            <span className="truncate" title={evidenceHosts.map((h) => h.host).join(", ")}>
              {evidenceHosts
                .slice(0, 2)
                .map((h) => h.host)
                .join(", ") || "—"}
              {evidenceHosts.length > 2 && <span className="text-muted-foreground"> +{evidenceHosts.length - 2}</span>}
            </span>
            {lastRetrievedAt && <span className="text-xs text-muted-foreground">retrieved {formatDate(lastRetrievedAt)}</span>}
          </span>
        </Meta>
      </dl>
    </header>
  );
}
