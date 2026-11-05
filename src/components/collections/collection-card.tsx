import { ArrowRightIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { SystemMark } from "@/components/atlas";
import { cn, relativeTime } from "@/lib/utils";
import type { CollectionSummary } from "@/server/queries/collections";
import { ENTITY_ICON, typeCountsText } from "./entity-meta";

export function CollectionCard({ c, className }: { c: CollectionSummary; className?: string }) {
  const counts = typeCountsText(c.typeCounts);
  return (
    <article
      className={cn(
        "group relative flex min-h-44 flex-col rounded-xl border bg-card p-4 transition-colors focus-within:border-ring hover:border-foreground/20",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {c.isCurated && (
            <p className="type-eyebrow inline-flex items-center gap-1 text-[10px]">
              <SparklesIcon className="size-3" aria-hidden /> Data-derived
            </p>
          )}
          <h3 className="text-[15px] leading-snug font-medium tracking-tight">
            <Link href={`/collections/${c.slug}`} className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:underline">
              {c.name}
            </Link>
          </h3>
        </div>
        <span className="tabular shrink-0 rounded-md border bg-surface-1 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground" aria-label={`${c.itemCount} items`}>
          {c.itemCount}
        </span>
      </div>
      {c.description ? (
        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">{c.description}</p>
      ) : (
        <p className="mt-2 text-[13px] text-subtle-foreground italic">No description</p>
      )}
      <div className="mt-auto pt-4">
        {c.preview.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="First items">
            {c.preview.map((p, i) => {
              const Icon = ENTITY_ICON[p.entityType] ?? ENTITY_ICON.system;
              return (
                <li key={i} className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-surface-1 py-0.5 pr-2 pl-0.5 text-xs">
                  {p.entityType === "system" && p.systemSlug ? (
                    <SystemMark name={p.title} slug={p.systemSlug} size="sm" className="size-5 rounded text-[8px]" />
                  ) : (
                    <span className="grid size-5 place-items-center text-muted-foreground">
                      <Icon className="size-3" aria-hidden />
                    </span>
                  )}
                  <span className="truncate">{p.title}</span>
                </li>
              );
            })}
            {c.itemCount > c.preview.length && <li className="self-center px-1 text-xs text-subtle-foreground">+{c.itemCount - c.preview.length}</li>}
          </ul>
        ) : (
          <p className="text-xs text-subtle-foreground">Empty</p>
        )}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-dashed pt-3 text-[11px] text-subtle-foreground">
          <span className="truncate">{counts || "No items yet"}</span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <time dateTime={c.updatedAt}>{c.isCurated ? "computed " : "updated "}{relativeTime(c.updatedAt)}</time>
            <ArrowRightIcon className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </div>
      </div>
    </article>
  );
}
