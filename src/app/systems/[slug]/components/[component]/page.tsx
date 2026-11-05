import type { Metadata } from "next";
import { CATALOG_SCOPE } from "@/components/catalog/lib/scope";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRightIcon, ArchiveIcon, BookOpenIcon, CodeIcon, PenToolIcon, PanelsTopLeftIcon } from "lucide-react";
import { EvidenceList, SourceLink, SystemMark, PageContainer } from "@/components/atlas";
import { ClassificationBadge, LifecycleBadge } from "@/components/catalog/badges";
import { PropsTable, type PropImplementation } from "@/components/catalog/detail/props-table";
import {
  AccessibilityBlock,
  ChangeHistory,
  ComparableGrid,
  CoveragePanel,
  DetailSection,
  ExamplesBlock,
  FrameworksList,
  Missing,
  RelationshipsBlock,
  SectionNav,
  SizesBlock,
  StatesTable,
  VariantsBlock,
} from "@/components/catalog/detail/sections";
import { TokenUsage } from "@/components/catalog/detail/token-usage";
import { fieldState } from "@/components/catalog/lib/coverage";
import { formatDate, implementationLabel, sortImplementations } from "@/components/catalog/lib/format";
import { normalizeQuery } from "@/components/catalog/lib/params";
import { compareHref, componentTypeHref, patternHref, systemHref, tokensHref } from "@/components/catalog/lib/urls";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { formatCount, hostname } from "@/lib/utils";
import { getComponentDetail, getComponentMeta } from "@/server/queries/components";

type Props = {
  params: Promise<{ slug: string; component: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, component } = await params;
  const meta = await getComponentMeta(slug, component);
  if (!meta) return { title: "Component not found" };
  const what = meta.type_name ? `${meta.system_name}'s ${meta.type_name.toLowerCase()} component` : `A ${meta.system_name} component`;
  return {
    title: `${meta.name} · ${meta.system_name}`,
    description: meta.description ? `${what}. ${meta.description}`.slice(0, 300) : `${what}: props, states, variants, accessibility and tokens, with sources.`,
  };
}

