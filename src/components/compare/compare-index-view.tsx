import { PageContainer, PageHeader } from "@/components/atlas/page-header";
import { getOwnerId } from "@/server/identity";
import { getCompareOptions, getFeaturedComparisons, getOwnerComparisons, indexedSystemSlugs, suggestComparisons } from "@/server/queries/compare";
import { ComponentCompareForm } from "./component-compare-form";
import { SavedList, SuggestedList, SystemCompareTeaser } from "./suggestions";

/** /compare without a complete selection: the picker, data-derived suggestions and saved comparisons. */
export async function CompareIndexView({ type, systems, error }: { type: string | null; systems: string[]; error: string | null }) {
  const ownerId = await getOwnerId();
  const [{ types, systems: systemOptions }, featured, mine] = await Promise.all([
    getCompareOptions(),
    getFeaturedComparisons(),
    ownerId ? getOwnerComparisons(ownerId) : Promise.resolve([]),
  ]);
  const names = new Map(systemOptions.map((s) => [s.slug, s.name]));
  const suggestions = suggestComparisons(types, 3, 8);
  const implemented = types.filter((t) => t.systemCount > 0).length;
  const indexed = indexedSystemSlugs(systemOptions);
  const indexedCount = indexedSystemSlugs(systemOptions, Number.MAX_SAFE_INTEGER).length;
  const validType = type && types.some((t) => t.slug === type) ? type : null;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Compare"
        display
        title="Compare implementations"
        description={
          <>
            Pick a canonical component type and two to five systems. ATLAS lines up each system&apos;s documented names, variants, states, props,
            accessibility guidance and tokens, and labels every gap as not documented, documented as none, or not extracted.
          </>
        }
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-10">
        <section aria-labelledby="picker-title" className="min-w-0 rounded-xl border bg-card p-4 shadow-xs sm:p-6">
          <h2 id="picker-title" className="mb-5 text-base font-semibold tracking-tight">
            Component comparison
          </h2>
          <ComponentCompareForm
            types={types.map((t) => ({ slug: t.slug, name: t.name, group: t.group, groupName: t.groupName, systemCount: t.systemCount, systems: t.systems }))}
            systems={systemOptions}
            initialType={validType}
            initialSystems={systems}
            error={error}
          />
        </section>

        <aside className="min-w-0 space-y-8" aria-label="Suggestions">
          <section aria-labelledby="suggested-title" className="space-y-3">
            <div className="space-y-1">
              <h2 id="suggested-title" className="text-base font-semibold tracking-tight">
                Suggested comparisons
              </h2>
              <p className="text-xs text-muted-foreground">Component types implemented by three or more indexed systems, most widely implemented first.</p>
            </div>
            {suggestions.length ? (
              <SuggestedList items={suggestions} names={names} />
            ) : (
              <p className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No component type is implemented by three indexed systems yet. Suggestions appear as more systems are ingested.
              </p>
            )}
          </section>

          {featured.length > 0 && (
            <section aria-labelledby="featured-title" className="space-y-3">
              <h2 id="featured-title" className="text-base font-semibold tracking-tight">
                Featured
              </h2>
              <SavedList items={featured} names={names} featured />
            </section>
          )}

          {mine.length > 0 && (
            <section aria-labelledby="mine-title" className="space-y-3">
              <div className="space-y-1">
                <h2 id="mine-title" className="text-base font-semibold tracking-tight">
                  Saved in this browser
                </h2>
                <p className="text-xs text-muted-foreground">Comparisons you saved. Anyone with a link can open it.</p>
              </div>
              <SavedList items={mine} names={names} />
            </section>
          )}

          <SystemCompareTeaser indexed={indexed} names={names} />
        </aside>
      </div>

      <p className="tabular mt-10 text-xs text-subtle-foreground">
        {types.length} canonical component types · {implemented} with at least one indexed implementation · {indexedCount} systems with indexed components ·{" "}
        {systemOptions.length} verified systems in the registry
      </p>
    </PageContainer>
  );
}
