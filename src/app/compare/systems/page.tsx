import type { Metadata } from "next";
import { SystemComparisonView } from "@/components/compare/system-comparison-view";
import { MIN_SYSTEMS, parseSystemCompareParams, type SearchParamsRecord } from "@/lib/scoring/params";
import { resolveSystems } from "@/server/queries/compare";

type Props = { searchParams: Promise<SearchParamsRecord> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const p = parseSystemCompareParams(await searchParams);
  if (p.systems.length >= MIN_SYSTEMS) {
    const sys = await resolveSystems(p.systems);
    if (sys.found.length >= MIN_SYSTEMS) {
      const names = sys.found.map((s) => s.name);
      return {
        title: `${names.join(" vs ")} · System comparison`,
        description: `Evidence-based comparison of ${names.join(", ")}: component coverage, accessibility documentation, frameworks, tokens, theming and maintenance, with confidence and evidence coverage per score.`,
      };
    }
  }
  return {
    title: "System comparison",
    description: "Compare design systems with evidence-based rubrics. Scores use only observed inputs and show their confidence and evidence coverage.",
  };
}

export default async function SystemComparePage({ searchParams }: Props) {
  const p = parseSystemCompareParams(await searchParams);
  return <SystemComparisonView params={p} />;
}
