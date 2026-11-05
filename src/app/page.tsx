import { PageContainer } from "@/components/atlas";
import {
  ComponentGroups,
  CuratedCollections,
  FeaturedSystems,
  Hero,
  HonestyStrip,
  RecentlyUpdated,
  SuggestedComparisons,
} from "@/components/discovery/home/home-sections";
import { pickFeatured, pickRecent, suggestComparisons } from "@/components/discovery/lib/home";
import { getComponentGroupStats, getCuratedCollections, getFeaturedCandidates, getHomeStats, getRecentlyUpdated, getTypeImplementations } from "@/server/queries/home";

/** Editorial discovery home. Every number and list is derived from records at request time. */
export default async function HomePage() {
  const [stats, featured, groups, types, recent, collections] = await Promise.all([
    getHomeStats(),
    getFeaturedCandidates(),
    getComponentGroupStats(),
    getTypeImplementations(),
    getRecentlyUpdated(200),
    getCuratedCollections(6),
  ]);
  return (
    <PageContainer className="space-y-16 sm:space-y-20">
      <Hero stats={stats} />
      <FeaturedSystems rows={pickFeatured(featured, 8)} />
      <ComponentGroups groups={groups} indexedSystems={stats.systemsIndexed + stats.systemsPartial} />
      <div className="grid grid-cols-1 gap-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-12">
        <SuggestedComparisons items={suggestComparisons(types, 6)} />
        <RecentlyUpdated rows={pickRecent(recent)} />
      </div>
      <CuratedCollections items={collections} />
      <HonestyStrip stats={stats} />
    </PageContainer>
  );
}
