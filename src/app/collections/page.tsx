import { BookmarkIcon, FolderIcon, SparklesIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageContainer, PageHeader, Section } from "@/components/atlas";
import { BookmarkButton } from "@/components/collections/bookmark-button";
import { AddToCollectionDialog } from "@/components/collections/add-to-collection-dialog";
import { CollectionCard } from "@/components/collections/collection-card";
import { CreateCollectionForm } from "@/components/collections/create-collection-form";
import { EntityTypeTag } from "@/components/collections/entity-meta";
import { EntityRow } from "@/components/collections/entity-row";
import { ENTITY_TYPES, ENTITY_TYPE_LABELS, type EntityType } from "@/components/collections/schema";
import { getOwnerId } from "@/server/identity";
import { listBookmarks, listCuratedCollections, listOwnerCollections, type BookmarkView } from "@/server/queries/collections";
import { formatCount } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Collections",
  description: "Bookmarks and named collections of design systems, components, tokens and patterns, plus data-derived ATLAS collections.",
};

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const owner = await getOwnerId();
  const [mine, bookmarks, curated] = await Promise.all([listOwnerCollections(owner), listBookmarks(owner), listCuratedCollections()]);
  const byType = new Map<EntityType, BookmarkView[]>();
  for (const b of bookmarks) byType.set(b.entityType, [...(byType.get(b.entityType) ?? []), b]);
  const deleted = sp.deleted === "1";

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Library"
        title="Collections"
        display
        description={
          <>
            Save systems, components, tokens and patterns into named lists with notes and tags, then export them with their official source links.
            Your collections and bookmarks are stored against an anonymous identity for this browser and are visible only to you.
          </>
        }
      />
      {deleted && (
        <p role="status" className="mt-6 rounded-lg border bg-surface-1 px-4 py-2.5 text-sm text-muted-foreground">
          Collection deleted. The indexed records were not affected.
        </p>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Section
          id="yours"
          title={
            <span className="inline-flex items-center gap-2">
              Your collections <span className="tabular font-mono text-xs font-normal text-subtle-foreground">{formatCount(mine.length)}</span>
            </span>
          }
          description="Private to this browser."
        >
          {mine.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {mine.map((c) => (
                <CollectionCard key={c.id} c={c} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={FolderIcon}
              title="No collections yet"
              description="Create one here, or use Collect on any system, component, token or pattern page to start a list from there."
            />
          )}
        </Section>

        <aside aria-labelledby="new-title" className="h-fit space-y-4 rounded-xl border bg-card p-4 lg:sticky lg:top-20">
          <div className="space-y-1">
            <h2 id="new-title" className="text-sm font-semibold">
              New collection
            </h2>
            <p className="text-xs text-muted-foreground">Names and descriptions are yours; items keep a live link to the indexed record and its official source.</p>
          </div>
          <CreateCollectionForm />
        </aside>
      </div>

      <Section
        id="bookmarks"
        className="mt-14"
        title={
          <span className="inline-flex items-center gap-2">
            Bookmarks <span className="tabular font-mono text-xs font-normal text-subtle-foreground">{formatCount(bookmarks.length)}</span>
          </span>
        }
        description="Quick saves from anywhere in ATLAS, newest first."
      >
        {bookmarks.length === 0 ? (
          <EmptyState
            icon={BookmarkIcon}
            title="Nothing bookmarked yet"
            description="The bookmark button appears on systems, components, tokens and patterns. Bookmarks land here, grouped by type."
            action={
              <Link href="/systems" className="text-sm font-medium text-primary hover:underline">
                Browse design systems
              </Link>
            }
          />
        ) : (
          <div className="space-y-6">
            {ENTITY_TYPES.filter((t) => byType.has(t)).map((t) => (
              <div key={t} className="space-y-2">
                <h3>
                  <EntityTypeTag type={t} count={byType.get(t)!.length} />
                  <span className="sr-only"> {ENTITY_TYPE_LABELS[t].many}</span>
                </h3>
                <ul className="divide-y rounded-xl border bg-card">
                  {byType.get(t)!.map((b) => (
                    <EntityRow
                      key={b.bookmarkId}
                      entity={b}
                      actions={
                        <>
                          {b.exists && <AddToCollectionDialog entityType={b.entityType} entityId={b.entityId} label={b.title} />}
                          <BookmarkButton entityType={b.entityType} entityId={b.entityId} label={b.title} initialBookmarked />
                        </>
                      }
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        id="curated"
        className="mt-14"
        title={
          <span className="inline-flex items-center gap-2">
            <SparklesIcon className="size-4 text-muted-foreground" aria-hidden /> Curated by ATLAS
          </span>
        }
        description="Built only from rules over indexed data, never hand-picked. Each collection states its rule; membership is recomputed by scripts/seed-collections.ts."
      >
        {curated.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {curated.map((c) => (
              <CollectionCard key={c.id} c={c} />
            ))}
          </div>
        ) : (
          <EmptyState icon={SparklesIcon} title="Curated collections haven’t been generated" description={<>Run <code className="font-mono text-xs">npx tsx scripts/seed-collections.ts</code> to build them from the indexed data.</>} />
        )}
      </Section>
    </PageContainer>
  );
}
