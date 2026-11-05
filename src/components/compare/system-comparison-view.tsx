import { BookmarkIcon, ChevronDownIcon, DownloadIcon, InfoIcon, ScaleIcon } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageContainer, PageHeader } from "@/components/atlas/page-header";
import { SystemMark } from "@/components/atlas/system-mark";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { CONFIDENCE_NOTE, RUBRIC_DEFINITIONS } from "@/lib/scoring/definitions";
import { MIN_SYSTEMS, defaultComparisonTitle, systemCompareHref, type SystemCompareParams } from "@/lib/scoring/params";
import { scoreSystem } from "@/lib/scoring/rubrics";
import { CRITERIA } from "@/lib/scoring/types";
import { getCompareOptions, getComparisonBySlug, getSystemComparison, indexedSystemSlugs } from "@/server/queries/compare";
import { CriterionDetails } from "./criterion-details";
import { Scorecard, type ScoredSystem } from "./scorecard";
import { ShareButton } from "./share-button";
import { SourcesCredit } from "./sources-credit";
import { SystemCompareForm } from "./system-compare-form";

const criteriaChoices = CRITERIA.map((id) => ({ id, label: RUBRIC_DEFINITIONS[id].label, short: RUBRIC_DEFINITIONS[id].short }));

export async function SystemComparisonView({ params: p }: { params: SystemCompareParams }) {
  const [options, cmp, saved] = await Promise.all([
    getCompareOptions(),
    getSystemComparison(p.systems),
    p.saved ? getComparisonBySlug(p.saved) : Promise.resolve(null),
  ]);
  const names = new Map(options.systems.map((s) => [s.slug, s.name]));
  const indexed = indexedSystemSlugs(options.systems);
  const ready = cmp.entries.length >= MIN_SYSTEMS;
  const asOf = new Date();
  const scored: ScoredSystem[] = cmp.entries.map((e) => ({
    slug: e.info.slug,
    name: e.info.name,
    ingestionStatus: e.info.ingestionStatus,
    results: scoreSystem(e.metrics, p.criteria, { asOf, taxonomySize: cmp.taxonomySize }),
  }));
  const systems = cmp.entries.map((e) => e.info.slug);
  const exportBase = `/api/comparisons/export?kind=system&${systemCompareHref({ systems, criteria: p.criteria }).split("?")[1] ?? ""}`;
  const error = p.systems.length > 0 && !ready ? `${cmp.unknown.length ? `Not in the registry: ${cmp.unknown.join(", ")}. ` : ""}Select at least ${MIN_SYSTEMS} systems.` : null;
  const scorable = scored.reduce((n, s) => n + s.results.filter((r) => r.score !== null).length, 0);
  const total = scored.length * p.criteria.length;

  const form = (
    <SystemCompareForm
      systems={options.systems}
      criteria={criteriaChoices}
      initialSystems={ready ? systems : p.systems}
      initialCriteria={p.criteria}
      submitLabel={ready ? "Update comparison" : "Compare systems"}
      error={error}
    />
  );

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
            <BreadcrumbPage>Systems</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        eyebrow="System comparison"
        display
        title={ready ? scored.map((s) => s.name).join(" · ") : "Compare design systems"}
        description={
          <>
            Evidence-based rubrics. Each score uses only inputs ATLAS has observed and shows how much evidence it rests on. Thin evidence reads
            “Insufficient data”, never a low score, and systems known only from registry metadata are not scored on component or token data.
          </>
        }
        actions={
          ready ? (
            <>
              <ShareButton payload={{ type: null, systems, criteria: p.criteria.length < CRITERIA.length ? p.criteria : [] }} defaultTitle={saved?.title ?? defaultComparisonTitle(null, scored.map((s) => s.name))} />
              <div className="flex items-center rounded-md border shadow-xs" role="group" aria-label="Download comparison">
                <a href={`${exportBase}&format=json`} download className="inline-flex h-8 items-center gap-1.5 px-2.5 text-sm font-medium hover:bg-accent">
                  <DownloadIcon className="size-4" aria-hidden />
                  JSON
                </a>
                <span className="h-5 w-px bg-border" aria-hidden />
                <a href={`${exportBase}&format=csv`} download className="inline-flex h-8 items-center px-2.5 text-sm font-medium hover:bg-accent">
                  CSV
                </a>
              </div>
            </>
          ) : undefined
        }
      />

      {!ready ? (
        <div className="mt-8 space-y-8">
          <section aria-labelledby="sys-picker" className="rounded-xl border bg-card p-4 shadow-xs sm:p-6">
            <h2 id="sys-picker" className="mb-5 text-base font-semibold tracking-tight">
              Choose systems and criteria
            </h2>
            {form}
          </section>
          {indexed.length >= MIN_SYSTEMS && (
            <EmptyState
              icon={ScaleIcon}
              title="Start with the systems ATLAS has indexed"
              description={`Component and token criteria need indexed data. ${indexed.map((s) => names.get(s) ?? s).join(", ")} have it today.`}
              action={
                <Link href={systemCompareHref({ systems: indexed })} className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
                  <span className="flex -space-x-1.5" aria-hidden>
                    {indexed.map((s) => (
                      <SystemMark key={s} name={names.get(s) ?? s} slug={s} size="sm" className="size-5 text-[8px] ring-2 ring-background" />
                    ))}
                  </span>
                  Compare these {indexed.length}
                </Link>
              }
            />
          )}
        </div>
      ) : (
        <>
          <div className="mt-6 space-y-4">
            {saved && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-surface-1/60 px-4 py-2.5 text-sm">
                <BookmarkIcon className="size-4 text-muted-foreground" aria-hidden />
                <span className="font-medium">{saved.title}</span>
                <span className="text-xs text-muted-foreground">Saved comparison · shows current ATLAS data</span>
              </div>
            )}
            {(cmp.unknown.length > 0 || p.dropped.length > 0) && (
              <Alert>
                <InfoIcon aria-hidden />
                <AlertTitle>Some systems were left out</AlertTitle>
                <AlertDescription>
                  {cmp.unknown.length > 0 && <span>Not in the ATLAS registry: {cmp.unknown.join(", ")}. </span>}
                  {p.dropped.length > 0 && <span>Comparisons hold at most 5 systems; dropped {p.dropped.join(", ")}.</span>}
                </AlertDescription>
              </Alert>
            )}
            <details className="group/edit rounded-lg border bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                <span>Change systems or criteria</span>
                <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open/edit:rotate-180" aria-hidden />
              </summary>
              <div className="border-t px-4 py-5">{form}</div>
            </details>
          </div>

          <section aria-labelledby="scorecard-title" className="mt-8 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 id="scorecard-title" className="text-base font-semibold tracking-tight">
                Scorecard
              </h2>
              <p className="tabular text-xs text-muted-foreground">
                {scorable} of {total} scores have enough evidence · as of {asOf.toISOString().slice(0, 10)}
              </p>
            </div>
            <Scorecard systems={scored} criteria={p.criteria} />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {CONFIDENCE_NOTE} No overall ranking is computed: criteria measure different things and evidence differs per system.
            </p>
          </section>

          <section aria-labelledby="evidence-title" className="mt-12 space-y-10">
            <div className="space-y-1 border-b pb-3">
              <h2 id="evidence-title" className="text-base font-semibold tracking-tight">
                Evidence by criterion
              </h2>
              <p className="text-sm text-muted-foreground">Every input, its weight, and whether ATLAS observed it.</p>
            </div>
            {p.criteria.map((c) => (
              <CriterionDetails key={c} criterion={c} systems={scored} />
            ))}
          </section>

          <div className="mt-12">
            <SourcesCredit
              items={cmp.entries.map((e) => ({
                slug: e.info.slug,
                name: e.info.name,
                url: e.info.docsUrl ?? e.info.homepageUrl,
                retrievedAt: e.info.lastIngestedAt,
                note: e.info.ingestionStatus === "indexed" || e.info.ingestionStatus === "partial" ? `${e.metrics.evidence.toLocaleString("en-US")} evidence records` : "registry metadata only",
              }))}
            />
          </div>
        </>
      )}
    </PageContainer>
  );
}
