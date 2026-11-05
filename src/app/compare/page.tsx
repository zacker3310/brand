import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompareIndexView } from "@/components/compare/compare-index-view";
import { ComponentComparisonView } from "@/components/compare/component-comparison-view";
import { MIN_SYSTEMS, parseComponentCompareParams, type SearchParamsRecord } from "@/lib/scoring/params";
import { getTypeRef, resolveSystems } from "@/server/queries/compare";

type Props = { searchParams: Promise<SearchParamsRecord> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const p = parseComponentCompareParams(await searchParams);
  if (p.type && p.systems.length >= MIN_SYSTEMS) {
    const [type, sys] = await Promise.all([getTypeRef(p.type), resolveSystems(p.systems)]);
    if (type && sys.found.length >= MIN_SYSTEMS) {
      const names = sys.found.map((s) => s.name);
      return {
        title: `${type.name}: ${names.join(" vs ")}`,
        description: `${type.name} compared across ${names.join(", ")}: names, variants, states, props, accessibility, tokens and documentation, with source provenance.`,
      };
    }
  }
  return {
    title: "Compare implementations",
    description: "Compare how design systems implement a component, side by side, with every gap labelled as not documented, documented as none, or not extracted.",
  };
}

export default async function ComparePage({ searchParams }: Props) {
  const p = parseComponentCompareParams(await searchParams);
  if (p.type) {
    const type = await getTypeRef(p.type);
    if (!type) notFound();
    if (p.systems.length >= MIN_SYSTEMS) return <ComponentComparisonView params={p} />;
    return <CompareIndexView type={p.type} systems={p.systems} error={p.systems.length ? `Select at least ${MIN_SYSTEMS} systems.` : null} />;
  }
  return <CompareIndexView type={null} systems={p.systems} error={p.systems.length >= MIN_SYSTEMS ? "Choose a component type to compare." : null} />;
}
