import { PageContainer, Stat } from "@/components/atlas";
import { getCatalogStats } from "@/server/queries/stats";

/** Placeholder home: replaced by the product-interface workstream. Stats are live. */
export default async function HomePage() {
  const stats = await getCatalogStats();
  return (
    <PageContainer className="py-16">
      <p className="type-eyebrow">Design system intelligence</p>
      <h1 className="type-display mt-4 max-w-4xl text-5xl sm:text-7xl">The world&apos;s design systems, indexed and compared.</h1>
      <div className="mt-12 grid grid-cols-2 gap-8 sm:grid-cols-4">
        <Stat value={stats.systemsVerified} label="Verified systems" />
        <Stat value={stats.components} label="Indexed components" />
        <Stat value={stats.tokens} label="Design tokens" />
        <Stat value={stats.evidence} label="Evidence records" />
      </div>
    </PageContainer>
  );
}
