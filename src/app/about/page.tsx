import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CoverageChip, COVERAGE_META, PageContainer, SourceLink, VERIFICATION_META, VerificationBadge } from "@/components/atlas";
import { COVERAGE_STATES, VERIFICATION_STATES, type CoverageState, type VerificationState } from "@/lib/contracts";
import { DEFAULT_USER_AGENT } from "@/ingestion/http";
import { methodologyStats } from "@/server/queries/ops";
import { formatCount, relativeTime } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Methodology",
  description: "How ATLAS sources, verifies, classifies and labels design system data, what it stores and what it never does.",
};

const SECTIONS = [
  ["what", "What ATLAS is"],
  ["sources", "Sources & access"],
  ["verification", "Verification & confidence"],
  ["coverage", "Coverage states"],
  ["classification", "Classification"],
  ["scoring", "Scoring"],
  ["licensing", "Copyright & licensing"],
  ["registry", "The 100-system registry"],
  ["report", "Report an issue"],
] as const;

const REPO_ISSUES = "https://github.com/zacker3310/brand/issues";

export default async function MethodologyPage() {
  const s = await methodologyStats();
  const verified = s.registry.verified ?? 0;
  const classified = Object.values(s.classification).reduce((a, b) => a + b, 0);
  const coverageTotal = Object.values(s.coverageStates).reduce((a, b) => a + b, 0);
  const tokenSets = Object.values(s.tokenSetsByRedistribution).reduce((a, b) => a + b, 0);

  return (
    <PageContainer>
      <header className="border-b pb-10">
        <div className="max-w-3xl space-y-4">
        <p className="type-eyebrow text-muted-foreground">Methodology</p>
        <h1 className="type-display text-4xl sm:text-6xl">How ATLAS knows what it shows.</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Every number on this page is computed from the live index
          {s.lastIngestedAt ? <> (last ingestion {relativeTime(s.lastIngestedAt)})</> : null}. The rules below are the ones the code enforces, not aspirations.
        </p>
      </div>
      </header>

      <div className="mt-10 grid gap-12 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ol className="sticky top-24 space-y-1 border-l text-sm">
            {SECTIONS.map(([id, label], i) => (
              <li key={id}>
                <a href={`#${id}`} className="-ml-px block border-l border-transparent py-1 pl-3 text-muted-foreground transition-colors hover:border-foreground hover:text-foreground">
                  <span className="mr-2 font-mono text-[11px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="max-w-3xl min-w-0 space-y-16 text-[15px] leading-relaxed">
          <Block id="what" n={1} title="What ATLAS is, and is not">
            <p>
              ATLAS is a navigational and comparative index of real-world design systems: their components, tokens, patterns and accessibility guidance, each linked back to the
              official documentation it came from.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <List
                title="It is"
                items={[
                  "A source-attributed catalog of concise facts: names, documented variants, states, properties, token values, URLs.",
                  "A comparison layer over a shared ATLAS taxonomy, with every heuristic labelled.",
                  "Honest about gaps: unknown, undocumented and absent are three different things.",
                ]}
              />
              <List
                title="It is not"
                items={[
                  "A mirror. It stores short excerpts and hashes, never whole pages.",
                  "An authority over any system: the official docs are. Verify there before relying on a fact.",
                  "A ranking of quality. Scores, where shown, explain their inputs.",
                ]}
              />
            </div>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
              <Fig label="Verified systems" value={verified} />
              <Fig label="Deeply indexed" value={s.indexedSystems} />
              <Fig label="Published components" value={s.componentsTotal} />
              <Fig label="Evidence records" value={s.evidenceTotal} />
            </dl>
          </Block>

          <Block id="sources" n={2} title="Sources & access policy">
            <p>
              First-party, machine-readable sources come first: official repositories (read through raw.githubusercontent.com), official packages (through jsDelivr and the npm
              registry), public sitemaps. HTML documentation is parsed only where nothing structured exists.
            </p>
            <ul className="space-y-2">
              {[
                ["robots.txt", "Honored per RFC 9309 for every host, re-read every 6 hours. An unreachable or erroring robots.txt means “disallowed”. Crawl-delay is honored (capped at 10 s)."],
                ["Rate limits", "One shared fetcher per worker with, by default, at most 2 concurrent requests and 750 ms between requests per host; retries back off exponentially and respect Retry-After."],
                ["Conditional requests", "ETag / Last-Modified on every refetch; an unchanged document (304 or same content hash) creates no new data."],
                ["Identification", <>Requests identify ATLAS: <code className="font-mono text-[12px] break-all">{DEFAULT_USER_AGENT}</code></>],
                ["No bypassing", "No authentication, paywall, CAPTCHA or access control is ever bypassed. Commercial or private catalogs are indexed at metadata level only."],
                ["No execution", "Fetched content is data. No fetched script is ever run; parsing is static (JSON, YAML, Markdown/MDX, HTML via a parser, CSS/SCSS text)."],
              ].map(([k, v]) => (
                <li key={k as string} className="grid gap-1 rounded-lg border bg-card px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
                  <span className="text-sm font-medium">{k}</span>
                  <span className="text-sm text-muted-foreground">{v}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              {formatCount(s.documents)} source documents are tracked; {formatCount(s.blockedDocuments)} are currently marked blocked. Systems by documentation access:{" "}
              {Object.entries(s.docAccess)
                .map(([k, n]) => `${k} ${n}`)
                .join(" · ")}
              .
            </p>
          </Block>

          <Block id="verification" n={3} title="Verification & confidence">
            <p>
              Every published claim points to evidence: the source URL, when it was retrieved, a content hash of what was read, the extraction method (for example{" "}
              <code className="font-mono text-[12px]">adapter:primer:docs-json</code>), the location inside the source, and at most a 300-character excerpt. Claims carry one of five states:
            </p>
            <ul className="divide-y rounded-xl border bg-card">
              {VERIFICATION_STATES.map((st) => (
                <li key={st} className="grid gap-2 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_5rem] sm:items-center">
                  <VerificationBadge state={st as VerificationState} />
                  <span className="text-sm text-muted-foreground">{VERIFICATION_META[st as VerificationState].description}</span>
                  <span className="tabular text-right font-mono text-xs text-muted-foreground">{formatCount(s.evidenceByState[st] ?? 0)}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              Counts are evidence rows by state ({formatCount(s.evidenceTotal)} rows from {formatCount(s.evidenceSources)} distinct source URLs). Confidence (0–1) records how
              directly a source supports a claim: an explicit, structured statement scores high; a heuristic match scores lower and is always labelled inferred.
            </p>
          </Block>

          <Block id="coverage" n={4} title="Coverage states: unknown is not empty">
            <p>
              Every component field carries a coverage state, so an empty cell always says why it is empty. Absent documentation is never presented as absent capability, and
              comparisons never score “not documented” or “not extracted” as a missing feature.
            </p>
            <ul className="divide-y rounded-xl border bg-card">
              {COVERAGE_STATES.map((st) => {
                const n = s.coverageStates[st] ?? 0;
                return (
                  <li key={st} className="grid gap-2 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_7rem] sm:items-center">
                    <CoverageChip state={st as CoverageState} />
                    <span className="text-sm text-muted-foreground">{COVERAGE_META[st as CoverageState].description}</span>
                    <span className="tabular text-right font-mono text-xs text-muted-foreground">
                      {formatCount(n)} <span className="text-muted-foreground">({coverageTotal ? Math.round((n / coverageTotal) * 100) : 0}%)</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-sm text-muted-foreground">Counts are (component, field) pairs across {formatCount(s.componentsTotal)} published components.</p>
          </Block>

          <Block id="classification" n={5} title="Classification: verified vs inferred">
            <p>
              Systems name things differently. ATLAS maps each component to an ATLAS-authored taxonomy type (Button, Combobox, Date picker…) so implementations can be compared. A
              mapping is <strong className="font-medium">verified</strong> only when the source itself names the pattern; matches on names, aliases or synonyms are{" "}
              <strong className="font-medium">inferred</strong>, labelled as such, and show their method on hover. Near-synonyms such as “Dropdown” are deliberately not treated as
              aliases.
            </p>
            <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border">
              <Fig label="Verified mappings" value={s.classification.verified ?? 0} />
              <Fig label="Inferred mappings" value={s.classification.inferred ?? 0} />
              <Fig label="Unclassified" value={s.unclassified} />
            </dl>
            <p className="text-sm text-muted-foreground">
              {formatCount(classified)} of {formatCount(s.componentsTotal)} published components are mapped to a taxonomy type; unclassified components stay in the catalog under their own
              names.
            </p>
          </Block>

          <Block id="scoring" n={6} title="Scoring">
            <p>
              Where ATLAS compares systems it shows the rubric next to the result: which fields count, how each coverage state is treated and which inputs are inferred. Nothing is
              scored on data ATLAS has not extracted.
            </p>
            <Link href="/compare/systems" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              See the system comparison and its rubric <ArrowRightIcon className="size-3.5" aria-hidden />
            </Link>
          </Block>

          <Block id="licensing" n={7} title="Copyright & licensing">
            <ul className="space-y-2 text-sm">
              <Li>ATLAS stores facts (names, documented options, values, URLs), short excerpts with attribution, and links. Documentation text stays on its owner’s site.</Li>
              <Li>
                Code examples are stored only when the source license permits redistribution, with attribution; otherwise ATLAS links to the example.{" "}
                <span className="text-muted-foreground">
                  Now: {formatCount(s.examples.withCode)} of {formatCount(s.examples.total)} examples include code; the rest are links.
                </span>
              </Li>
              <Li>
                Token values are exported only for sets whose license permits redistribution; the API withholds values otherwise.{" "}
                <span className="text-muted-foreground">
                  Now: {formatCount(tokenSets)} token sets ({formatCount(s.tokens)} tokens) —{" "}
                  {Object.entries(s.tokenSetsByRedistribution)
                    .map(([k, n]) => `${n} ${k}`)
                    .join(", ") || "none"}
                  .
                </span>
              </Li>
              <Li>ATLAS never displays third-party logos; systems are shown with a generated monogram.</Li>
              <Li>Names, trademarks and documentation belong to their owners. Exports are reference lists, not license grants.</Li>
            </ul>
          </Block>

          <Block id="registry" n={8} title="The 100-system registry">
            <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                ["Research", `${formatCount(s.rankedCandidates)} candidates were ranked and researched: URLs, license, maintenance, packages, frameworks.`],
                ["Adversarial audit", "Every claim was re-checked over HTTP and against package metadata; entries without public documentation or duplicating another were rejected with the reason kept."],
                ["Replacement", "Each rejected or duplicate slot was filled by a distinct, verified system so the published registry stays at 100."],
              ].map(([k, v], i) => (
                <li key={k} className="rounded-xl border bg-card p-4">
                  <p className="font-mono text-[11px] text-muted-foreground">STEP {i + 1}</p>
                  <p className="mt-1 text-sm font-medium">{k}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{v}</p>
                </li>
              ))}
            </ol>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
              <Fig label="Verified" value={verified} />
              <Fig label="Rejected" value={s.registry.rejected ?? 0} />
              <Fig label="Duplicates" value={s.registry.duplicate ?? 0} />
              <Fig label="Replacements" value={s.replacements.length} />
            </dl>
            {s.replacements.length > 0 && (
              <details className="rounded-xl border bg-card">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Replacements ({s.replacements.length})</summary>
                <ul className="divide-y border-t">
                  {s.replacements.map((r) => (
                    <li key={r.toSlug} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                      <span className="text-muted-foreground line-through decoration-subtle-foreground/60">{r.from}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{r.reason}</span>
                      <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-label="replaced by" />
                      <Link href={`/systems/${r.toSlug}`} className="font-medium hover:underline">
                        {r.to}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Block>

          <Block id="report" n={9} title="Report an issue">
            <p>
              Found a wrong value, a dead link, a missing component or a mislabelled state? Open an issue with the ATLAS URL, what the official source says (with its URL) and what
              ATLAS shows. Owners of a design system can also ask for corrections or removal of excerpts.
            </p>
            <SourceLink href={REPO_ISSUES} className="text-sm font-medium">
              Open an issue on GitHub
            </SourceLink>
            <p className="text-sm text-muted-foreground">
              Programmatic access: the <Link href="/api-docs" className="link-underline">REST API</Link> exposes the same data with the same labels.
            </p>
          </Block>
        </article>
      </div>
    </PageContainer>
  );
}

function Block({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 space-y-5">
      <h2 id={`${id}-title`} className="flex items-baseline gap-3 text-xl font-semibold tracking-tight">
        <span className="font-mono text-xs font-normal text-muted-foreground">{String(n).padStart(2, "0")}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fig({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular mt-1 text-xl font-semibold tracking-tight">{formatCount(value)}</dd>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm font-medium">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((i) => (
          <Li key={i}>{i}</Li>
        ))}
      </ul>
    </div>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 text-sm">
      <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
      <span>{children}</span>
    </li>
  );
}