function first(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ComponentDetailPage({ params, searchParams }: Props) {
  const [{ slug, component }, sp] = await Promise.all([params, searchParams]);
  const data = await getComponentDetail(slug, component);
  if (!data) notFound();
  const { component: c, frameworks, variants, states, props, examples, accessibility, relationships, tokens, comparable, evidence, changes, patterns } =
    data;
  const cov = c.coverage;

  // Props grouped per implementation (framework or documented sub-component).
  const implKeys = sortImplementations([...new Set(props.map((p) => p.implementation))]);
  const implementations: PropImplementation[] = implKeys.map((k) => ({
    key: k,
    label: implementationLabel(k).label,
    props: props.filter((p) => p.implementation === k),
  }));

  const descEvidence = evidence.find((e) => e.field === "description") ?? evidence.find((e) => e.field === "*");
  const storybook = examples.find((e) => e.kind === "storybook-link" && e.url)?.url ?? null;
  const figma = frameworks.find((f) => f.slug === "figma" && f.sourceUrl && hostname(f.sourceUrl)?.endsWith("figma.com"))?.sourceUrl ?? null;
  const hosts = [...new Set(evidence.map((e) => hostname(e.sourceUrl)).filter((h): h is string => !!h))];
  const latest = evidence.reduce<Date | null>((m, e) => (!m || e.retrievedAt > m ? e.retrievedAt : m), null);
  const outbound = relationships.filter((r) => r.direction === "outbound").length;
  const inbound = relationships.filter((r) => r.direction === "inbound").length;
  const otherSystems = [...new Set(comparable.filter((x) => x.systemSlug !== c.system.slug).map((x) => x.systemSlug))];
  const compareSystems = [c.system.slug, ...otherSystems].slice(0, 4);
  const license = c.license ?? c.system.license;

  const nav = [
    { id: "overview", label: "Overview" },
    { id: "frameworks", label: "Frameworks", count: frameworks.length },
    { id: "variants", label: "Variants & sizes", count: variants.length },
    { id: "states", label: "States", count: states.length },
    { id: "api", label: "API", count: props.length },
    { id: "accessibility", label: "Accessibility" },
    { id: "tokens", label: "Tokens", count: tokens.length },
    { id: "relationships", label: "Relationships", count: outbound + inbound },
    { id: "examples", label: "Examples", count: examples.length },
    ...(c.type ? [{ id: "comparable", label: "In other systems", count: comparable.length }] : []),
    ...(patterns.length ? [{ id: "patterns", label: "Patterns", count: patterns.length }] : []),
    { id: "evidence", label: "Evidence", count: evidence.length },
    { id: "history", label: "History", count: changes.length },
  ];

  return (
    <PageContainer className={CATALOG_SCOPE}>
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/systems">Systems</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={systemHref(c.system.slug)}>{c.system.name}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={`/components?view=components&system=${encodeURIComponent(c.system.slug)}`}>Components</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{c.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {c.publishState === "retired" && (
        <div role="note" className="mb-6 flex items-start gap-3 rounded-xl border border-dashed px-4 py-3 text-[13px]">
          <ArchiveIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p>
            <span className="font-medium">Retired.</span>{" "}
            <span className="text-muted-foreground">
              The latest ingestion no longer found this component in the source. ATLAS keeps the record and its evidence rather than deleting
              it.
            </span>
          </p>
        </div>
      )}

      <header className="grid gap-8 border-b border-border/70 pb-8 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-12">
        <div className="min-w-0 space-y-5">
          <Link href={systemHref(c.system.slug)} className="group inline-flex items-center gap-2.5">
            <SystemMark name={c.system.name} slug={c.system.slug} size="sm" />
            <span className="text-sm text-muted-foreground group-hover:text-foreground">{c.system.name}</span>
          </Link>
          <div className="space-y-3">
            <h1 className="type-display text-5xl break-words sm:text-6xl">{c.name}</h1>
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              {c.type ? (
                <>
                  <span className="text-muted-foreground">Canonical type</span>
                  <Link href={componentTypeHref(c.type.slug)} className="font-medium hover:underline hover:underline-offset-4">
                    {c.type.name}
                  </Link>
                  <ClassificationBadge state={c.classificationState} method={c.classificationMethod} />
                </>
              ) : (
                <ClassificationBadge state={c.classificationState} method={c.classificationMethod} classified={false} />
              )}
              <span aria-hidden className="text-subtle-foreground">
                ·
              </span>
              <LifecycleBadge lifecycle={c.lifecycle} />
              {c.aliases.length > 0 && (
                <span className="text-muted-foreground">
                  also called <span className="text-foreground/85">{c.aliases.join(", ")}</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {c.docsUrl && (
              <Button asChild variant="outline" size="sm">
                <a href={c.docsUrl} target="_blank" rel="noopener noreferrer">
                  <BookOpenIcon aria-hidden /> Documentation <span className="sr-only">(opens in a new tab)</span>
                </a>
              </Button>
            )}
            {c.sourceCodeUrl && (
              <Button asChild variant="outline" size="sm">
                <a href={c.sourceCodeUrl} target="_blank" rel="noopener noreferrer">
                  <CodeIcon aria-hidden /> Source <span className="sr-only">(opens in a new tab)</span>
                </a>
              </Button>
            )}
            {storybook && (
              <Button asChild variant="outline" size="sm">
                <a href={storybook} target="_blank" rel="noopener noreferrer">
                  <PanelsTopLeftIcon aria-hidden /> Storybook <span className="sr-only">(opens in a new tab)</span>
                </a>
              </Button>
            )}
            {figma && (
              <Button asChild variant="outline" size="sm">
                <a href={figma} target="_blank" rel="noopener noreferrer">
                  <PenToolIcon aria-hidden /> Figma <span className="sr-only">(opens in a new tab)</span>
                </a>
              </Button>
            )}
            {!c.docsUrl && !c.sourceCodeUrl && !storybook && !figma && (
              <p className="text-xs text-muted-foreground">No component-level documentation, source or Storybook link recorded.</p>
            )}
          </div>
        </div>
        <CoveragePanel coverage={cov} />
      </header>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 lg:mt-10 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-12">
        <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <SectionNav items={nav} />
        </div>

        <div className="min-w-0 space-y-14">
          <DetailSection id="overview" title="Overview" state={fieldState(cov, "description")}>
            {c.description ? (
              <figure className="max-w-3xl space-y-2">
                <blockquote className="text-[17px] leading-relaxed text-pretty text-foreground/90">{c.description}</blockquote>
                {descEvidence && (
                  <figcaption className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>From</span>
                    <SourceLink href={descEvidence.sourceUrl} className="text-xs">
                      {hostname(descEvidence.sourceUrl)}
                    </SourceLink>
                    <span>· retrieved {formatDate(descEvidence.retrievedAt)}</span>
                  </figcaption>
                )}
              </figure>
            ) : (
              <Missing state={fieldState(cov, "description")} what="a description" />
            )}
            <dl className="grid max-w-3xl gap-x-6 gap-y-3 pt-2 text-[13px] sm:grid-cols-[10rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground">Responsive guidance</dt>
              <dd>
                {c.responsiveGuidance ? (
                  <p className="text-foreground/90">{c.responsiveGuidance}</p>
                ) : (
                  <Missing state={fieldState(cov, "responsive")} what="responsive behavior" compact />
                )}
              </dd>
              {c.type && (
                <>
                  <dt className="text-muted-foreground">ATLAS definition</dt>
                  <dd className="text-foreground/85">
                    {c.type.description}{" "}
                    <Link href={componentTypeHref(c.type.slug)} className="link-underline text-muted-foreground">
                      {c.type.name} across systems
                    </Link>
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">Content license</dt>
              <dd>
                {license ? (
                  license.url ? (
                    <SourceLink href={license.url} className="text-[13px]">
                      {license.name}
                    </SourceLink>
                  ) : (
                    license.name
                  )
                ) : (
                  <span className="text-muted-foreground">Not recorded</span>
                )}
              </dd>
            </dl>
          </DetailSection>

          <DetailSection id="frameworks" title="Frameworks" state={fieldState(cov, "frameworks")} description="Implementations and design assets the source lists for this component.">
            {frameworks.length ? <FrameworksList frameworks={frameworks} /> : <Missing state={fieldState(cov, "frameworks")} what="framework implementations" />}
          </DetailSection>

          <DetailSection id="variants" title="Variants & sizes" state={fieldState(cov, "variants")}>
            {variants.length ? <VariantsBlock variants={variants} /> : <Missing state={fieldState(cov, "variants")} what="variants" />}
            <div className="space-y-2 pt-2">
              <h3 className="flex items-center gap-2.5 text-[13px] font-medium">
                Sizes
              </h3>
              <SizesBlock sizes={c.sizes} state={fieldState(cov, "sizes")} />
            </div>
          </DetailSection>

          <DetailSection
            id="states"
            title="States"
            state={fieldState(cov, "states")}
            description="System names as documented, mapped to ATLAS canonical states for comparison."
          >
            {states.length ? <StatesTable states={states} /> : <Missing state={fieldState(cov, "states")} what="states" />}
          </DetailSection>

          <DetailSection
            id="api"
            title="API"
            state={fieldState(cov, "properties")}
            description={implementations.length > 1 ? `${implementations.length} implementations documented. Values are as extracted; unstated fields are marked.` : undefined}
          >
            {implementations.length ? (
              <PropsTable implementations={implementations} initialImpl={first(sp.impl) ?? ""} initialFilter={normalizeQuery(first(sp.pq))} />
            ) : (
              <Missing state={fieldState(cov, "properties")} what="props" />
            )}
          </DetailSection>

          <DetailSection id="accessibility" title="Accessibility" state={fieldState(cov, "accessibility")}>
            <AccessibilityBlock a11y={accessibility} coverage={cov} typeAriaPattern={c.type?.ariaPattern ?? null} />
          </DetailSection>

          <DetailSection
            id="tokens"
            title="Tokens"
            state={fieldState(cov, "tokens")}
            description={
              tokens.length
                ? fieldState(cov, "tokens") === "inferred"
                  ? "Associated by ATLAS from the system's CSS or token names (inferred), not stated by the docs."
                  : "Tokens the source associates with this component, with resolved values per theme."
                : undefined
            }
            aside={
              tokens.length ? (
                <Link href={tokensHref(c.system.slug)} className="text-xs text-muted-foreground hover:text-foreground">
                  All {c.system.name} tokens →
                </Link>
              ) : undefined
            }
          >
            {tokens.length ? <TokenUsage tokens={tokens} systemSlug={c.system.slug} /> : <Missing state={fieldState(cov, "tokens")} what="token usage" />}
          </DetailSection>

          <DetailSection id="relationships" title="Relationships" state={fieldState(cov, "relationships")}>
            {outbound + inbound ? (
              <RelationshipsBlock rels={relationships} systemSlug={c.system.slug} />
            ) : (
              <Missing state={fieldState(cov, "relationships")} what="related components" />
            )}
          </DetailSection>

          <DetailSection id="examples" title="Examples" state={fieldState(cov, "examples")}>
            {examples.length ? <ExamplesBlock examples={examples} /> : <Missing state={fieldState(cov, "examples")} what="examples" />}
          </DetailSection>

          {c.type && (
            <DetailSection
              id="comparable"
              title={`${c.type.name} in other systems`}
              description="Components ATLAS mapped to the same canonical type. Related, not identical: compare before substituting."
              aside={
                otherSystems.length > 0 ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={compareHref(c.type.slug, compareSystems)}>
                      Compare side by side <ArrowRightIcon aria-hidden />
                    </Link>
                  </Button>
                ) : undefined
              }
            >
              {comparable.length ? (
                <ComparableGrid items={comparable} typeName={c.type.name} />
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  No other indexed component is mapped to {c.type.name}. That reflects ATLAS&apos;s index, not the systems themselves.
                </p>
              )}
            </DetailSection>
          )}

          {patterns.length > 0 && (
            <DetailSection id="patterns" title="Used in patterns" description={`${c.system.name} patterns that reference this component.`}>
              <ul className="flex flex-wrap gap-2">
                {patterns.map((p) => (
                  <li key={p.slug}>
                    <Link href={patternHref(c.system.slug, p.slug)} className="inline-flex h-8 items-center gap-2 rounded-md border bg-card px-2.5 text-[13px] hover:border-foreground/30">
                      {p.name}
                      {p.role && <span className="text-xs text-muted-foreground">{p.role}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </DetailSection>
          )}

          <DetailSection
            id="evidence"
            title="Evidence"
            description="Every claim on this page traces to a source document, retrieval time, content hash and extraction method."
          >
            <EvidenceList rows={evidence.slice(0, 10)} emptyLabel="No evidence rows recorded for this component." />
            {evidence.length > 10 && (
              <details className="group/more">
                <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <span className="group-open/more:hidden">Show {evidence.length - 10} more evidence records</span>
                  <span className="hidden group-open/more:inline">Show fewer</span>
                </summary>
                <div className="mt-3">
                  <EvidenceList rows={evidence.slice(10)} />
                </div>
              </details>
            )}
          </DetailSection>

          <DetailSection id="history" title="Change history" description="Changes ATLAS observed between ingestion runs.">
            <ChangeHistory changes={changes} firstSeenAt={c.firstSeenAt} />
          </DetailSection>

          <footer className="border-t border-border/70 pt-5 text-xs leading-relaxed text-muted-foreground">
            {hosts.length > 0 ? (
              <p>
                Data from {hosts.map((h, i) => (
                  <span key={h}>
                    {i > 0 && (i === hosts.length - 1 ? " and " : ", ")}
                    <span className="text-foreground/85">{h}</span>
                  </span>
                ))}
                {latest && <> · retrieved {formatDate(latest)}</>}
                {c.system.lastIngestedAt && <> · last ingested {formatDate(c.system.lastIngestedAt)}</>}. Names, documentation and
                trademarks belong to their owners; ATLAS stores concise facts and links back.
              </p>
            ) : (
              <p>No source documents are recorded for this component.</p>
            )}
            <p className="mt-1 tabular">
              {formatCount(evidence.length)} evidence records · confidence {Math.round(c.confidence * 100)}% · last changed {formatDate(c.lastChangedAt)}
            </p>
          </footer>
        </div>
      </div>
    </PageContainer>
  );
}
