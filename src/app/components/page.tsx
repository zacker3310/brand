import type { Metadata } from "next";
import { CATALOG_SCOPE } from "@/components/catalog/lib/scope";
import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import { EmptyState, PageContainer, PageHeader } from "@/components/atlas";
import { CatalogFilters } from "@/components/catalog/catalog-filters";
import { ActiveFilters, CatalogSearchInput, ExpansionNote, layoutItems, Segmented, viewItems } from "@/components/catalog/catalog-toolbar";
import { ComponentTable } from "@/components/catalog/component-table";
import { CoverageMatrix, MatrixLegend } from "@/components/catalog/coverage-matrix";
import { CoverageStripLegend } from "@/components/catalog/coverage-strip";
import { FilterForm } from "@/components/catalog/filter-form";
import { CatalogPagination } from "@/components/catalog/pagination";
import { TypeGroups } from "@/components/catalog/type-groups";
import { plural } from "@/components/catalog/lib/format";
import {
  activeFilterCount,
  clearFiltersHref,
  hasComponentLevelFilters,
  PAGE_SIZE,
  parseCatalogParams,
  type RawSearchParams,
} from "@/components/catalog/lib/params";
import { expandCatalogQuery } from "@/components/catalog/lib/search";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/utils";
import { getCatalogComponents, getCatalogFacets, getCatalogTypes, getSystemLabels } from "@/server/queries/components";

type Props = { searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const p = parseCatalogParams(await searchParams);
  const title = p.view === "components" ? "Component catalog" : p.layout === "matrix" ? "Component coverage matrix" : "Component types";
  return {
    title: p.q ? `${title}: “${p.q}”` : title,
    description:
      "Every indexed design-system component, mapped to ATLAS canonical types with system-specific names, classification state and per-field coverage.",
  };
}

const MATRIX_DEFAULT_COLUMNS = 8;

