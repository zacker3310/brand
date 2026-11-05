import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShapesIcon } from "lucide-react";
import { EmptyState, PageContainer, PageHeader, Section, SourceLink } from "@/components/atlas";
import { PatternCard } from "@/components/patterns/parts";
import { formatCount, hostname } from "@/lib/utils";
import { listSystemPatterns } from "@/server/queries/patterns";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const r = await listSystemPatterns(slug);
  if (!r) return { title: "System not found" };
  return { title: `${r.system.name} patterns`, description: `UX patterns documented by ${r.system.name}, mapped onto ATLAS pattern types.` };
}

export default async function SystemPatternsPage({ params }: Props) {
  const { slug } = await params;
  const r = await listSystemPatterns(slug);
  if (!r) notFound();
  const { system, patterns } = r;
  const classified = patterns.filter((p) => p.type);
  const unclassified = patterns.filter((p) => !p.type);
  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <Link href={`/systems/${encodeURIComponent(system.slug)}`} className="hover:text-foreground">
            {system.name}
          </Link>
        }
        title="Patterns"
        display
        description={
          patterns.length ? (
            <>
              {formatCount(patterns.length)} documented patterns, {formatCount(classified.length)} mapped to an ATLAS type.
              {system.docsUrl && (
                <>
                  {" "}
                  Data from <SourceLink href={system.docsUrl} className="text-[15px]">{hostname(system.docsUrl)}</SourceLink>.
                </>
              )}
            </>
          ) : undefined
        }
      />
      {patterns.length === 0 ? (
        <EmptyState
          className="mt-10"
          icon={ShapesIcon}
          title={`No patterns extracted for ${system.name}`}
          description={`ATLAS has not ingested pattern documentation for this system (ingestion status: ${system.ingestionStatus.replace(/_/g, " ")}). That is unknown, not an absence of patterns.`}
          action={
            <Link href="/patterns" className="text-sm text-primary hover:underline">
              Browse the pattern library
            </Link>
          }
        />
      ) : (
        <div className="mt-10 space-y-14">
          {classified.length > 0 && (
            <Section id="classified" title="Mapped to ATLAS pattern types" description="Grouped under the ATLAS type each maps to; the mapping is labelled inferred where ATLAS made it.">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {classified.map((p) => (
                  <PatternCard key={p.id} p={p} showType />
                ))}
              </div>
            </Section>
          )}
          {unclassified.length > 0 && (
            <Section id="unclassified" title="Unclassified" description="Documented patterns whose names match no ATLAS pattern type. Shown as the system names them.">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {unclassified.map((p) => (
                  <PatternCard key={p.id} p={p} />
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </PageContainer>
  );
}
