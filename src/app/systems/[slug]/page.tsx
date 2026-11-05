import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageContainer, Section } from "@/components/atlas";
import { ComponentsSection } from "@/components/discovery/detail/components-section";
import { NotIndexedPanel } from "@/components/discovery/detail/not-indexed";
import {
  AccessibilitySection,
  ChangesSection,
  EvidenceSection,
  FrameworksSection,
  PatternsSection,
  RegistrySection,
  ResourcesSection,
} from "@/components/discovery/detail/more-sections";
import { OverviewSection, PhilosophySection } from "@/components/discovery/detail/overview";
import { SectionNav, type NavSection } from "@/components/discovery/detail/section-nav";
import { SystemHeader } from "@/components/discovery/detail/system-header";
import { TokensSection } from "@/components/discovery/detail/tokens-section";
import { depthOf } from "@/components/discovery/lib/directory";
import { formatDate, plural } from "@/components/discovery/lib/format";
import { positiveInt, type RawSearchParams } from "@/components/discovery/lib/params";
import { getSystemChanges, getSystemDetail, getSystemMeta } from "@/server/queries/systems";

const SECTION_CLS = "scroll-mt-32 lg:scroll-mt-24";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const meta = await getSystemMeta(slug);
  if (!meta) return { title: "Design system not found", robots: { index: false } };
  return {
    title: meta.name,
    description: meta.summary ?? `${meta.name}${meta.organization ? ` by ${meta.organization}` : ""}: components, tokens, patterns and verified facts in ATLAS.`,
  };
}

export default async function SystemDetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const detail = await getSystemDetail(slug);
  if (!detail) notFound();
  const changesPage = positiveInt(sp, "changes", 1, 500);
  const changes = await getSystemChanges(detail.core.id, changesPage);

  const { core, counts } = detail;
  const deep = depthOf(core.ingestionStatus) !== "metadata" || counts.components + counts.tokens + counts.patterns > 0;
  const hasA11y = detail.accessibility.components > 0;

  const sections: NavSection[] = [
    { id: "overview", label: "Overview" },
    { id: "philosophy", label: "Philosophy" },
    ...(deep
      ? [
          { id: "components", label: "Components", count: counts.components },
          { id: "tokens", label: "Tokens", count: counts.tokens },
          { id: "patterns", label: "Patterns", count: counts.patterns },
          { id: "accessibility", label: "Accessibility" },
        ]
      : [{ id: "deep-index", label: "Deep index" }]),
    { id: "frameworks", label: "Frameworks", count: detail.frameworks.length },
    { id: "resources", label: "Resources", count: counts.sources },
    { id: "changes", label: "Change history", count: changes.total },
    { id: "evidence", label: "Evidence", count: counts.evidence },
    { id: "registry", label: "Registry notes" },
  ];

  const notExtractedNote = (what: string) => (
    <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
      The {core.adapterId ? `${core.adapterId} adapter` : "adapter"} has not extracted {what} for {core.name}. This is unknown, not an absence in the system.
    </p>
  );

  return (
    <PageContainer className="space-y-8">
      <SystemHeader detail={detail} />
      <div className="lg:grid lg:grid-cols-[176px_minmax(0,1fr)] lg:gap-10">
        <div className="sticky top-14 z-20 -mx-4 border-b border-border/70 bg-background/90 backdrop-blur sm:-mx-6 lg:top-20 lg:mx-0 lg:self-start lg:border-0 lg:bg-transparent lg:backdrop-blur-none">
          <SectionNav sections={sections} />
        </div>
        <div className="min-w-0 space-y-14 pt-6 lg:pt-0">
          <Section className={SECTION_CLS} id="overview" title="Overview" description="Registry facts with the evidence each one was verified against.">
            <OverviewSection detail={detail} />
          </Section>

          <Section className={SECTION_CLS} id="philosophy" title="Philosophy & principles">
            <PhilosophySection detail={detail} />
          </Section>

          {deep ? (
            <>
              <Section
                className={SECTION_CLS}
                id="components"
                title="Components"
                description={`${plural(counts.components, "component")} grouped by ATLAS taxonomy. Canonical types marked Inferred were matched heuristically.`}
              >
                {counts.components ? <ComponentsSection systemSlug={core.slug} components={detail.components} /> : notExtractedNote("components")}
              </Section>
              <Section className={SECTION_CLS} id="tokens" title="Tokens" description={counts.tokens ? `${plural(counts.tokens, "token")} across ${plural(counts.tokenSets, "set")}.` : undefined}>
                {counts.tokens ? <TokensSection detail={detail} /> : notExtractedNote("design tokens")}
              </Section>
              <Section className={SECTION_CLS} id="patterns" title="Patterns" description={counts.patterns ? `${plural(counts.patterns, "documented pattern")}.` : undefined}>
                {counts.patterns ? <PatternsSection detail={detail} /> : notExtractedNote("UX patterns")}
              </Section>
              <Section className={SECTION_CLS} id="accessibility" title="Accessibility" description="Aggregated from component-level documentation. Coverage states distinguish undocumented from not yet extracted.">
                {hasA11y ? <AccessibilitySection detail={detail} /> : notExtractedNote("accessibility guidance")}
              </Section>
            </>
          ) : (
            <Section className={SECTION_CLS} id="deep-index" title="Deep index" description="Components, tokens, patterns and accessibility guidance.">
              <NotIndexedPanel detail={detail} />
            </Section>
          )}

          <Section className={SECTION_CLS} id="frameworks" title="Framework support" description="Official and community implementations, with how each claim was verified.">
            <FrameworksSection detail={detail} />
          </Section>

          <Section className={SECTION_CLS} id="resources" title="Resources" description="Every source ATLAS knows for this system, with its last check.">
            <ResourcesSection detail={detail} />
          </Section>

          <Section className={SECTION_CLS} id="changes" title="Change history" description={changes.total ? `${plural(changes.total, "change event")}, newest first.` : undefined}>
            <ChangesSection slug={core.slug} changes={changes} />
          </Section>

          <Section className={SECTION_CLS} id="evidence" title="Evidence" description={`${plural(counts.evidence, "evidence record")} for this system across all record kinds.`}>
            <EvidenceSection detail={detail} />
          </Section>

          <Section className={SECTION_CLS} id="registry" title="Registry notes" description="Why this system is in the registry and how it relates to other entries.">
            <RegistrySection detail={detail} />
          </Section>

          <p className="border-t border-border/70 pt-4 text-xs text-muted-foreground">
            Data from {detail.evidenceHosts.map((h) => h.host).join(", ") || "official sources"}
            {detail.lastRetrievedAt && <> · retrieved {formatDate(detail.lastRetrievedAt)}</>}. ATLAS stores facts, short excerpts and hashes, and links to the official documentation.
          </p>
        </div>
      </div>
    </PageContainer>
  );
}
