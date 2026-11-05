import { BookmarkIcon, ChevronDownIcon, DownloadIcon, InfoIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer, PageHeader } from "@/components/atlas/page-header";
import { SystemMark } from "@/components/atlas/system-mark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { buildComponentMatrix, componentHref } from "@/lib/scoring/matrix";
import { componentCompareHref, defaultComparisonTitle, type ComponentCompareParams } from "@/lib/scoring/params";
import { getCompareOptions, getComparisonBySlug, getComponentComparison } from "@/server/queries/compare";
import { CompareIndexView } from "./compare-index-view";
import { ComparisonMatrix } from "./comparison-matrix";
import { ComponentCompareForm } from "./component-compare-form";
import { ComponentPickSelect } from "./component-pick-select";
import { CoverageLegend } from "./legend";
import { DiffToggle, MatrixRoot } from "./matrix-controls";
import { ShareButton } from "./share-button";
import { SourcesCredit } from "./sources-credit";

const exportHref = (type: string, systems: string[], picks: Record<string, string>, format: "json" | "csv") => {
  const base = componentCompareHref({ type, systems, picks }).replace(/^\/compare\?/, "");
  return `/api/comparisons/export?kind=component&${base}&format=${format}`;
};

export async function ComponentComparisonView({ params: p }: { params: ComponentCompareParams }) {
  const data = await getComponentComparison({ type: p.type!, systems: p.systems, picks: p.picks });
  if (!data) notFound();
  if (data.columns.length < 2) {
    const missing = data.unknownSystems.length ? `Not in the registry: ${data.unknownSystems.join(", ")}. ` : "";
    return <CompareIndexView type={data.type.slug} systems={data.columns.map((c) => c.system.slug)} error={`${missing}Select at least two systems.`} />;
  }

  const [options, saved] = await Promise.all([getCompareOptions(), p.saved ? getComparisonBySlug(p.saved) : Promise.resolve(null)]);
  const matrix = buildComponentMatrix(data.type, data.columns);
  const systems = data.columns.map((c) => c.system.slug);
  // Effective picks: what each column actually shows (so share/export/links reproduce this view).
  const picks: Record<string, string> = {};
  for (const c of data.columns) if (c.component && c.candidates.length > 1) picks[c.system.slug] = c.component.slug;
  const typeOpt = options.types.find((t) => t.slug === data.type.slug);
  const implementing = typeOpt?.systemCount ?? 0;
  const title = defaultComparisonTitle(data.type.name, data.columns.map((c) => c.system.name));
  const links = {
    type: data.type.slug,
    systems,
    picks,
    diffOnly: p.diffOnly,
    propsToggleHref: componentCompareHref({ type: data.type.slug, systems, picks, diffOnly: p.diffOnly, allProps: !p.allProps }),
  };
  const withComponents = data.columns.filter((c) => c.component).length;

  return (
    <PageContainer>
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/compare">Compare</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={`/components/${data.type.slug}`}>{data.type.name}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{data.columns.length} systems</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        eyebrow={<span className="text-muted-foreground">{`Component comparison${data.type.group ? ` · ${data.type.group}` : ""}`}</span>}
        display
        title={data.type.name}
        description={
          <>
            <span className="text-foreground/85">{data.type.description}</span>{" "}
            <span className="text-sm text-muted-foreground">
              ATLAS canonical definition. {implementing} indexed system{implementing === 1 ? "" : "s"} implement{implementing === 1 ? "s" : ""} it;{" "}
              {withComponents} of the {data.columns.length} compared {data.columns.length === 1 ? "has" : "have"} an indexed component.
            </span>
          </>
        }
        actions={
          <>
            <ShareButton payload={{ type: data.type.slug, systems, picks }} defaultTitle={saved?.title ?? title} />
            <div className="flex items-center rounded-md border shadow-xs" role="group" aria-label="Download comparison">
              <a href={exportHref(data.type.slug, systems, picks, "json")} download className="inline-flex h-8 items-center gap-1.5 px-2.5 text-sm font-medium hover:bg-accent">
                <DownloadIcon className="size-4" aria-hidden />
                JSON
              </a>
              <span className="h-5 w-px bg-border" aria-hidden />
              <a href={exportHref(data.type.slug, systems, picks, "csv")} download className="inline-flex h-8 items-center px-2.5 text-sm font-medium hover:bg-accent">
                CSV
              </a>
            </div>
          </>
        }
      />

      <div className="mt-6 space-y-4">
        {saved && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-surface-1/60 px-4 py-2.5 text-sm">
            <BookmarkIcon className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">{saved.title}</span>
            <span className="text-xs text-muted-foreground">
              Saved comparison · {new Date(saved.createdAt).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })} · shows current ATLAS data
            </span>
          </div>
        )}
        {(data.unknownSystems.length > 0 || p.dropped.length > 0) && (
          <Alert>
            <InfoIcon aria-hidden />
            <AlertTitle>Some systems were left out</AlertTitle>
            <AlertDescription>
              {data.unknownSystems.length > 0 && <span>Not in the ATLAS registry: {data.unknownSystems.join(", ")}. </span>}
              {p.dropped.length > 0 && <span>Comparisons hold at most 5 systems; dropped {p.dropped.join(", ")}.</span>}
            </AlertDescription>
          </Alert>
        )}

        <details className="group/edit rounded-lg border bg-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex -space-x-1.5" aria-hidden>
                {data.columns.map((c) => (
                  <SystemMark key={c.system.slug} name={c.system.name} slug={c.system.slug} size="sm" className="size-6 text-[9px] ring-2 ring-card" />
                ))}
              </span>
              <span className="truncate">Change type or systems</span>
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open/edit:rotate-180" aria-hidden />
          </summary>
          <div className="border-t px-4 py-5">
            <ComponentCompareForm
              types={options.types.map((t) => ({ slug: t.slug, name: t.name, group: t.group, groupName: t.groupName, systemCount: t.systemCount, systems: t.systems }))}
              systems={options.systems}
              initialType={data.type.slug}
              initialSystems={systems}
              submitLabel="Update comparison"
            />
          </div>
        </details>

        {/* Mobile: which component fills each column (desktop has this in the sticky header). */}
        <section aria-label="Compared components" className="space-y-2 lg:hidden">
          <h2 className="type-eyebrow text-muted-foreground">Compared components</h2>
          <ul className="divide-y rounded-lg border bg-card">
            {data.columns.map((c) => (
              <li key={c.system.slug} className="flex items-center gap-3 px-3 py-2.5">
                <SystemMark name={c.system.name} slug={c.system.slug} size="sm" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-xs text-muted-foreground">{c.system.name}</p>
                  {c.component && c.candidates.length > 1 ? (
                    <ComponentPickSelect
                      idPrefix="mpick"
                      system={c.system.slug}
                      systemName={c.system.name}
                      type={data.type.slug}
                      systems={systems}
                      picks={picks}
                      value={c.component.slug}
                      options={c.candidates.map((x) => ({ slug: x.slug, name: x.name, lifecycle: x.lifecycle }))}
                      diffOnly={p.diffOnly}
                    />
                  ) : c.component ? (
                    <Link href={componentHref(c.system.slug, c.component.slug)} className="block truncate text-sm font-semibold hover:underline">
                      {c.component.name}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium text-muted-foreground">Not in ATLAS index</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="matrix-title" className="mt-8">
        <h2 id="matrix-title" className="sr-only">
          Comparison
        </h2>
        <MatrixRoot initialDiffOnly={p.diffOnly} initialAllProps={p.allProps} rowCount={matrix.rowCount} differingCount={matrix.differingRowCount}>
          <div className="mb-4 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <DiffToggle
                hrefToggle={componentCompareHref({ type: data.type.slug, systems, picks, diffOnly: !p.diffOnly, allProps: p.allProps })}
                differingCount={matrix.differingRowCount}
                rowCount={matrix.rowCount}
              />
              <p className="hidden text-xs text-muted-foreground sm:block">Hover or focus any status chip for its meaning.</p>
            </div>
            <nav aria-label="Comparison sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              {(["g", "m"] as const).map((prefix) => (
                <ul key={prefix} className={prefix === "g" ? "hidden flex-wrap gap-1.5 lg:flex" : "flex w-max gap-1.5 lg:hidden"}>
                  {matrix.groups.map((g) => (
                    <li key={g.id} className={g.allSame ? "group-data-[diff=on]/matrix:hidden" : undefined}>
                      <a
                        href={`#${prefix}-${g.id}`}
                        className="inline-flex h-7 items-center rounded-full border px-2.5 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        {g.title}
                      </a>
                    </li>
                  ))}
                </ul>
              ))}
            </nav>
            <CoverageLegend />
          </div>
          <ComparisonMatrix matrix={matrix} columns={data.columns} links={links} typeName={data.type.name} />
        </MatrixRoot>
      </section>

      <div className="mt-12">
        <SourcesCredit
          items={data.columns.map((c) => ({
            slug: c.system.slug,
            name: c.system.name,
            url: c.component?.docsUrl ?? c.system.docsUrl ?? c.system.homepageUrl,
            retrievedAt: c.component?.evidence.lastRetrievedAt ?? c.system.lastIngestedAt,
            note: c.component ? undefined : "no indexed component",
          }))}
        />
      </div>
    </PageContainer>
  );
}
