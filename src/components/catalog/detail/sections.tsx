import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { CoverageChip, MissingValue, SourceLink, SystemMark, VerificationBadge } from "@/components/atlas";
import { Kbd } from "@/components/ui/kbd";
import { COMPONENT_FIELDS, type CoverageMap, type CoverageState } from "@/lib/contracts";
import { cn, formatCount, hostname } from "@/lib/utils";
import type {
  ChangeEventRow,
  ComparableComponent,
  ComponentAccessibilityRow,
  ComponentExampleRow,
  ComponentFramework,
  ComponentRelationshipRow,
  ComponentStateRow,
  ComponentVariantRow,
} from "@/server/queries/components";
import { ClassificationBadge, LifecycleBadge } from "../badges";
import { ariaReference } from "../lib/apg";
import { FIELD_LABELS, fieldState } from "../lib/coverage";
import { formatDate, groupKeyboard } from "../lib/format";
import { componentHref, componentTypeHref } from "../lib/urls";

/* -------------------------------------------------------------------------- */

export const FIELD_SECTION: Record<string, string> = {
  description: "overview",
  responsive: "overview",
  frameworks: "frameworks",
  variants: "variants",
  sizes: "variants",
  states: "states",
  properties: "api",
  accessibility: "accessibility",
  keyboard: "accessibility",
  tokens: "tokens",
  relationships: "relationships",
  examples: "examples",
};

const PANEL_LABELS: Partial<Record<string, string>> = { accessibility: "A11y", relationships: "Relations", properties: "Props" };

