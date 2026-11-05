import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShapesIcon } from "lucide-react";
import { CoverageChip, EmptyState, PageContainer, PageHeader, Section, SourceLink, SystemMark } from "@/components/atlas";
import { docsSection, patternHref } from "@/components/patterns/lib";
import { ClassificationBadge, ComponentChips, PatternCard } from "@/components/patterns/parts";
import type { CoverageState } from "@/lib/contracts";
import { formatCount } from "@/lib/utils";
import { getPatternType } from "@/server/queries/patterns";

type Props = { params: Promise<{ type: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type } = await params;
  const t = await getPatternType(type);
  if (!t) return { title: "Pattern type not found" };
  return { title: `${t.name} pattern`, description: `${t.description} How ${t.patterns.length ? `${new Set(t.patterns.map((p) => p.system.slug)).size} indexed design systems document it` : "design systems document it"}, with links to their official guidance.` };
}

export default async function PatternTypePage({ params }: Props) {
  const { type } = await params;
  const t = await getPatternType(type);
  if (!t) notFound();
  const systems = [...new Map(t.patterns.map((p) => [p.system.slug, p.system])).values()];
  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <Link href="/patterns" className="text-muted-foreground hover:text-foreground">
            Pattern library
          </Link>
        }
        title={t.name}
        display
        description={
          <>
            {t.description}{" "}
            <span
              className="inline-flex translate-y-[-2px] items-center rounded border px-1.5 py-0.5 align-middle font-mono text-[10.5px] leading-none text-muted-foreground"
              title="ATLAS-authored definition used to group system documentation. Not quoted from any system."
            >
              ATLAS definition
            </span>
          </>
        }
      >
        {t.aliases.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Matched by names such as{" "}
            {t.aliases.slice(0, 6).map((a, i) => (
              <span key={a}>
                <code className="rounded bg-muted px-1 font-mono text-[11px]">{a}</code>
                {i < Math.min(t.aliases.length, 6) - 1 ? " " : ""}
              </span>
            ))}
          </p>
        )}
      </PageHeader>

      {t.patterns.length === 0 ? (
        <EmptyState
          className="mt-10"
          icon={ShapesIcon}
          title={`No indexed system documents ${t.name.toLowerCase()} yet`}
          description="None of the patterns ATLAS has ingested maps to this type. That reflects ATLAS coverage so far, not what design systems document."
          action={
            <Link href="/patterns" className="text-sm text-primary hover:underline">
              Browse all pattern types
            </Link>
          }
        />
      ) : (
        <div className="mt-10 space-y-14">
          <Section
            id="systems"
            title={`Documented by ${formatCount(systems.length)} system${systems.length === 1 ? "" : "s"}`}
            description={`${formatCount(t.patterns.length)} pattern page${t.patterns.length === 1 ? "" : "s"} map to this type. Names, summaries and related components are each system's own.`}
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {t.patterns.map((p) => (
                <PatternCard key={p.id} p={p} />
              ))}
            </div>
          </Section>

          {systems.length >= 2 && (
            <Section id="comparison" title="Side by side" description="How each system scopes this pattern. Coverage chips separate “not documented” from “not extracted”.">
              <div className="relative overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[880px] border-collapse text-left text-sm [&_td]:px-3 [&_td]:py-3 [&_th]:px-3 [&_th]:py-2">
                  <caption className="sr-only">{`${t.name}: documented patterns compared across systems`}</caption>
                  <thead>
                    <tr className="border-b bg-surface-1 text-xs text-muted-foreground">
                      <th scope="col" className="sticky left-0 z-10 bg-surface-1 font-medium">
                        System
                      </th>
                      <th scope="col" className="font-medium">
                        Pattern
                      </th>
                      <th scope="col" className="font-medium">
                        Scope (docs section)
                      </th>
                      <th scope="col" className="font-medium">
                        Related components
                      </th>
                      <th scope="col" className="font-medium">
                        Coverage
                      </th>
                      <th scope="col" className="font-medium">
                        Docs
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.patterns.map((p) => (
                      <tr key={p.id} className="border-b border-border/60 align-top last:border-0">
                        <th scope="row" className="sticky left-0 z-10 bg-card text-left font-normal">
                          <span className="inline-flex items-center gap-2 whitespace-nowrap">
                            <SystemMark name={p.system.name} slug={p.system.slug} size="sm" className="size-6 text-[9px]" />
                            {p.system.name}
                          </span>
                        </th>
                        <td className="min-w-40">
                          <Link href={patternHref(p.system.slug, p.slug)} className="font-medium hover:underline">
                            {p.name}
                          </Link>
                          <div className="mt-1">
                            <ClassificationBadge p={p} />
                          </div>
                        </td>
                        <td className="font-mono text-xs text-muted-foreground">{docsSection(p.docsUrl) ?? "—"}</td>
                        <td className="max-w-sm">
                          <ComponentChips system={p.system.slug} components={p.components} coverage={p.coverage.components as CoverageState | undefined} max={5} />
                        </td>
                        <td>
                          <div className="flex flex-col items-start gap-1">
                            <CoverageChip state={(p.coverage.description as CoverageState | undefined) ?? "not-extracted"} label="Description" />
                            <CoverageChip state={(p.coverage.components as CoverageState | undefined) ?? "not-extracted"} label="Components" />
                          </div>
                        </td>
                        <td className="whitespace-nowrap">
                          {p.docsUrl ? <SourceLink href={p.docsUrl} className="text-xs">Official docs</SourceLink> : <CoverageChip state="not-extracted" label="Docs" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}
        </div>
      )}
    </PageContainer>
  );
}
