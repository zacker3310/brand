import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer, PageHeader } from "@/components/atlas";
import { AddToCollectionForm } from "@/components/collections/add-to-collection-form";
import { EntityRow } from "@/components/collections/entity-row";
import { EntityRef } from "@/components/collections/schema";
import { getOwnerId } from "@/server/identity";
import { entityMembership, resolveEntities } from "@/server/queries/collections";

export const metadata: Metadata = { title: "Add to collection", robots: { index: false } };

/** No-JavaScript fallback for AddToCollectionDialog: /collections/add?entityType=&entityId= */
export default async function AddToCollectionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ref = EntityRef.safeParse({ entityType: sp.entityType, entityId: sp.entityId });
  if (!ref.success) notFound();
  const [entity] = await resolveEntities([ref.data]);
  if (!entity?.exists) notFound();
  const membership = await entityMembership(await getOwnerId(), ref.data);
  return (
    <PageContainer className="max-w-2xl">
      <PageHeader eyebrow={<Link href="/collections">Collections</Link>} title="Add to collection" />
      <ul className="mt-6 rounded-xl border bg-card">
        <EntityRow entity={entity} />
      </ul>
      <div className="mt-8">
        <AddToCollectionForm entityType={ref.data.entityType} entityId={ref.data.entityId} collections={membership.collections} />
      </div>
    </PageContainer>
  );
}