export function CoveragePanel({ coverage }: { coverage: CoverageMap }) {
  return (
    <section aria-labelledby="coverage-title" className="rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="coverage-title" className="text-[13px] font-semibold">
          Coverage
        </h2>
        <p className="text-[11px] text-muted-foreground">What the source documents, per field</p>
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 min-[420px]:grid-cols-2">
        {COMPONENT_FIELDS.map((f) => (
          <li key={f} className="flex min-w-0 items-center justify-between gap-2 text-[12.5px]">
            <a href={`#${FIELD_SECTION[f] ?? "overview"}`} className="truncate text-muted-foreground hover:text-foreground" title={FIELD_LABELS[f]}>
              {PANEL_LABELS[f] ?? FIELD_LABELS[f]}
            </a>
            <CoverageChip state={fieldState(coverage, f)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SectionNav({ items }: { items: { id: string; label: string; count?: number | null; muted?: boolean }[] }) {
  // A zero count is not shown as "0": empty sections explain why on the page (not documented vs not extracted).
  return (
    <nav aria-label="On this page" className="text-[13px]">
      <p className="type-eyebrow text-muted-foreground mb-2 hidden lg:block">On this page</p>
      <ul className="relative -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0">
        {items.map((it) => (
          <li key={it.id} className="shrink-0">
            <a
              href={`#${it.id}`}
              className={cn(
                "flex items-center justify-between gap-3 rounded-md border px-2.5 py-1 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground lg:border-transparent lg:px-2 lg:py-1.5 lg:hover:bg-accent/60",
                (it.muted || it.count === 0) && "text-muted-foreground",
              )}
            >
              {it.label}
              {it.count !== undefined && it.count !== null && it.count > 0 && (
                <span className="tabular font-mono text-[10.5px] text-muted-foreground">{formatCount(it.count)}</span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Section wrapper with a heading, an optional coverage chip, and anchor id. */
export function DetailSection({
  id,
  title,
  state,
  description,
  children,
  aside,
}: {
  id: string;
  title: string;
  state?: CoverageState;
  description?: React.ReactNode;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border/70 pb-2.5">
        <div className="space-y-1">
          <h2 id={`${id}-title`} className="flex items-center gap-2.5 text-base font-semibold tracking-tight">
            {title}
            {state && <CoverageChip state={state} />}
          </h2>
          {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Empty-field explanation: why there is nothing to show. */
export function Missing({ state, what, compact = false }: { state: CoverageState; what: string; compact?: boolean }) {
  const text: Record<CoverageState, string> = {
    documented: `ATLAS recorded ${what} as documented, but no values were stored.`,
    "documented-none": `The source explicitly documents no ${what}.`,
    "not-documented": `The official source does not document ${what}. That is absent documentation, not evidence of an absent capability.`,
    "not-extracted": `ATLAS has not extracted ${what} for this component yet. Unknown, not empty.`,
    inferred: `ATLAS inferred ${what} heuristically; no source values are stored.`,
  };
  if (compact) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
        <MissingValue state={state} />
        <span>{text[state]}</span>
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-dashed px-3 py-3 text-[13px] text-muted-foreground">
      <MissingValue state={state} />
      <span>{text[state]}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function FrameworksList({ frameworks }: { frameworks: ComponentFramework[] }) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {frameworks.map((f) => (
        <li key={f.slug} className="rounded-lg border bg-card px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium">{f.name}</span>
            <span className="font-mono text-[10px] text-muted-foreground uppercase">{f.kind === "design" ? "Design asset" : f.kind}</span>
          </div>
          <dl className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {f.packageName && (
              <div className="flex gap-2">
                <dt className="sr-only">Package</dt>
                <dd className="font-mono text-foreground/85">{f.packageName}</dd>
              </div>
            )}
            {f.importName && (
              <div className="flex gap-1.5">
                <dt>Import</dt>
                <dd className="font-mono text-foreground/85">{f.importName}</dd>
              </div>
            )}
          </dl>
          {f.sourceUrl && (
            <SourceLink href={f.sourceUrl} className="mt-1 text-xs text-muted-foreground">
              {hostname(f.sourceUrl)}
            </SourceLink>
          )}
        </li>
      ))}
    </ul>
  );
}

export function VariantsBlock({ variants }: { variants: ComponentVariantRow[] }) {
  const byAxis = new Map<string, ComponentVariantRow[]>();
  for (const v of variants) byAxis.set(v.axis, [...(byAxis.get(v.axis) ?? []), v]);
  return (
    <div className="space-y-4">
      {[...byAxis.entries()].map(([axis, list]) => (
        <div key={axis} className="space-y-2">
          <h3 className="flex items-baseline gap-2 text-[13px] font-medium capitalize">
            {axis}
            <span className="tabular font-mono text-[11px] font-normal text-muted-foreground">{list.length}</span>
          </h3>
          {list.some((v) => v.description) ? (
            <dl className="divide-y divide-border/60 rounded-xl border bg-card">
              {list.map((v) => (
                <div key={v.name} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                  <dt className="font-mono text-[12.5px]">{v.name}</dt>
                  <dd className="text-[13px] text-foreground/85">{v.description ?? <span className="text-muted-foreground italic">no description stated</span>}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {list.map((v) => (
                <li key={v.name} className="rounded-md border bg-card px-2 py-1 font-mono text-[12px]">
                  {v.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

export function SizesBlock({ sizes, state }: { sizes: string[] | null; state: CoverageState }) {
  if (sizes === null) return <Missing state={state === "documented" ? "not-extracted" : state} what="sizes" />;
  if (sizes.length === 0) return <Missing state="documented-none" what="sizes" />;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Sizes">
      {sizes.map((s) => (
        <li key={s} className="rounded-md border bg-card px-2 py-1 font-mono text-[12px]">
          {s}
        </li>
      ))}
    </ul>
  );
}

export function StatesTable({ states }: { states: ComponentStateRow[] }) {
  return (
    <div className="relative overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-[13px]">
        <caption className="sr-only">Documented states and their ATLAS canonical state</caption>
        <thead className="border-b bg-surface-1 text-left">
          <tr className="font-mono text-[11px] tracking-[0.1em] text-muted-foreground uppercase">
            <th scope="col" className="px-3 py-2 font-medium">
              System name
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Canonical state
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Description
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {states.map((s) => (
            <tr key={s.name} className="align-top">
              <th scope="row" className="px-3 py-2 text-left font-mono text-[12.5px] font-normal">
                {s.name}
              </th>
              <td className="px-3 py-2">
                {s.canonical ? (
                  <span className="rounded border border-info/25 bg-info-soft px-1.5 py-0.5 font-mono text-[11px] text-info">{s.canonical}</span>
                ) : (
                  <span className="text-[12px] text-muted-foreground" title="ATLAS has no canonical state for this name">
                    unmapped
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-foreground/85">{s.description ?? <span className="text-muted-foreground italic">no description stated</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function KeyCombo({ keys }: { keys: string }) {
  // "Shift+Tab", "Enter or Space", "ArrowDown / ArrowUp": render key tokens as <kbd>, keep words.
  const parts = keys.split(/(\s*(?:\+|\/|,|\bor\b|\band\b)\s*)/i).filter((p) => p !== "");
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {parts.map((p, i) =>
        /^\s*(?:\+|\/|,|or|and)\s*$/i.test(p) ? (
          <span key={i} className="text-[11px] text-muted-foreground">
            {p.trim()}
          </span>
        ) : (
          <Kbd key={i} className="font-mono text-[11px] text-foreground/85">
            {p.trim()}
          </Kbd>
        ),
      )}
    </span>
  );
}

function A11yField({ label, state, children }: { label: string; state: CoverageState; children: React.ReactNode | null }) {
  return (
    <div className="grid gap-1.5 border-b border-border/60 py-3 last:border-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-[13.5px] leading-relaxed">{children ?? <MissingValue state={state} />}</dd>
    </div>
  );
}

export function AccessibilityBlock({
  a11y,
  coverage,
  typeAriaPattern,
}: {
  a11y: ComponentAccessibilityRow | null;
  coverage: CoverageMap;
  typeAriaPattern: string | null;
}) {
  const sub = (k: string, fallback: CoverageState): CoverageState => (a11y ? fieldState(a11y.coverage, k) : fallback);
  const compState = fieldState(coverage, "accessibility");
  const keyState = fieldState(coverage, "keyboard");
  const sourceRef = ariaReference(a11y?.ariaPattern);
  const typeRef = ariaReference(typeAriaPattern);
  return (
    <div className="space-y-4">
      <dl className="rounded-xl border bg-card px-4">
        <A11yField label="ARIA pattern" state={sub("ariaPattern", compState)}>
          {a11y?.ariaPattern ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              {sourceRef ? <SourceLink href={sourceRef.url}>{sourceRef.label}</SourceLink> : <code className="font-mono text-[12.5px]">{a11y.ariaPattern}</code>}
              <span className="text-xs text-muted-foreground">documented by the source</span>
            </span>
          ) : null}
        </A11yField>
        <A11yField label="Roles" state={sub("roles", compState)}>
          {a11y?.roles?.length ? (
            <span className="flex flex-wrap gap-1">
              {a11y.roles.map((r) => (
                <code key={r} className="rounded border bg-surface-1 px-1.5 py-0.5 font-mono text-[12px]">
                  {r}
                </code>
              ))}
            </span>
          ) : null}
        </A11yField>
        <A11yField label="Guidance" state={sub("guidance", compState)}>
          {a11y?.guidance ? <p className="text-pretty whitespace-pre-line text-foreground/90">{a11y.guidance}</p> : null}
        </A11yField>
        <A11yField label="Screen readers" state={sub("screenReader", compState)}>
          {a11y?.screenReader ? <p className="text-foreground/90">{a11y.screenReader}</p> : null}
        </A11yField>
        <A11yField label="Focus management" state={sub("focusManagement", compState)}>
          {a11y?.focusManagement ? <p className="text-foreground/90">{a11y.focusManagement}</p> : null}
        </A11yField>
        <A11yField label="WCAG criteria" state={sub("wcagCriteria", compState)}>
          {a11y?.wcagCriteria?.length ? (
            <span className="flex flex-wrap gap-1">
              {a11y.wcagCriteria.map((w) => (
                <span key={w} className="rounded border bg-surface-1 px-1.5 py-0.5 font-mono text-[12px]">
                  {w}
                </span>
              ))}
            </span>
          ) : null}
        </A11yField>
        {a11y?.docsUrl && (
          <A11yField label="Source" state="documented">
            <SourceLink href={a11y.docsUrl} showHost>
              Accessibility documentation
            </SourceLink>
          </A11yField>
        )}
      </dl>

      <div className="space-y-2">
        <h3 className="flex items-center gap-2.5 text-[13px] font-medium">
          Keyboard interactions <CoverageChip state={sub("keyboard", keyState)} />
        </h3>
        {a11y?.keyboard?.length ? (
          <div className="relative overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-[13px]">
              <caption className="sr-only">Documented keyboard interactions</caption>
              <thead className="border-b bg-surface-1 text-left">
                <tr className="font-mono text-[11px] tracking-[0.1em] text-muted-foreground uppercase">
                  <th scope="col" className="w-56 px-3 py-2 font-medium">
                    Keys
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Action
                  </th>
                </tr>
              </thead>
              {groupKeyboard(a11y.keyboard).map((g, gi) => (
                <tbody key={`${g.context ?? "all"}-${gi}`} className="divide-y divide-border/60 border-b border-border/60 last:border-0">
                  {g.context && (
                    <tr>
                      <th scope="colgroup" colSpan={2} className="bg-surface-1/60 px-3 pt-2.5 pb-1.5 text-left text-xs font-medium text-muted-foreground">
                        {g.context}
                      </th>
                    </tr>
                  )}
                  {g.rows.map((k, i) => (
                    <tr key={`${k.keys.join("|")}-${i}`} className="align-top">
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        <span className="flex flex-wrap gap-x-1.5 gap-y-1">
                          {k.keys.map((key, ki) => (
                            <KeyCombo key={`${key}-${ki}`} keys={key} />
                          ))}
                        </span>
                      </th>
                      <td className="px-3 py-2 text-foreground/90">{k.action}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        ) : (
          <Missing state={sub("keyboard", keyState)} what="keyboard interactions" />
        )}
      </div>

      {typeRef && (
        <p className="text-xs text-muted-foreground">
          ATLAS reference for this canonical type: <SourceLink href={typeRef.url} className="text-xs">{typeRef.kind === "apg-pattern" ? `WAI-ARIA APG ${typeRef.label}` : typeRef.label}</SourceLink>. This is
          ATLAS&apos;s cross-system reference, not a claim about this implementation.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const REL_LABEL: Record<string, string> = {
  subcomponent: "Subcomponents",
  parent: "Part of",
  "composed-of": "Composed of",
  composes: "Composes",
  alternative: "Alternatives",
  related: "Related",
  "see-also": "See also",
  "replaced-by": "Replaced by",
  extends: "Extends",
  replaces: "Replaces",
};

export function RelationshipsBlock({ rels, systemSlug }: { rels: ComponentRelationshipRow[]; systemSlug: string }) {
  const outbound = rels.filter((r) => r.direction === "outbound");
  const inbound = rels.filter((r) => r.direction === "inbound");
  const byKind = new Map<string, ComponentRelationshipRow[]>();
  for (const r of outbound) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  const inboundUnique = [...new Map(inbound.filter((r) => r.target).map((r) => [`${r.target!.systemSlug}/${r.target!.slug}`, r])).values()];
  return (
    <div className="space-y-4">
      {outbound.length > 0 && (
        <dl className="divide-y divide-border/60 rounded-xl border bg-card">
          {[...byKind.entries()].map(([kind, list]) => (
            <div key={kind} className="grid gap-1.5 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-[13px] text-muted-foreground">{REL_LABEL[kind] ?? kind}</dt>
              <dd className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-[13.5px]">
                {list.map((r, i) => (
                  <Fragment key={`${r.kind}-${r.target?.slug ?? r.targetType?.slug ?? i}`}>
                    {i > 0 && <span aria-hidden className="text-subtle-foreground">{" · "}</span>}
                    {r.target ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Link href={componentHref(r.target.systemSlug, r.target.slug)} className="underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground">
                          {r.target.name}
                        </Link>
                        {r.target.systemSlug !== systemSlug && <span className="text-xs text-muted-foreground">({r.target.systemName})</span>}
                        <LifecycleBadge lifecycle={r.target.lifecycle} dense />
                      </span>
                    ) : r.targetType ? (
                      <Link href={componentTypeHref(r.targetType.slug)} className="underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground">
                        {r.targetType.name} <span className="text-xs text-muted-foreground">(canonical type)</span>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground italic">target not indexed</span>
                    )}
                    {r.verificationState !== "verified" && <VerificationBadge state={r.verificationState} compact />}
                  </Fragment>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {inboundUnique.length > 0 && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          <span className="text-foreground/80">Referenced by</span>{" "}
          {inboundUnique.map((r, i) => (
            <Fragment key={`${r.target!.systemSlug}/${r.target!.slug}`}>
              {i > 0 && ", "}
              <Link href={componentHref(r.target!.systemSlug, r.target!.slug)} className="link-underline text-foreground/90">
                {r.target!.name}
              </Link>
            </Fragment>
          ))}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const VISIBLE_CODE = 4;
const VISIBLE_LINKS = 8;

function CodeExample({ ex, open = false }: { ex: ComponentExampleRow; open?: boolean }) {
  return (
    <details open={open} className="group/code relative overflow-hidden rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 bg-surface-1 px-3 py-2 group-open/code:border-b [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-open/code:rotate-90" aria-hidden />
          {ex.title}
        </span>
        <span className="flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground uppercase">
          {ex.language && <span>{ex.language}</span>}
          {ex.license && <span className="rounded border px-1 py-px normal-case">{ex.license.name}</span>}
        </span>
      </summary>
      <pre tabIndex={0} aria-label={`${ex.title} code`} className="relative max-h-72 overflow-auto p-3 font-mono text-[12px] leading-relaxed text-foreground/90">
        <code>{ex.code}</code>
      </pre>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span className="min-w-0">{ex.attribution ?? "Attribution not recorded"}</span>
        <span className="flex shrink-0 items-center gap-3">
          {ex.license?.url && (
            <SourceLink href={ex.license.url} className="text-[11px]">
              License
            </SourceLink>
          )}
          {ex.url && (
            <SourceLink href={ex.url} className="text-[11px]">
              View source
            </SourceLink>
          )}
        </span>
      </div>
    </details>
  );
}

function LinkList({ items }: { items: ComponentExampleRow[] }) {
  return (
    <ul className="divide-y divide-border/60">
      {items.map((e) => (
        <li key={e.slug} className="flex items-center justify-between gap-3 px-3 py-2">
          {e.url ? <SourceLink href={e.url}>{e.title}</SourceLink> : <span>{e.title}</span>}
          <span className="hidden font-mono text-[10.5px] text-muted-foreground sm:inline">{hostname(e.url)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ExamplesBlock({ examples }: { examples: ComponentExampleRow[] }) {
  const code = examples.filter((e) => e.kind === "code-snippet" && e.code);
  const docs = examples.filter((e) => e.kind === "docs-link" || (e.kind === "code-snippet" && !e.code));
  const stories = examples.filter((e) => e.kind === "storybook-link");
  const other = examples.filter((e) => !["code-snippet", "docs-link", "storybook-link"].includes(e.kind));
  const linkGroups: [string, ComponentExampleRow[]][] = [
    ["Documentation examples", docs],
    ["Storybook stories", stories],
    ["Other references", other],
  ];
  return (
    <div className="space-y-6">
      {code.length > 0 && (
        <div className="space-y-3">
          <h3 className="flex items-baseline gap-2 text-[13px] font-medium">
            Code <span className="tabular font-mono text-[11px] font-normal text-muted-foreground">{code.length}</span>
          </h3>
          <p className="text-xs text-muted-foreground">
            Stored because the source license permits redistribution; shown as text with attribution and never executed.
          </p>
          <div className="space-y-2">
            {code.slice(0, VISIBLE_CODE).map((e, i) => (
              <CodeExample key={e.slug} ex={e} open={i === 0} />
            ))}
          </div>
          {code.length > VISIBLE_CODE && (
            <details className="group/more">
              <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                <span className="group-open/more:hidden">Show {code.length - VISIBLE_CODE} more code examples</span>
                <span className="hidden group-open/more:inline">Show fewer</span>
              </summary>
              <div className="mt-2 space-y-2">
                {code.slice(VISIBLE_CODE).map((e) => (
                  <CodeExample key={e.slug} ex={e} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      {linkGroups
        .filter(([, list]) => list.length > 0)
        .map(([label, list]) => (
          <div key={label} className="space-y-2">
            <h3 className="flex items-baseline gap-2 text-[13px] font-medium">
              {label} <span className="tabular font-mono text-[11px] font-normal text-muted-foreground">{list.length}</span>
            </h3>
            <div className="rounded-xl border bg-card">
              <LinkList items={list.slice(0, VISIBLE_LINKS)} />
              {list.length > VISIBLE_LINKS && (
                <details className="group/more border-t border-border/60">
                  <summary className="flex min-h-9 cursor-pointer list-none items-center px-3 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <span className="group-open/more:hidden">Show {list.length - VISIBLE_LINKS} more</span>
                    <span className="hidden group-open/more:inline">Show fewer</span>
                  </summary>
                  <LinkList items={list.slice(VISIBLE_LINKS)} />
                </details>
              )}
            </div>
          </div>
        ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function ComparableGrid({ items, typeName }: { items: ComparableComponent[]; typeName: string }) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label={`Other ${typeName} implementations`}>
      {items.map((c) => (
        <li key={`${c.systemSlug}/${c.slug}`}>
          <Link
            href={componentHref(c.systemSlug, c.slug)}
            className="group flex h-full items-start gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-foreground/25"
          >
            <SystemMark name={c.systemName} slug={c.systemSlug} size="sm" />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13.5px] font-medium group-hover:underline group-hover:underline-offset-4">{c.name}</span>
                <LifecycleBadge lifecycle={c.lifecycle} dense />
              </span>
              <span className="block truncate text-xs text-muted-foreground">{c.systemName}</span>
              <span className="flex items-center gap-2 pt-0.5">
                <span className="h-1 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full bg-verified" style={{ width: `${Math.round(c.docShare * 100)}%` }} />
                </span>
                <span className="tabular font-mono text-[10.5px] text-muted-foreground">
                  {Math.round(c.docShare * 12)}/12 documented{c.propsCount > 0 ? ` · ${c.propsCount} props` : ""}
                </span>
              </span>
            </span>
            <ClassificationBadge state={c.classificationState} method={null} compact className="shrink-0" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ChangeHistory({ changes, firstSeenAt }: { changes: ChangeEventRow[]; firstSeenAt: Date }) {
  return (
    <ol className="relative space-y-0 border-l border-border pl-5">
      {changes.map((c) => (
        <li key={c.id} className="relative pb-4 last:pb-0">
          <span aria-hidden className="absolute top-[6px] -left-[25px] size-[9px] rounded-full bg-muted-foreground ring-4 ring-background" />
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
            <span className="font-medium capitalize">{c.changeKind.replace(/-/g, " ")}</span>
            <time dateTime={c.occurredAt.toISOString()} className="text-xs text-muted-foreground">
              {formatDate(c.occurredAt)}
            </time>
          </div>
          {c.fieldChanges && c.fieldChanges.length > 0 && (
            <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
              {c.fieldChanges.slice(0, 6).map((f, i) => (
                <li key={`${f.field}-${i}`}>
                  <code className="font-mono text-[11px] text-foreground/80">{f.field === "*" ? "record" : f.field}</code>
                  {f.summary ? `: ${f.summary}` : " changed"}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
      <li className="relative pt-1 text-xs text-muted-foreground">
        <span aria-hidden className="absolute top-[9px] -left-[25px] size-[9px] rounded-full border border-muted-foreground/60 bg-background ring-4 ring-background" />
        First seen by ATLAS {formatDate(firstSeenAt)}
      </li>
    </ol>
  );
}