export default async function ComponentsCatalogPage({ searchParams }: Props) {
  const params = parseCatalogParams(await searchParams);
  const [facets, systems] = await Promise.all([getCatalogFacets(params), getSystemLabels()]);
  const [types, rows] = await Promise.all([
    params.view === "types" ? getCatalogTypes(params) : Promise.resolve(null),
    params.view === "components" ? getCatalogComponents(params) : Promise.resolve(null),
  ]);
  const expansion = params.q ? expandCatalogQuery(params.q) : { typeSlugs: [], reasons: [] };
  const filtered = activeFilterCount(params) > 0;

  // Systems in scope: the selection, else every system with indexed components (ordered by size).
  const allSystems = [...systems.values()];
  const scope = params.systems.length ? allSystems.filter((s) => params.systems.includes(s.slug)) : allSystems;
  const matrixColumns = params.systems.length ? scope : scope.slice(0, MATRIX_DEFAULT_COLUMNS);

  const firstRow = (params.page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(facets.matching, params.page * PAGE_SIZE);

  const nothing =
    params.view === "components" ? facets.matching === 0 : types ? types.typesShown + types.emptyShown + types.unclassified.length === 0 : true;

  return (
    <PageContainer className={CATALOG_SCOPE}>
      <PageHeader
        eyebrow={<span className="text-muted-foreground">Universal component catalog</span>}
        title="Components"
        display
        description={
          <>
            <span className="tabular text-foreground">{formatCount(facets.universe)}</span> published components from{" "}
            <span className="tabular text-foreground">{facets.systemsWithComponents}</span> indexed systems, mapped to{" "}
            <span className="tabular text-foreground">{facets.typesImplemented}</span> of {facets.typesTotal} ATLAS canonical types. Names
            stay system-specific; canonical types are ATLAS&apos;s cross-system vocabulary, labelled verified or inferred.
          </>
        }
      >
        <p className="text-xs text-muted-foreground">
          Component-level data exists for {facets.systemsWithComponents} of {facets.systemsPublished} verified systems so far. The rest are
          registry entries only, so absence here is never evidence that a system lacks a component.{" "}
          <Link href="/systems" className="link-underline text-muted-foreground">
            Browse all systems
          </Link>
        </p>
      </PageHeader>

      <FilterForm action="/components" label="Filter the component catalog" className="mt-8 grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        {params.view !== "types" && <input type="hidden" name="view" value={params.view} />}
        {params.view === "types" && params.layout !== "list" && <input type="hidden" name="layout" value={params.layout} />}

        <aside aria-label="Catalog filters" className="min-w-0">
          <CatalogFilters params={params} facets={facets} systems={systems} />
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <Segmented label="Catalog view" items={viewItems(params, { types: facets.typesMatching, components: facets.matching })} />
            <CatalogSearchInput params={params} />
            {params.view === "types" ? (
              <Segmented label="Types layout" items={layoutItems(params)} className="self-start sm:self-auto" />
            ) : (
              <div className="flex items-center gap-2">
                <label htmlFor="catalog-sort" className="text-xs whitespace-nowrap text-muted-foreground">
                  Sort
                </label>
                <select
                  id="catalog-sort"
                  name="sort"
                  defaultValue={params.sort === "relevance" ? "" : params.sort}
                  data-default=""
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                >
                  <option value="">{params.q ? "Best match" : "Name (A–Z)"}</option>
                  <option value="name">Name</option>
                  <option value="system">System</option>
                  <option value="type">Canonical type</option>
                  <option value="coverage">Most documented</option>
                </select>
              </div>
            )}
          </div>

          <ActiveFilters params={params} systems={systems} />
          {params.q && <ExpansionNote expansion={expansion} />}

          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border/70 pb-3">
            <p role="status" aria-live="polite" className="tabular text-[13px] text-muted-foreground">
              {params.view === "components" ? (
                facets.matching > 0 ? (
                  <>
                    Showing <span className="text-foreground">{formatCount(firstRow)}</span>–
                    <span className="text-foreground">{formatCount(lastRow)}</span> of{" "}
                    <span className="text-foreground">{formatCount(facets.matching)}</span> components
                  </>
                ) : (
                  "No components match"
                )
              ) : types ? (
                <>
                  <span className="text-foreground">{plural(types.typesShown, "type")}</span> with implementations
                  {types.emptyShown > 0 && <> · {formatCount(types.emptyShown)} not found in the index</>} ·{" "}
                  {plural(facets.matching, "component")}
                </>
              ) : null}
            </p>
            {params.view === "components" ? (
              <CoverageStripLegend />
            ) : params.layout === "matrix" ? null : (
              <p className="text-[11px] text-muted-foreground">Names link to component detail; types link to the cross-system view.</p>
            )}
          </div>

          <div className="transition-opacity duration-200 group-data-[pending]/catalog:opacity-50">
            {nothing ? (
              <EmptyState
                icon={SearchXIcon}
                title={params.q ? `Nothing in the index matches “${params.q}”` : "No components match these filters"}
                description={
                  <>
                    ATLAS indexes components for {facets.systemsWithComponents} systems so far. Try fewer filters, another name, or search all
                    of ATLAS with ⌘K.
                  </>
                }
                action={
                  filtered ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={clearFiltersHref(params)}>Clear filters</Link>
                    </Button>
                  ) : undefined
                }
              />
            ) : params.view === "components" && rows ? (
              <div className="space-y-3">
                <ComponentTable rows={rows} systems={systems} />
                <CatalogPagination params={params} total={facets.matching} />
              </div>
            ) : types && params.layout === "matrix" ? (
              <div className="space-y-3">
                <MatrixLegend />
                <CoverageMatrix result={types} columns={matrixColumns} systems={systems} />
              </div>
            ) : types ? (
              <TypeGroups result={types} systems={systems} scope={scope} filtered={hasComponentLevelFilters(params) || !!params.q} />
            ) : null}
          </div>
        </div>
      </FilterForm>
    </PageContainer>
  );
}
