import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { COVERAGE_META, CoverageChip, EvidenceList, MissingValue, SourceLink, SystemMark, VerificationBadge, type EvidenceRow } from "@/components/atlas";
import type { CoverageState } from "@/lib/contracts";
import { cn, formatCount, hostname } from "@/lib/utils";
import type { DetailChange, RelatedSystem, SystemDetail } from "@/server/queries/systems";
import { ariaReference } from "@/components/catalog/lib/apg";
import { Chip } from "../badges";
import { CHANGE_KIND_LABELS, ENTITY_TYPE_LABELS, formatDate, formatDateTime, plural } from "../lib/format";
import { ClassificationBadge } from "./components-section";

/* -------------------------------------------------------------------------- */
/* Patterns                                                                    */
/* -------------------------------------------------------------------------- */

export function PatternsSection({ detail }: { detail: SystemDetail }) {
  const { patterns, core } = detail;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {patterns.map((p) => (
        <li key={p.slug} className="flex flex-col rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold">
            <Link href={`/systems/${core.slug}/patterns/${p.slug}`} className="hover:underline">
              {p.name}
            </Link>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {p.typeSlug ? (
              <>
                <Link href={`/patterns/${p.typeSlug}`} className="hover:text-foreground hover:underline">
                  {p.typeName}
                </Link>
                <ClassificationBadge c={{ classificationState: p.classificationState, classificationMethod: null, confidence: 0 }} />
              </>
            ) : (
              <span className="text-muted-foreground">No pattern-type match</span>
            )}
          </div>
          {p.description ? (
            <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">{p.description}</p>
          ) : (
            <MissingValue state="not-extracted" className="mt-2" />
          )}
          <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-xs text-muted-foreground">
            <span className="tabular">{p.components > 0 ? plural(p.components, "linked component") : "No linked components"}</span>
            {p.docsUrl && (
              <SourceLink href={p.docsUrl} className="text-xs">
                Docs
              </SourceLink>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Accessibility                                                               */
/* -------------------------------------------------------------------------- */

const COVERAGE_ORDER: CoverageState[] = ["documented", "documented-none", "inferred", "not-documented", "not-extracted"];
const COVERAGE_BAR: Record<CoverageState, string> = {
  documented: "bg-verified",
  "documented-none": "bg-foreground/40",
  inferred: "bg-inferred",
  "not-documented": "bg-unavailable/50",
  "not-extracted": "hatch bg-muted",
};

function CoverageBreakdown({ title, counts, total }: { title: string; counts: Partial<Record<CoverageState, number>>; total: number }) {
  const entries = COVERAGE_ORDER.map((s) => ({ s, n: counts[s] ?? 0 }));
  return (
    <div className="space-y-2.5 rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        <span className="tabular text-xs text-muted-foreground">
          <span className="text-lg font-semibold text-foreground">{counts.documented ?? 0}</span> / {total} documented
        </span>
      </div>
      <div
        className="flex h-2 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={entries
          .filter((e) => e.n)
          .map((e) => `${COVERAGE_META[e.s].label}: ${e.n}`)
          .join(", ")}
      >
        {entries
          .filter((e) => e.n > 0)
          .map((e) => (
            <span key={e.s} className={cn("h-full", COVERAGE_BAR[e.s])} style={{ width: `${(e.n / Math.max(total, 1)) * 100}%` }} />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {entries
          .filter((e) => e.n > 0)
          .map((e) => (
            <li key={e.s} className="flex items-center gap-1.5 text-xs">
              <CoverageChip state={e.s} />
              <span className="tabular text-muted-foreground">{e.n}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

export function AccessibilitySection({ detail }: { detail: SystemDetail }) {
  const a = detail.accessibility;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CoverageBreakdown title="Component accessibility guidance" counts={a.a11yCoverage} total={a.components} />
        <CoverageBreakdown title="Keyboard interaction docs" counts={a.keyboardCoverage} total={a.components} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-2.5 rounded-xl border bg-card p-4">
          <h3 className="text-xs font-medium text-muted-foreground">WAI-ARIA patterns referenced</h3>
          {a.ariaPatterns.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {a.ariaPatterns.map((p) => {
                const ref = ariaReference(p.pattern);
                const inner = (
                  <>
                    {p.pattern}
                    <span className="tabular text-muted-foreground">×{p.count}</span>
                  </>
                );
                return (
                  <li key={p.pattern}>
                    {ref ? (
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={ref.label}
                        className="inline-flex items-center gap-1.5 rounded-md border bg-surface-1 px-2 py-1 font-mono text-[11px] hover:bg-accent"
                      >
                        {inner}
                        <span className="sr-only">({ref.label}, opens in a new tab)</span>
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-md border bg-surface-1 px-2 py-1 font-mono text-[11px]" title="No verified WAI-ARIA reference page for this value">
                        {inner}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <MissingValue state="not-extracted" /> No component in this system has an extracted ARIA pattern reference.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {plural(a.withKeyboardInteractions, "component")} with extracted keyboard interaction tables.
          </p>
        </div>
        <div className="space-y-2.5 rounded-xl border bg-card p-4">
          <h3 className="text-xs font-medium text-muted-foreground">WCAG success criteria cited</h3>
          {a.wcag.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {a.wcag.map((w) => (
                <li key={w.criterion}>
                  <Chip className="font-mono">
                    {w.criterion} <span className="ml-1 text-muted-foreground">×{w.count}</span>
                  </Chip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <MissingValue state="not-extracted" /> No WCAG criteria extracted from this system&apos;s component docs.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Frameworks & platforms                                                      */
/* -------------------------------------------------------------------------- */

export function FrameworksSection({ detail }: { detail: SystemDetail }) {
  const { frameworks, platforms } = detail;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="relative overflow-x-auto rounded-xl border bg-card" role="region" aria-label="Framework support" tabIndex={0}>
        {frameworks.length ? (
          <table className="w-full min-w-[520px] text-sm">
            <caption className="sr-only">Frameworks with support level, package and verification state</caption>
            <thead>
              <tr className="border-b text-left text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
                <th scope="col" className="px-4 py-2 font-medium">Framework</th>
                <th scope="col" className="px-3 py-2 font-medium">Support</th>
                <th scope="col" className="px-3 py-2 font-medium">Package</th>
                <th scope="col" className="px-4 py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {frameworks.map((f) => (
                <tr key={f.slug}>
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    <Link href={`/systems?framework=${f.slug}`} className="hover:underline">
                      {f.name}
                    </Link>
                    {f.kind === "design" && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">design tool</span>}
                  </th>
                  <td className="px-3 py-2 text-xs capitalize">{f.support}</td>
                  <td className="px-3 py-2 font-mono text-xs">{f.packageName ?? <span className="font-sans text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <VerificationBadge state={f.state} />
                      {f.sourceUrl && (
                        <SourceLink href={f.sourceUrl} className="text-xs">
                          {hostname(f.sourceUrl)}
                        </SourceLink>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <MissingValue state="not-extracted" /> No framework support recorded.
          </p>
        )}
      </div>
      <div className="space-y-2.5 rounded-xl border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">Platforms</h3>
        {platforms.length ? (
          <ul className="space-y-1.5">
            {platforms.map((p) => (
              <li key={p.slug} className="flex items-center justify-between gap-2 text-sm">
                <Link href={`/systems?platform=${p.slug}`} className="hover:underline">
                  {p.name}
                </Link>
                <VerificationBadge state={p.state} />
              </li>
            ))}
          </ul>
        ) : (
          <MissingValue state="not-extracted" />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Resources                                                                   */
/* -------------------------------------------------------------------------- */

function StatusPill({ status, error }: { status: number | null; error: string | null }) {
  if (status === null) return <span className="text-xs text-muted-foreground">{error ? "Error" : "Not checked"}</span>;
  const ok = status >= 200 && status < 400;
  return (
    <span className={cn("tabular inline-flex items-center gap-1 font-mono text-xs", ok ? "text-verified" : "text-conflicting")} title={error ?? undefined}>
      <span className={cn("size-1.5 rounded-full", ok ? "bg-verified" : "bg-conflicting")} aria-hidden />
      {status}
    </span>
  );
}

export function ResourcesSection({ detail }: { detail: SystemDetail }) {
  const { sources, counts } = detail;
  if (!sources.length) return <MissingValue state="not-extracted" />;
  return (
    <div className="space-y-2">
      <div className="relative overflow-x-auto rounded-xl border bg-card" role="region" aria-label="Sources" tabIndex={0}>
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Official sources with kind, last check status, robots status and ingested documents</caption>
          <thead>
            <tr className="border-b text-left text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
              <th scope="col" className="sticky left-0 bg-card px-4 py-2 font-medium">Source</th>
              <th scope="col" className="px-3 py-2 font-medium">Kind</th>
              <th scope="col" className="px-3 py-2 font-medium">Last check</th>
              <th scope="col" className="px-3 py-2 font-medium">Robots</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Documents</th>
              <th scope="col" className="px-4 py-2 font-medium">Found by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {sources.map((s) => (
              <tr key={s.id}>
                <th scope="row" className="sticky left-0 max-w-[22rem] bg-card px-4 py-2 text-left font-normal">
                  <SourceLink href={s.url} className="max-w-full text-[13px]">
                    <span className="block truncate">{s.label ?? hostname(s.url)}</span>
                  </SourceLink>
                  <span className="block truncate font-mono text-[10.5px] text-muted-foreground">{s.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                </th>
                <td className="px-3 py-2 text-xs capitalize">{s.kind.replace(/-/g, " ")}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col">
                    <StatusPill status={s.lastStatus} error={s.lastError} />
                    {s.lastCheckedAt && <time dateTime={s.lastCheckedAt} className="text-[11px] text-muted-foreground">{formatDate(s.lastCheckedAt)}</time>}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs">
                  {s.robotsAllowed === null ? (
                    <span className="text-muted-foreground">Not recorded</span>
                  ) : s.robotsAllowed ? (
                    <span className="text-verified">Allowed</span>
                  ) : (
                    <span className="text-conflicting">Disallowed</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-xs">
                  {s.documents > 0 ? (
                    <span title={s.documentStatuses.map((d) => `${d.count} × HTTP ${d.status ?? "?"}`).join(", ")}>
                      <span className="tabular">{formatCount(s.documents)}</span>
                      {s.documentsLastFetchedAt && <span className="block text-[11px] text-muted-foreground">{formatDate(s.documentsLastFetchedAt)}</span>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground">{s.discoveredBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {plural(counts.documents, "document")} fetched through the polite crawler (robots.txt respected, rate-limited, conditional requests). HTTP 304 means the cached copy
        was still current.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Change history                                                              */
/* -------------------------------------------------------------------------- */

const ENTITY_PLURAL: Record<string, string> = {
  design_system: "system record",
  component: "components",
  token_set: "token sets",
  pattern: "patterns",
  source_document: "source documents",
};

export function ChangesSection({
  slug,
  changes,
}: {
  slug: string;
  changes: { rows: DetailChange[]; total: number; batches: number; page: number; pages: number };
}) {
  if (!changes.total) return <p className="text-sm text-muted-foreground">No change events recorded.</p>;
  const href = (p: number) => (p <= 1 ? `/systems/${slug}#changes` : `/systems/${slug}?changes=${p}#changes`);
  const days = changes.rows.map((c) => formatDate(c.occurredAt) ?? "");
  return (
    <div className="space-y-3">
      {changes.rows.length === 0 && <p className="text-sm text-muted-foreground">This page is past the end of the history.</p>}
      <ol className="relative border-l border-border/80 pl-5">
        {changes.rows.map((c, i) => {
          const day = days[i]!;
          const showDay = i === 0 || day !== days[i - 1];
          const noun = c.count === 1 ? (ENTITY_TYPE_LABELS[c.entityType] ?? c.entityType).toLowerCase() : (ENTITY_PLURAL[c.entityType] ?? c.entityType);
          const time = formatDateTime(c.occurredAt)?.split(", ").slice(-1)[0];
          return (
            <li key={c.id} className="relative pb-4">
              <span
                className={cn(
                  "absolute top-1.5 -left-[24.5px] size-2 rounded-full ring-2 ring-background",
                  c.changeKind === "created" ? "bg-verified" : c.changeKind === "removed" ? "bg-conflicting" : "bg-primary",
                )}
                aria-hidden
              />
              {showDay && <p className="mb-1 font-mono text-[10.5px] text-muted-foreground">{day}</p>}
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
                <span className="font-medium">{CHANGE_KIND_LABELS[c.changeKind] ?? c.changeKind}</span>
                <span>
                  {c.count > 1 && <span className="tabular font-medium">{formatCount(c.count)} </span>}
                  <span className="text-muted-foreground">{noun}</span>
                  {c.count === 1 && c.labels[0] && <span className="text-foreground/90"> {c.labels[0]}</span>}
                </span>
                <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
                  <time dateTime={c.occurredAt}>{time}</time> · {c.runId ? `run ${c.runId.slice(0, 8)}` : "registry"}
                </span>
              </div>
              {c.summaries.length > 0 && (
                <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                  {c.summaries.slice(0, 3).map((s) => (
                    <li key={s.summary} className="line-clamp-1">
                      {s.summary}
                      {c.count > 1 && s.count !== c.count && <span className="tabular text-muted-foreground"> ×{s.count}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {c.count > 1 && c.labels.length > 0 && (
                <details className="group/lb mt-1">
                  <summary className="cursor-pointer list-none text-[11px] text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <span className="group-open/lb:hidden">Show {c.labels.length < c.count ? `first ${c.labels.length}` : `all ${c.count}`}</span>
                    <span className="hidden group-open/lb:inline">Hide list</span>
                  </summary>
                  <p className="mt-1 text-xs leading-relaxed text-foreground/80">
                    {c.labels.join(" · ")}
                    {c.labels.length < c.count && <span className="text-muted-foreground"> · +{c.count - c.labels.length} more</span>}
                  </p>
                </details>
              )}
            </li>
          );
        })}
      </ol>
      {changes.pages > 1 && (
        <nav aria-label="Change history pages" className="flex items-center justify-between gap-2 text-xs">
          <span className="tabular text-muted-foreground">
            Page {changes.page} of {changes.pages} · {formatCount(changes.total)} events in {formatCount(changes.batches)} batches
          </span>
          <span className="flex gap-1.5">
            {changes.page > 1 ? (
              <Link href={href(changes.page - 1)} scroll={false} className="inline-flex h-7 items-center gap-1 rounded-md border bg-card px-2 hover:bg-accent" rel="prev">
                <ChevronLeftIcon className="size-3.5" aria-hidden /> Newer
              </Link>
            ) : null}
            {changes.page < changes.pages ? (
              <Link href={href(changes.page + 1)} scroll={false} className="inline-flex h-7 items-center gap-1 rounded-md border bg-card px-2 hover:bg-accent" rel="next">
                Older <ChevronRightIcon className="size-3.5" aria-hidden />
              </Link>
            ) : null}
          </span>
        </nav>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

const SUBJECT_LABELS: Record<string, string> = {
  design_system: "System facts",
  component: "Components",
  token_set: "Token sets",
  token: "Tokens",
  pattern: "Patterns",
  source: "Sources",
};

export function EvidenceSection({ detail }: { detail: SystemDetail }) {
  const bySubject = new Map<string, { total: number; states: Map<string, number> }>();
  for (const r of detail.evidenceBySubject) {
    const cur = bySubject.get(r.subjectType) ?? { total: 0, states: new Map() };
    cur.total += r.count;
    cur.states.set(r.state, (cur.states.get(r.state) ?? 0) + r.count);
    bySubject.set(r.subjectType, cur);
  }
  const rows: EvidenceRow[] = detail.factEvidence.map((e) => ({ ...e }));
  return (
    <div className="space-y-4">
      <dl className="flex flex-wrap gap-px overflow-hidden rounded-xl border bg-border">
        {[...bySubject.entries()].sort((a, b) => b[1].total - a[1].total).map(([subject, v]) => (
          <div key={subject} className="min-w-[9rem] flex-1 bg-card px-4 py-3">
            <dt className="text-[11px] text-muted-foreground">{SUBJECT_LABELS[subject] ?? subject}</dt>
            <dd className="tabular text-lg font-semibold tracking-tight">{formatCount(v.total)}</dd>
            <dd className="text-[11px] text-muted-foreground">
              {[...v.states.entries()].map(([s, n], i) => (
                <span key={s}>
                  {i > 0 && " · "}
                  {formatCount(n)} {s}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">System-level evidence ({rows.length})</h3>
        <EvidenceList rows={rows} emptyLabel="No system-level evidence recorded." />
        <p className="text-[11px] text-muted-foreground">Component, token and pattern evidence is shown on each record&apos;s own page.</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Registry notes                                                              */
/* -------------------------------------------------------------------------- */

const RELATION_LABELS: Record<RelatedSystem["relation"], string> = {
  related: "Related",
  "related-from": "Lists this as related",
  replaces: "Replaces (rejected candidate)",
  "replaced-by": "Replaced by",
  "duplicate-of": "Duplicate of",
  "duplicated-by": "Duplicate entry merged here",
};

export function RegistrySection({ detail }: { detail: SystemDetail }) {
  const { core, related } = detail;
  const checksOk = core.registryChecks.filter((c) => c.ok).length;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">Classification &amp; deduplication reasoning</h3>
        {core.registryNotes ? <p className="text-[13px] leading-relaxed text-foreground/90">{core.registryNotes}</p> : <MissingValue state="not-extracted" />}
        <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border/70 pt-3 text-xs">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Registry status</dt>
            <dd className="capitalize">{core.registryStatus}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Queue position</dt>
            <dd className="tabular">{core.registryRank !== null ? `#${core.registryRank}` : "Replacement (unranked)"}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Registry checks</dt>
            <dd className="tabular">
              {checksOk} of {core.registryChecks.length} passed
            </dd>
          </div>
        </dl>
      </div>
      <div className="space-y-2.5 rounded-xl border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">Related registry entries</h3>
        {related.length ? (
          <ul className="space-y-2">
            {related.map((r) => (
              <li key={`${r.relation}:${r.slug}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <SystemMark name={r.name} slug={r.slug} size="sm" />
                  {r.published ? (
                    <Link href={`/systems/${r.slug}`} className="truncate font-medium hover:underline">
                      {r.name}
                    </Link>
                  ) : (
                    <Link href="/systems?registry=all" className="truncate hover:underline" title="Not a published system; see registry decisions">
                      {r.name} <span className="text-xs text-muted-foreground">({r.registryStatus})</span>
                    </Link>
                  )}
                </span>
                <span className="shrink-0 text-right text-[11px] text-muted-foreground">{RELATION_LABELS[r.relation]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No related, replaced or duplicate entries recorded.</p>
        )}
      </div>
    </div>
  );
}
