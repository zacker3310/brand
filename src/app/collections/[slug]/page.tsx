import { ArrowDownIcon, ArrowUpIcon, DownloadIcon, FolderOpenIcon, SparklesIcon, XIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, PageContainer, PageHeader } from "@/components/atlas";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { CollectionSettings } from "@/components/collections/collection-settings";
import { typeCountsText } from "@/components/collections/entity-meta";
import { EntityRow } from "@/components/collections/entity-row";
import { ItemEditor } from "@/components/collections/item-editor";
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, EntityType } from "@/components/collections/schema";
import { EXPORT_DISCLAIMER } from "@/server/api/meta";
import { getOwnerId } from "@/server/identity";
import { getCollection } from "@/server/queries/collections";
import { cn, relativeTime } from "@/lib/utils";
import { moveItemAction, removeItemAction } from "../actions";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

async function load(slug: string) {
  if (!SLUG_RE.test(slug)) return null;
  return getCollection(await getOwnerId(), slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const c = await load(slug);
  if (!c) return { title: "Collection not found" };
  return { title: `${c.name} · Collections`, description: c.description ?? `A collection of ${c.itemCount} records in ATLAS.`, robots: c.isCurated ? undefined : { index: false } };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CollectionPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const c = await load(slug);
  if (!c) notFound();

  const typeParam = EntityType.safeParse(one(sp.type));
  const type = typeParam.success ? typeParam.data : null;
  const tag = (one(sp.tag) ?? "").toLowerCase() || null;
  const items = c.items.filter((i) => (!type || i.entityType === type) && (!tag || i.tags.includes(tag)));
  const filtered = !!type || !!tag;
  const editable = c.isOwner && !c.isCurated;
  const reorderable = editable && !filtered;
  const sourced = c.items.filter((i) => i.sourceUrl).length;
  const qs = (next: { type?: string | null; tag?: string | null }) => {
    const u = new URLSearchParams();
    const t = next.type === undefined ? type : next.type;
    const g = next.tag === undefined ? tag : next.tag;
    if (t) u.set("type", t);
    if (g) u.set("tag", g);
    const s = u.toString();
    return s ? `?${s}` : "";
  };

  return (
    <PageContainer>
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/collections">Collections</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage className="max-w-[60vw] truncate">{c.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        eyebrow={
          c.isCurated ? (
            <span className="inline-flex items-center gap-1.5">
              <SparklesIcon className="size-3" aria-hidden /> Curated by ATLAS · data-derived
            </span>
          ) : (
            "Your collection · private"
          )
        }
        title={c.name}
        description={
          c.isCurated ? (
            <span className="block rounded-lg border bg-surface-1 px-3 py-2 text-sm text-foreground/85">{c.description}</span>
          ) : (
            (c.description ?? <span className="text-subtle-foreground italic">No description</span>)
          )
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/collections/${c.slug}/export?format=json`} download>
                <DownloadIcon aria-hidden /> JSON
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/collections/${c.slug}/export?format=csv`} download>
                <DownloadIcon aria-hidden /> CSV
              </a>
            </Button>
          </>
        }
      >
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular">{typeCountsText(c.typeCounts) || "No items"}</span>
          <span aria-hidden>·</span>
          <span>
            {c.isCurated ? "Membership computed" : "Updated"} <time dateTime={c.updatedAt}>{relativeTime(c.updatedAt)}</time>
          </span>
          {c.itemCount > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular">
                {sourced} of {c.itemCount} link to an official source
              </span>
            </>
          )}
        </p>
      </PageHeader>

      {editable && (
        <div className="mt-4">
          <CollectionSettings id={c.id} name={c.name} description={c.description} itemCount={c.itemCount} />
        </div>
      )}
      {one(sp.added) === "1" && (
        <p role="status" className="mt-4 rounded-lg border bg-surface-1 px-4 py-2.5 text-sm text-muted-foreground">
          Added to this collection.
        </p>
      )}

      {c.itemCount > 0 && (
        <nav aria-label="Filter items" className="mt-8 flex flex-wrap items-center gap-2">
          <FilterChip href={`/collections/${c.slug}${qs({ type: null })}`} active={!type}>
            All <span className="tabular text-subtle-foreground">{c.itemCount}</span>
          </FilterChip>
          {ENTITY_TYPES.filter((t) => c.typeCounts[t]).map((t) => (
            <FilterChip key={t} href={`/collections/${c.slug}${qs({ type: t })}`} active={type === t}>
              {ENTITY_TYPE_LABELS[t].many} <span className="tabular text-subtle-foreground">{c.typeCounts[t]}</span>
            </FilterChip>
          ))}
          {c.tags.length > 0 && <span className="mx-1 h-4 w-px bg-border" aria-hidden />}
          {c.tags.slice(0, 12).map((t) => (
            <FilterChip key={t.tag} href={`/collections/${c.slug}${qs({ tag: tag === t.tag ? null : t.tag })}`} active={tag === t.tag} mono>
              #{t.tag} <span className="tabular text-subtle-foreground">{t.n}</span>
            </FilterChip>
          ))}
        </nav>
      )}

      <section aria-labelledby="items-title" className="mt-4">
        <h2 id="items-title" className="sr-only">
          Items
        </h2>
        {c.itemCount === 0 ? (
          <EmptyState
            icon={FolderOpenIcon}
            title={c.isCurated ? "No system currently matches this rule" : "This collection is empty"}
            description={
              c.isCurated
                ? "Membership is recomputed from indexed data; it will fill as matching records are ingested."
                : "Use Collect on any system, component, token or pattern to add it here. Bookmarks can be collected from the Collections page."
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="No items match these filters"
            action={
              <Link href={`/collections/${c.slug}`} className="text-sm font-medium text-primary hover:underline">
                Clear filters
              </Link>
            }
          />
        ) : (
          <>
            {filtered && (
              <p className="mb-2 text-xs text-muted-foreground" aria-live="polite">
                Showing {items.length} of {c.itemCount}
                {type ? ` · ${ENTITY_TYPE_LABELS[type].many.toLowerCase()}` : ""}
                {tag ? ` · #${tag}` : ""}. Reordering is available when no filter is applied.
              </p>
            )}
            <ol className="divide-y rounded-xl border bg-card">
              {items.map((i, idx) => (
                <EntityRow
                  key={i.itemId}
                  entity={i}
                  index={filtered ? undefined : idx}
                  actions={
                    editable ? (
                      <div className="flex items-center gap-0.5">
                        {reorderable && (
                          <>
                            <form action={moveItemAction}>
                              <input type="hidden" name="itemId" value={i.itemId} />
                              <input type="hidden" name="slug" value={c.slug} />
                              <input type="hidden" name="direction" value="up" />
                              <Button type="submit" variant="ghost" size="icon-xs" disabled={idx === 0} aria-label={`Move ${i.title} up`}>
                                <ArrowUpIcon aria-hidden />
                              </Button>
                            </form>
                            <form action={moveItemAction}>
                              <input type="hidden" name="itemId" value={i.itemId} />
                              <input type="hidden" name="slug" value={c.slug} />
                              <input type="hidden" name="direction" value="down" />
                              <Button type="submit" variant="ghost" size="icon-xs" disabled={idx === items.length - 1} aria-label={`Move ${i.title} down`}>
                                <ArrowDownIcon aria-hidden />
                              </Button>
                            </form>
                          </>
                        )}
                        <form action={removeItemAction}>
                          <input type="hidden" name="itemId" value={i.itemId} />
                          <input type="hidden" name="slug" value={c.slug} />
                          <Button type="submit" variant="ghost" size="icon-xs" aria-label={`Remove ${i.title} from this collection`} className="hover:text-destructive">
                            <XIcon aria-hidden />
                          </Button>
                        </form>
                      </div>
                    ) : undefined
                  }
                >
                  {(i.note || i.tags.length > 0) && (
                    <div className="space-y-1.5 pt-1">
                      {i.note && <p className="max-w-prose border-l-2 pl-2.5 text-[13px] leading-relaxed whitespace-pre-line text-foreground/85">{i.note}</p>}
                      {i.tags.length > 0 && (
                        <ul className="flex flex-wrap gap-1" aria-label="Tags">
                          {i.tags.map((t) => (
                            <li key={t}>
                              <Link href={`/collections/${c.slug}${qs({ tag: t })}`} className="rounded border bg-surface-1 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground">
                                #{t}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {editable && <ItemEditor itemId={i.itemId} slug={c.slug} note={i.note} tags={i.tags} title={i.title} />}
                </EntityRow>
              ))}
            </ol>
          </>
        )}
      </section>

      <footer className="mt-8 flex flex-col gap-1 text-xs text-subtle-foreground sm:flex-row sm:justify-between">
        <p>{EXPORT_DISCLAIMER}</p>
        <p>Data from each item’s official documentation, linked above.</p>
      </footer>
    </PageContainer>
  );
}

function FilterChip({ href, active, children, mono }: { href: string; active: boolean; children: React.ReactNode; mono?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      scroll={false}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
        mono && "font-mono",
        active ? "border-foreground/25 bg-foreground text-background [&_span]:text-background/70" : "bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
