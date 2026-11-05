import Link from "next/link";
import { CircleDashedIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CoverageChip, SourceLink, SystemMark, VerificationBadge } from "@/components/atlas";
import type { CoverageState } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import type { PatternComponentRef, PatternRecord } from "@/server/queries/patterns";
import { classificationInfo, componentHref, docsSection, excerpt, patternHref } from "./lib";

export function ClassificationBadge({ p, className }: { p: Pick<PatternRecord, "name" | "classificationState" | "type">; className?: string }) {
  const info = classificationInfo(p);
  if (info.state === "unverified") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap text-muted-foreground", className)}
          >
            <CircleDashedIcon className="size-3" aria-hidden />
            Unclassified
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          <p className="font-medium">Unclassified</p>
          <p className="opacity-80">{info.detail}</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  return <VerificationBadge state={info.state} detail={info.detail} className={className} />;
}

export function ComponentChips({ system, components, coverage, max = 8 }: { system: string; components: PatternComponentRef[]; coverage?: CoverageState; max?: number }) {
  if (!components.length) {
    return coverage && coverage !== "documented" ? <CoverageChip state={coverage} label="Components" /> : <CoverageChip state="not-extracted" label="Components" />;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {components.slice(0, max).map((c) => (
        <li key={c.slug}>
          <Link
            href={componentHref(system, c.slug)}
            className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs transition-colors hover:border-primary/40 hover:bg-accent"
            title={c.typeName ? `${c.name} · ATLAS type: ${c.typeName}` : c.name}
          >
            {c.name}
          </Link>
        </li>
      ))}
      {components.length > max && <li className="self-center text-xs text-muted-foreground">+{components.length - max} more</li>}
    </ul>
  );
}

/** Card for one system's documented pattern. */
export function PatternCard({ p, showType = false, className }: { p: PatternRecord; showType?: boolean; className?: string }) {
  const desc = excerpt(p.description, 220);
  const section = docsSection(p.docsUrl);
  return (
    <article className={cn("flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4", className)} aria-labelledby={`pat-${p.id}`}>
      <div className="flex items-start gap-3">
        <SystemMark name={p.system.name} slug={p.system.slug} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">{p.system.name}</p>
          <h3 id={`pat-${p.id}`} className="text-[15px] font-medium leading-snug">
            <Link href={patternHref(p.system.slug, p.slug)} className="hover:underline">
              {p.name}
            </Link>
          </h3>
        </div>
        <ClassificationBadge p={p} />
      </div>
      {showType && p.type && <p className="text-xs text-muted-foreground">ATLAS type: {p.type.name}</p>}
      {desc ? <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p> : <CoverageChip state={(p.coverage.description as CoverageState) ?? "not-extracted"} label="Description" />}
      <div className="space-y-1.5">
        <p className="type-eyebrow">Related components</p>
        <ComponentChips system={p.system.slug} components={p.components} coverage={p.coverage.components as CoverageState | undefined} max={6} />
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        {p.docsUrl ? (
          <SourceLink href={p.docsUrl} className="text-xs">
            Official docs
          </SourceLink>
        ) : (
          <CoverageChip state="not-extracted" label="Docs link" />
        )}
        {section && <span className="truncate font-mono text-[11px] text-subtle-foreground">{section}</span>}
      </div>
    </article>
  );
}
