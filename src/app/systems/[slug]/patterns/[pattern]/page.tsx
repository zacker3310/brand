import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRightIcon } from "lucide-react";
import { CoverageChip, EvidenceList, PageContainer, PageHeader, Section, SourceLink, SystemMark } from "@/components/atlas";
import { formatDate } from "@/components/tokens/explorer-chrome";
import { classificationInfo, componentHref, docsSection, patternHref, patternTypeHref } from "@/components/patterns/lib";
import { ClassificationBadge } from "@/components/patterns/parts";
import type { CoverageState } from "@/lib/contracts";
import { formatCount, hostname } from "@/lib/utils";
import { getSystemPattern } from "@/server/queries/patterns";
import { EntityActions } from "@/components/collections/entity-actions";

type Props = { params: Promise<{ slug: string; pattern: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, pattern } = await params;
  const p = await getSystemPattern(slug, pattern);
  if (!p) return { title: "Pattern not found" };
  return { title: `${p.name} · ${p.system.name}`, description: p.description?.slice(0, 200) ?? `${p.name} pattern as documented by ${p.system.name}.` };
}

export default async function SystemPatternPage({ params }: Props) {
  const { slug, pattern } = await params;
  const p = await getSystemPattern(slug, pattern);
  if (!p) notFound();
  const info = classificationInfo(p);
  const descState = (p.coverage.description as CoverageState | undefined) ?? (p.description ? "documented" : "not-extracted");
  const compState = (p.coverage.components as CoverageState | undefined) ?? "not-extracted";
  const retrieved = formatDate(p.retrievedAt);
  const section = docsSection(p.docsUrl);
  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
            <Link href={`/systems/${encodeURIComponent(p.system.slug)}`} className="text-muted-foreground hover:text-foreground">
              {p.system.name}
            </Link>
            <span aria-hidden>/</span>
            <Link href={`/systems/${encodeURIComponent(p.system.slug)}/patterns`} className="text-muted-foreground hover:text-foreground">
              Patterns
            </Link>
          </span>
        }
        title={p.name}
        display
        actions={
          p.docsUrl ? (
            <SourceLink href={p.docsUrl} showHost>
              Official guidance
            </SourceLink>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <EntityActions entityType="pattern" entityId={p.id} label={`${p.name} (${p.system.name})`} />
          <SystemMark name={p.system.name} slug={p.system.slug} size="sm" />
          <ClassificationBadge p={p} />
          {p.type ? (
            <Link href={patternTypeHref(p.type.slug)} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-accent">
              ATLAS type: {p.type.name} <ArrowRightIcon className="size-3" aria-hidden />
            </Link>
          ) : null}
          {section && <span className="font-mono text-[11px] text-muted-foreground">{section}</span>}
        </div>
      </PageHeader>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-12">
          <Section id="summary" title="Summary" actions={<CoverageChip state={descState} />}>
            {p.description ? (
              <blockquote className="border-l-2 pl-4 text-[15px] leading-relaxed text-foreground/90">
                {p.description}
                <footer className="mt-2 text-xs text-muted-foreground">
                  Excerpt from {p.docsUrl ? <SourceLink href={p.docsUrl} className="text-xs">{hostname(p.docsUrl)}</SourceLink> : p.system.name}
                  {retrieved ? ` · retrieved ${retrieved}` : ""}
                </footer>
              </blockquote>
            ) : (
              <p className="text-sm text-muted-foreground">No summary was extracted for this pattern.</p>
            )}
          </Section>

          <Section
            id="components"
            title="Related components"
            description={p.components.length ? `${formatCount(p.components.length)} ${p.system.name} components the pattern page references.` : undefined}
            actions={<CoverageChip state={compState} />}
          >
            {p.components.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {compState === "not-documented"
                  ? "The pattern page does not reference specific components."
                  : compState === "documented"
                    ? "The page references components, but none of them is in the index yet."
                    : "Related components have not been extracted for this pattern."}
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {p.components.map((c) => (
                  <li key={c.slug}>
                    <Link href={componentHref(p.system.slug, c.slug)} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-accent/40">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{c.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{c.typeName ? `ATLAS type: ${c.typeName}` : "Unclassified component"}</span>
                      </span>
                      <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="evidence" title="Evidence" description="Where each fact on this page comes from.">
            <EvidenceList rows={p.evidence} emptyLabel="No evidence recorded for this pattern." />
          </Section>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start" aria-label="Classification">
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <p className="type-eyebrow text-muted-foreground">Classification</p>
            <p className="text-sm font-medium">{p.type ? p.type.name : "Not mapped to a type"}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{info.detail}</p>
          </div>
          {p.type && (
            <div className="space-y-3 rounded-xl border bg-card p-4">
              <p className="type-eyebrow text-muted-foreground">{p.type.name} elsewhere</p>
              {p.siblings.length ? (
                <ul className="space-y-2">
                  {p.siblings.map((s) => (
                    <li key={`${s.system.slug}-${s.slug}`}>
                      <Link href={patternHref(s.system.slug, s.slug)} className="flex items-center gap-2 text-sm hover:underline">
                        <SystemMark name={s.system.name} slug={s.system.slug} size="sm" className="size-6 text-[9px]" />
                        <span className="min-w-0">
                          <span className="block truncate">{s.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{s.system.name}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No other indexed system documents this pattern type yet.</p>
              )}
              <Link href={patternTypeHref(p.type.slug)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                Compare across systems <ArrowRightIcon className="size-3" aria-hidden />
              </Link>
            </div>
          )}
        </aside>
      </div>
    </PageContainer>
  );
}
