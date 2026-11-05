import type { Metadata } from "next";
import { CATALOG_SCOPE } from "@/components/catalog/lib/scope";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRightIcon, Grid3x3Icon, ShapesIcon } from "lucide-react";
import { EmptyState, PageContainer, Section, SourceLink } from "@/components/atlas";
import { CoverageStripLegend } from "@/components/catalog/coverage-strip";
import { ImplementationsTable } from "@/components/catalog/implementations-table";
import { ariaReference } from "@/components/catalog/lib/apg";
import { plural } from "@/components/catalog/lib/format";
import { catalogHref, DEFAULT_PARAMS } from "@/components/catalog/lib/params";
import { compareHref, componentHref, componentTypeHref, systemHref } from "@/components/catalog/lib/urls";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { normalizeName } from "@/lib/taxonomy";
import { cn } from "@/lib/utils";
import { bestCoveredSystems, getComponentType, getComponentTypeMeta } from "@/server/queries/components";

type Props = { params: Promise<{ type: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type } = await params;
  const meta = await getComponentTypeMeta(type);
  if (!meta) return { title: "Component type not found" };
  return {
    title: `${meta.name}: implementations across design systems`,
    description: `${meta.description} ATLAS indexes ${meta.n === 1 ? "1 system" : `${meta.n} systems`} implementing it, with system-specific names, props, states and accessibility coverage.`,
  };
}

function Chip({ children, href, className }: { children: React.ReactNode; href?: string; className?: string }) {
  const cls = cn("inline-flex h-6 items-center rounded-md border bg-surface-1 px-2 text-xs", className);
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-foreground/30 hover:text-foreground")}>
      {children}
    </Link>
  ) : (
    <span className={cls}>{children}</span>
  );
}

