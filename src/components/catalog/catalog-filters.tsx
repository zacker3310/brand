import { SlidersHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { COMPONENT_GROUPS, FRAMEWORKS, PLATFORMS } from "@/lib/taxonomy";
import type { CatalogFacets, FacetCount, SystemLabel } from "@/server/queries/components";
import { FacetGroup, type FacetOption } from "./facets";
import { ResponsiveFilters } from "./filter-form";
import { ariaPatternLabel } from "./lib/apg";
import { activeFilterCount, clearFiltersHref, type CatalogParams } from "./lib/params";

const GROUP_NAMES = new Map(COMPONENT_GROUPS.map((g, i) => [g.slug, { name: g.name, order: i }]));
const FRAMEWORK_NAMES = new Map(FRAMEWORKS.map((f) => [f.slug, f.name]));
const PLATFORM_NAMES = new Map(PLATFORMS.map((p) => [p.slug, p.name]));

const CLASS_LABELS: Record<string, { label: string; hint: string; order: number }> = {
  verified: { label: "Verified", hint: "The official source identifies the pattern", order: 0 },
  inferred: { label: "Inferred", hint: "Matched by ATLAS heuristics", order: 1 },
  conflicting: { label: "Conflicting", hint: "Sources disagree", order: 2 },
  unverified: { label: "Unverified", hint: "Recorded, not yet confirmed", order: 3 },
  unclassified: { label: "Unclassified", hint: "No canonical type", order: 4 },
};

function byCount(a: FacetOption, b: FacetOption) {
  return b.count - a.count || a.label.localeCompare(b.label);
}

function options(list: FacetCount[], selected: string[], label: (v: string, l: string | null) => string): FacetOption[] {
  const seen = new Set(list.map((x) => x.value));
  const opts = list.map((x) => ({ value: x.value, label: label(x.value, x.label), count: x.count, selected: selected.includes(x.value) }));
  // A selected value that no longer exists in the data still renders, so it can be unchecked.
  for (const s of selected) if (!seen.has(s)) opts.push({ value: s, label: label(s, null), count: 0, selected: true });
  return opts;
}

export function CatalogFilters({
  params,
  facets,
  systems,
}: {
  params: CatalogParams;
  facets: CatalogFacets;
  systems: Map<string, SystemLabel>;
}) {
  const active = activeFilterCount(params) - (params.q ? 1 : 0);
  const idPrefix = "f";

  const systemOpts = options(facets.system, params.systems, (v, l) => systems.get(v)?.name ?? l ?? v).sort(byCount);

  const groupOpts: FacetOption[] = [
    {
      value: "",
      label: "All groups",
      count: facets.groupAll,
      selected: !params.group,
    },
    ...options(facets.group, params.group ? [params.group] : [], (v) => GROUP_NAMES.get(v)?.name ?? v).sort(
      (a, b) => (GROUP_NAMES.get(a.value)?.order ?? 99) - (GROUP_NAMES.get(b.value)?.order ?? 99),
    ),
  ];

  const fwOpts = options(facets.framework, params.frameworks, (v) => FRAMEWORK_NAMES.get(v) ?? v).sort(byCount);
  const plOpts = options(facets.platform, params.platforms, (v) => PLATFORM_NAMES.get(v) ?? v).sort(byCount);
  const patternOpts = options(facets.pattern, params.patterns, (v) => ariaPatternLabel(v)).sort(byCount);
  const a11yOpts = options(facets.a11y, params.a11y ? ["documented"] : [], () => "A11y or keyboard documented");
  const hasLabels: Record<string, string> = { source: "Source code link", props: "Props / API extracted" };
  const hasOpts = options(facets.has, params.has, (v) => hasLabels[v] ?? v);
  const classOpts = options(facets.class, params.classification, (v) => CLASS_LABELS[v]?.label ?? v)
    .map((o) => ({ ...o, hint: CLASS_LABELS[o.value]?.hint }))
    .sort((a, b) => (CLASS_LABELS[a.value]?.order ?? 9) - (CLASS_LABELS[b.value]?.order ?? 9));

  return (
    <ResponsiveFilters
      summary={
        <>
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontalIcon className="size-4 text-muted-foreground" aria-hidden />
            Filters
            {active > 0 && (
              <span className="tabular rounded-full bg-primary px-1.5 py-0.5 text-[11px] leading-none text-primary-foreground">{active}</span>
            )}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            <span className="group-open/filters:hidden">Show</span>
            <span className="hidden group-open/filters:inline">Hide</span>
          </span>
        </>
      }
    >
      <div className="space-y-6 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-2 lg:pb-8">
        <div className="flex items-center justify-between px-2">
          <h2 className="text-sm font-semibold">Filters</h2>
          {active > 0 && (
            <Link href={clearFiltersHref(params)} className="text-xs text-muted-foreground hover:text-foreground">
              Clear all
            </Link>
          )}
        </div>
        <FacetGroup legend="System" name="system" options={systemOpts} idPrefix={idPrefix} visible={10} />
        <FacetGroup legend="Group" name="group" type="radio" options={groupOpts} idPrefix={idPrefix} visible={11} />
        <FacetGroup legend="Framework" name="framework" options={fwOpts} idPrefix={idPrefix} />
        <FacetGroup legend="Platform" name="platform" options={plOpts} idPrefix={idPrefix} description="Platforms the system supports (system-level)." />
        <FacetGroup
          legend="Interaction pattern"
          name="pattern"
          options={patternOpts}
          idPrefix={idPrefix}
          visible={6}
          description="WAI-ARIA reference ATLAS assigns to the canonical type."
        />
        <FacetGroup legend="Accessibility" name="a11y" options={a11yOpts} idPrefix={idPrefix} />
        <FacetGroup legend="Source availability" name="has" options={hasOpts} idPrefix={idPrefix} />
        <FacetGroup legend="Classification" name="class" options={classOpts} idPrefix={idPrefix} />
        <noscript>
          <div className="px-2">
            <Button type="submit" size="sm" className="w-full">
              Apply filters
            </Button>
          </div>
        </noscript>
      </div>
    </ResponsiveFilters>
  );
}
