import Link from "next/link";
import { SourceLink, SystemMark, VerificationBadge } from "@/components/atlas";
import type { VerificationState } from "@/lib/contracts";
import { cn, hostname } from "@/lib/utils";
import type { ResolvedEntity } from "@/server/queries/collections";
import { ENTITY_ICON } from "./entity-meta";
import { ENTITY_TYPE_LABELS } from "./schema";

const CLASSIFIED: ResolvedEntity["entityType"][] = ["component", "pattern"];

/** One referenced record (bookmark or collection item) with its provenance. Server component. */
export function EntityRow({
  entity,
  index,
  actions,
  children,
  className,
}: {
  entity: ResolvedEntity;
  index?: number;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const Icon = ENTITY_ICON[entity.entityType];
  const missing = !entity.exists;
  const retired = entity.state === "retired";
  return (
    <li className={cn("group/row relative grid gap-x-4 gap-y-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto]", missing && "hatch", className)}>
      <div className="flex min-w-0 gap-3">
        {index !== undefined && <span className="tabular w-6 shrink-0 pt-0.5 text-right font-mono text-[11px] text-subtle-foreground">{index + 1}</span>}
        <span className="mt-0.5 shrink-0">
          {entity.entityType === "system" && entity.systemSlug && !missing ? (
            <SystemMark name={entity.title} slug={entity.systemSlug} size="sm" />
          ) : (
            <span className="grid size-7 place-items-center rounded-lg border bg-surface-1 text-muted-foreground">
              <Icon className="size-3.5" aria-hidden />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {entity.url ? (
              <Link href={entity.url} className="truncate text-sm font-medium hover:underline">
                {entity.title}
              </Link>
            ) : (
              <span className={cn("truncate text-sm font-medium", missing && "text-muted-foreground")}>{entity.title}</span>
            )}
            <span className="font-mono text-[10.5px] tracking-wide text-subtle-foreground uppercase">{ENTITY_TYPE_LABELS[entity.entityType].one}</span>
            {missing && (
              <span className="rounded border border-dashed px-1.5 py-0.5 text-[11px] text-muted-foreground" title="The referenced record was removed from the ATLAS index.">
                No longer in the index
              </span>
            )}
            {retired && (
              <span className="rounded border border-dashed border-unavailable/50 px-1.5 py-0.5 text-[11px] text-unavailable" title="The source no longer lists this record. ATLAS keeps it for history.">
                Retired by source
              </span>
            )}
            {CLASSIFIED.includes(entity.entityType) && (entity.verification === "verified" || entity.verification === "inferred") && (
              <VerificationBadge
                state={entity.verification as VerificationState}
                detail={entity.verification === "inferred" ? "ATLAS taxonomy classification derived heuristically, not stated by the source." : "The source itself names this pattern/type."}
              />
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {[entity.entityType !== "system" ? entity.systemName : null, entity.subtitle].filter(Boolean).join(" · ") || (missing ? "Reference kept so your list stays intact." : " ")}
          </p>
          {entity.sourceUrl ? (
            <SourceLink href={entity.sourceUrl} className="text-xs text-muted-foreground">
              {hostname(entity.sourceUrl) ?? "Official source"}
            </SourceLink>
          ) : (
            !missing && (
              <p className="text-xs text-subtle-foreground">{entity.entityType === "component-type" || entity.entityType === "comparison" ? "ATLAS-authored record" : "No official source URL recorded"}</p>
            )
          )}
          {children}
        </div>
      </div>
      {actions && <div className="flex items-start gap-1 pl-9 sm:pl-0">{actions}</div>}
    </li>
  );
}