export default async function ComponentTypePage({ params }: Props) {
  const { type: slug } = await params;
  const type = await getComponentType(slug);
  if (!type) notFound();

  const byName = new Map(type.typeNameIndex.map((t) => [normalizeName(t.name), t]));
  const bySlug = new Map(type.typeNameIndex.map((t) => [t.slug, t]));
  const resolveType = (term: string) => byName.get(normalizeName(term)) ?? bySlug.get(term.replace(/\s+/g, "-"));
  const aria = ariaReference(type.ariaPattern);
  const systemsImplementing = new Set(type.implementations.map((i) => i.systemSlug));
  const compareSystems = bestCoveredSystems(type.implementations, 4);
  const matrixHref = catalogHref({ ...DEFAULT_PARAMS, layout: "matrix", group: type.group.slug });
  const unindexed = Math.max(0, type.systemsPublished - type.systemsWithComponents);

  return (
    <PageContainer className={CATALOG_SCOPE}>
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/components">Components</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={catalogHref({ ...DEFAULT_PARAMS, group: type.group.slug })}>{type.group.name}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{type.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <header className="grid gap-8 border-b border-border/70 pb-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
        <div className="min-w-0 space-y-4">
          <p className="type-eyebrow text-muted-foreground">Canonical type · {type.group.name}</p>
          <h1 className="type-display text-5xl sm:text-6xl">{type.name}</h1>
          <div className="max-w-2xl space-y-1.5">
            <p className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">ATLAS definition</p>
            <p className="text-lg leading-relaxed text-foreground/90">{type.description}</p>
            <p className="text-xs text-muted-foreground">
              Written by ATLAS as a cross-system reference. System documentation may define its own component differently.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {compareSystems.length >= 2 ? (
              <Button asChild>
                <Link href={compareHref(type.slug, compareSystems)}>
                  Compare these <ArrowRightIcon aria-hidden />
                </Link>
              </Button>
            ) : (
              <Button disabled title="Needs implementations in at least two indexed systems">
                Compare these
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={matrixHref}>
                <Grid3x3Icon aria-hidden /> {type.group.name} coverage matrix
              </Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {compareSystems.length >= 2
              ? `Compares the ${compareSystems.length} best-documented implementations, one per system.`
              : "Comparison needs implementations in at least two indexed systems."}
          </p>
          {type.implementations.length > 0 && (
            <div className="max-w-2xl space-y-1.5 pt-3">
              <p className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">Called, in indexed systems</p>
              <p className="text-[15px] leading-7 text-pretty">
                {type.implementations.map((i, idx) => (
                  <span key={i.id}>
                    {idx > 0 && <span aria-hidden className="text-subtle-foreground">{"  ·  "}</span>}
                    <span className="whitespace-nowrap">
                      <Link href={componentHref(i.systemSlug, i.slug)} className={cn("underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground", i.lifecycle === "deprecated" && "text-muted-foreground line-through")}>
                        {i.name}
                      </Link>{" "}
                      <span className="text-muted-foreground">({i.systemName})</span>
                    </span>
                  </span>
                ))}
              </p>
            </div>
          )}
        </div>

        <dl className="grid content-start gap-5 text-sm lg:border-l lg:border-border/70 lg:pl-8">
          <div className="space-y-1">
            <dt className="type-eyebrow text-muted-foreground">Indexed implementations</dt>
            <dd>
              <span className="tabular text-3xl font-semibold tracking-tight">{systemsImplementing.size}</span>
              <span className="text-muted-foreground"> of {plural(type.systemsWithComponents, "system")} with component data</span>
              <p className="text-xs text-muted-foreground">
                {plural(type.implementations.length, "component")}
                {unindexed > 0 && <>; {unindexed} verified systems are not indexed at component level yet</>}
              </p>
            </dd>
          </div>
          <div className="space-y-1.5">
            <dt className="type-eyebrow text-muted-foreground">Interaction pattern</dt>
            <dd>
              {aria ? (
                <div className="space-y-0.5">
                  <SourceLink href={aria.url}>{aria.kind === "apg-pattern" ? `WAI-ARIA APG: ${aria.label}` : aria.label}</SourceLink>
                  {aria.kind === "aria-role" && (
                    <p className="text-xs text-muted-foreground">The APG has no dedicated pattern page for this; linking the role definition.</p>
                  )}
                </div>
              ) : type.ariaPattern ? (
                <span className="font-mono text-xs">{type.ariaPattern}</span>
              ) : (
                <span className="text-muted-foreground">No WAI-ARIA pattern assigned in the ATLAS taxonomy</span>
              )}
            </dd>
          </div>
          <div className="space-y-1.5">
            <dt className="type-eyebrow text-muted-foreground">Also known as</dt>
            <dd className="flex flex-wrap gap-1.5">
              {type.aliases.length ? (
                type.aliases.map((a) => <Chip key={a}>{a}</Chip>)
              ) : (
                <span className="text-muted-foreground">No aliases recorded</span>
              )}
              <p className="w-full text-xs text-muted-foreground">Names ATLAS treats as this type when classifying.</p>
            </dd>
          </div>
          <div className="space-y-1.5">
            <dt className="type-eyebrow text-muted-foreground">Near-synonyms</dt>
            <dd className="flex flex-wrap gap-1.5">
              {type.nearSynonyms.length ? (
                type.nearSynonyms.map((n) => {
                  const t = resolveType(n);
                  return (
                    <Chip key={n} href={t && t.slug !== type.slug ? componentTypeHref(t.slug) : undefined} className="border-dashed">
                      {n}
                    </Chip>
                  );
                })
              ) : (
                <span className="text-muted-foreground">None recorded</span>
              )}
              {type.nearSynonyms.length > 0 && (
                <p className="w-full text-xs text-muted-foreground">Related but not interchangeable: often confused with {type.name}, but a different component.</p>
              )}
            </dd>
          </div>
        </dl>
      </header>

      <div className="mt-10 space-y-12">
        <Section
          id="implementations"
          title={`Implementations (${type.implementations.length})`}
          description="System-specific names link to the indexed record. Empty cells say why: not documented by the source, or not extracted by ATLAS."
        >
          {type.implementations.length > 0 && <CoverageStripLegend />}
          {type.implementations.length ? (
            <ImplementationsTable rows={type.implementations} />
          ) : (
            <EmptyState
              icon={ShapesIcon}
              title={`No ${type.name.toLowerCase()} found in ATLAS's index yet`}
              description={`ATLAS has component-level data for ${plural(type.systemsWithComponents, "system")}. None of them has a component ATLAS mapped to this type, which is not evidence that they lack one.`}
              action={
                <Button asChild size="sm" variant="outline">
                  <Link href="/components">Back to the catalog</Link>
                </Button>
              }
            />
          )}
        </Section>

        {type.notFoundIn.length > 0 && (
          <Section
            id="not-found"
            title="Not found in ATLAS's index of"
            description="These systems have indexed components, but none ATLAS mapped to this type. The component may exist under another name, be unclassified, or not be documented."
          >
            <ul className="flex flex-wrap gap-2">
              {type.notFoundIn.map((s) => (
                <li key={s.slug}>
                  <Link
                    href={systemHref(s.slug)}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-dashed px-2.5 text-[13px] transition-colors hover:border-foreground/30"
                  >
                    {s.name}
                    <span className="tabular font-mono text-[11px] text-muted-foreground">{s.componentCount} indexed</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </PageContainer>
  );
}
