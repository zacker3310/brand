import Form from "next/form";
import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon, DownloadIcon, LockIcon, SearchIcon, XIcon } from "lucide-react";
import { SourceLink, VerificationBadge } from "@/components/atlas";
import { Button } from "@/components/ui/button";
import { TOKEN_CATEGORIES, type Redistribution, type TokenCategory } from "@/lib/contracts";
import { cn, formatCount, hostname } from "@/lib/utils";
import type { AliasStateKey, ScopeStats, TokenSetInfo, TokenSystemDetail, TokenSystemOption } from "@/server/queries/tokens";
import { ALIAS_STATE_META } from "./alias-state";
import { NativeSelect, NoJsSubmit } from "./controls";
import { exportDecision, licenseHref } from "./lib/export";
import { explorerHref, type ExplorerParams, type ExplorerView } from "./lib/params";
import { themeShortLabel } from "./lib/values";

export const CATEGORY_LABELS: Record<TokenCategory, string> = {
  color: "Color",
  typography: "Typography",
  spacing: "Spacing",
  shape: "Shape",
  elevation: "Elevation",
  motion: "Motion",
  layout: "Layout",
  opacity: "Opacity",
  other: "Other",
};

export interface ExplorerModel {
  params: ExplorerParams;
  system: TokenSystemDetail;
  systems: TokenSystemOption[];
  sets: TokenSetInfo[];
  scopeSets: TokenSetInfo[];
  selectedSet: TokenSetInfo | null;
  themes: string[];
  themedSets: TokenSetInfo[];
  category: TokenCategory;
  stats: ScopeStats;
}

/** Navigation href that never carries the inspected token. */
export function nav(m: Pick<ExplorerModel, "params">, patch: Partial<ExplorerParams>) {
  return explorerHref({ ...m.params, token: undefined }, { ...patch, token: undefined });
}

export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // Postgres ::text timestamps look like "2026-11-05 04:41:55.538+00"; make them ISO 8601.
  const d = new Date(iso.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

const REDIST_META: Record<Redistribution, { label: string; className: string }> = {
  permitted: { label: "Redistribution permitted", className: "border-verified/30 bg-verified-soft text-[color:color-mix(in_oklch,var(--verified)_70%,var(--foreground))]" },
  conditional: { label: "Redistribution conditional", className: "border-inferred/30 bg-inferred-soft text-[color:color-mix(in_oklch,var(--inferred)_70%,var(--foreground))]" },
  restricted: { label: "Redistribution restricted", className: "border-conflicting/30 bg-conflicting-soft text-[color:color-mix(in_oklch,var(--conflicting)_70%,var(--foreground))]" },
  unknown: { label: "Redistribution unknown", className: "border-dashed border-unavailable/50 text-[color:color-mix(in_oklch,var(--unavailable)_70%,var(--foreground))]" },
};

export function RedistributionChip({ value }: { value: Redistribution }) {
  const m = REDIST_META[value] ?? REDIST_META.unknown;
  return <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap", m.className)}>{m.label}</span>;
}

export function ThemeChip({ theme, className }: { theme: string | null; className?: string }) {
  if (!theme) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10.5px] leading-none whitespace-nowrap text-muted-foreground", className)}>
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", theme.startsWith("dark") ? "bg-foreground/70" : "border border-foreground/40 bg-background")}
      />
      {theme}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Scope rail (system, sets, theme)                                            */
/* -------------------------------------------------------------------------- */

/** Suffix shared by every set name (", M3 token DB 34.0.21"), shown once instead of on every row. */
export function sharedNameSuffix(names: readonly string[]): string | null {
  if (names.length < 2) return null;
  const tails = names.map((n) => {
    const i = n.lastIndexOf(", ");
    return i > 0 ? n.slice(i + 2) : null;
  });
  const first = tails[0];
  return first && tails.every((t) => t === first) ? first : null;
}

export function shortSetName(name: string, suffix: string | null): string {
  return suffix && name.endsWith(`, ${suffix}`) ? name.slice(0, -(suffix.length + 2)) : name;
}

export function ScopeRail({ m }: { m: ExplorerModel }) {
  const allCount = m.sets.reduce((a, s) => a + s.tokenCount, 0);
  const suffix = sharedNameSuffix(m.sets.map((s) => s.name));
  return (
    <div className="space-y-6">
      <Form action="/tokens" className="flex items-end gap-2">
        <NativeSelect
          name="system"
          label="Design system"
          defaultValue={m.system.slug}
          className="flex-1"
          options={m.systems.map((s) => ({ value: s.slug, label: `${s.name} · ${formatCount(s.tokenCount)}` }))}
        />
        <NoJsSubmit />
      </Form>

      {/* Mobile / tablet: compact set + theme pickers */}
      <Form action="/tokens" className="flex items-end gap-2 lg:hidden">
        <input type="hidden" name="system" value={m.system.slug} />
        <input type="hidden" name="category" value={m.category} />
        {m.params.view !== "visual" && <input type="hidden" name="view" value={m.params.view} />}
        {m.params.q && <input type="hidden" name="q" value={m.params.q} />}
        <NativeSelect
          name="set"
          label="Token set"
          defaultValue={m.selectedSet?.slug ?? ""}
          className="min-w-0 flex-1"
          options={[
            { value: "", label: `All sets · ${formatCount(allCount)}` },
            ...m.sets.map((s) => ({ value: s.slug, label: `${s.name}${s.theme ? ` (${s.theme})` : ""} · ${formatCount(s.tokenCount)}` })),
          ]}
        />
        <NoJsSubmit />
      </Form>

      <nav aria-label="Token sets" className="hidden space-y-1 lg:block">
        <p className="type-eyebrow text-muted-foreground mb-2">Token sets</p>
        {suffix && <p className="mb-2 text-[11px] text-muted-foreground">All from {suffix}</p>}
        <ul className="space-y-0.5">
          <li>
            <SetLink href={nav(m, { set: undefined })} active={!m.selectedSet} title="All sets" count={allCount} />
          </li>
          {m.sets.map((s) => (
            <li key={s.id}>
              <SetLink
                href={nav(m, { set: s.slug, theme: undefined })}
                active={m.selectedSet?.id === s.id}
                title={shortSetName(s.name, suffix)}
                count={s.tokenCount}
                theme={s.theme}
                meta={s}
              />
            </li>
          ))}
        </ul>
      </nav>

      {!m.selectedSet && m.themes.length > 0 && (
        <nav aria-label="Theme filter" className="space-y-2">
          <p className="type-eyebrow text-muted-foreground">Theme</p>
          <div className="flex flex-wrap gap-1.5">
            {[undefined, ...m.themes].map((t) => {
              const active = m.params.theme === t;
              return (
                <Link
                  key={t ?? "all"}
                  href={nav(m, { theme: t })}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs transition-colors hover:bg-accent",
                    active ? "border-primary/40 bg-accent text-accent-foreground" : "text-muted-foreground",
                  )}
                >
                  {t ? themeShortLabel(t, t) : "All themes"}
                </Link>
              );
            })}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">A theme keeps theme-agnostic sets and drops sets authored for other themes.</p>
        </nav>
      )}
    </div>
  );
}

function SetLink({
  href,
  active,
  title,
  count,
  theme,
  meta,
}: {
  href: string;
  active: boolean;
  title: string;
  count: number;
  theme?: string | null;
  meta?: Pick<TokenSetInfo, "format" | "packageName" | "packageVersion" | "license" | "redistribution">;
}) {
  const detail = meta
    ? [meta.format, meta.packageName ? `${meta.packageName}${meta.packageVersion ? `@${meta.packageVersion}` : ""}` : null, meta.license?.spdxId ?? meta.license?.name, `redistribution ${meta.redistribution}`]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-accent/70",
        active ? "bg-accent text-accent-foreground" : "text-foreground/85",
      )}
    >
      <span className="min-w-0 flex-1" title={detail}>
        <span className="line-clamp-2 leading-snug">{title}</span>
        {meta && (
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {theme && <ThemeChip theme={theme} />}
            <span className="font-mono text-[10.5px] leading-none text-muted-foreground">{meta.format}</span>
            {meta.redistribution !== "permitted" && (
              <span className="inline-flex items-center gap-0.5 font-mono text-[10.5px] leading-none text-muted-foreground">
                <LockIcon className="size-2.5" aria-hidden />
                {meta.redistribution}
              </span>
            )}
          </span>
        )}
      </span>
      <span className="tabular shrink-0 pt-px font-mono text-[11px] text-muted-foreground">{formatCount(count)}</span>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Set / scope summary                                                         */
/* -------------------------------------------------------------------------- */

export function ScopeSummary({ m }: { m: ExplorerModel }) {
  const s = m.selectedSet;
  if (!s) {
    const pkgs = [...new Set(m.scopeSets.map((x) => (x.packageName ? `${x.packageName}${x.packageVersion ? `@${x.packageVersion}` : ""}` : null)).filter(Boolean))] as string[];
    const lics = [...new Map(m.scopeSets.filter((x) => x.license).map((x) => [x.license!.slug, x.license!])).values()];
    const tokens = m.scopeSets.reduce((a, x) => a + x.tokenCount, 0);
    return (
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">
            {m.params.theme ? `${formatCount(m.scopeSets.length)} sets for the ${m.params.theme} theme` : `All ${formatCount(m.scopeSets.length)} sets`}
            <span className="tabular font-normal text-muted-foreground"> · {formatCount(tokens)} tokens</span>
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {pkgs.length ? pkgs.join(" · ") : "Package not recorded"}
            {lics.length ? ` · ${lics.map((l) => l.spdxId ?? l.name).join(", ")}` : ""}
          </p>
        </div>
        <p className="text-xs text-muted-foreground sm:max-w-56 sm:text-right">Pick a set to see its source and download it where the license permits.</p>
      </div>
    );
  }
  const decision = exportDecision(s.redistribution);
  const exportBase = `/tokens/export/${encodeURIComponent(m.system.slug)}/${encodeURIComponent(s.slug)}`;
  const retrieved = formatDate(s.retrievedAt);
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">{s.name}</h2>
            <ThemeChip theme={s.theme} />
            <RedistributionChip value={s.redistribution} />
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
            <div className="flex gap-1.5">
              <dt className="sr-only">Format</dt>
              <dd>{s.format}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="sr-only">Package</dt>
              <dd>{s.packageName ? `${s.packageName}${s.packageVersion ? `@${s.packageVersion}` : ""}` : "package not recorded"}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="sr-only">License</dt>
              <dd>
                {s.license ? (
                  licenseHref(s.license) ? (
                    <a className="link-underline" href={licenseHref(s.license)!} target="_blank" rel="noopener noreferrer">
                      {s.license.spdxId ?? s.license.name}
                    </a>
                  ) : (
                    (s.license.spdxId ?? s.license.name)
                  )
                ) : (
                  "license not recorded"
                )}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="sr-only">Tokens</dt>
              <dd className="tabular">{formatCount(s.tokenCount)} tokens</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            Data from <SourceLink href={s.sourceUrl} className="text-xs">{hostname(s.sourceUrl) ?? "source"}</SourceLink>
            {retrieved ? ` · retrieved ${retrieved}` : " · retrieval time not recorded"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {decision.allowed ? (
            <>
              <Button asChild size="sm" variant="outline">
                <a href={`${exportBase}?format=json`} download>
                  <DownloadIcon aria-hidden /> JSON
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={`${exportBase}?format=css`} download>
                  <DownloadIcon aria-hidden /> CSS
                </a>
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled aria-describedby="export-reason">
                <LockIcon aria-hidden /> JSON
              </Button>
              <Button size="sm" variant="outline" disabled aria-describedby="export-reason">
                <LockIcon aria-hidden /> CSS
              </Button>
            </>
          )}
        </div>
      </div>
      {!decision.allowed && (
        <p id="export-reason" className="rounded-md border border-dashed bg-surface-1 px-3 py-2 text-xs text-muted-foreground">
          Download unavailable. {decision.reason}{" "}
          <SourceLink href={s.sourceUrl} className="text-xs">
            Open the official source
          </SourceLink>
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Alias resolution stats                                                      */
/* -------------------------------------------------------------------------- */

const STATE_ORDER: AliasStateKey[] = ["literal", "resolved", "theme-dependent", "external", "unresolved", "cycle"];

export function AliasStats({ m }: { m: ExplorerModel }) {
  const counts = m.stats.states[m.category];
  const total = STATE_ORDER.reduce((a, k) => a + counts[k], 0);
  return (
    <section aria-labelledby="alias-stats-title" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="alias-stats-title" className="text-xs font-medium text-muted-foreground">
          Alias resolution · {CATEGORY_LABELS[m.category].toLowerCase()} tokens in scope
        </h2>
        {m.params.state && (
          <Link href={nav(m, { state: undefined })} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <XIcon className="size-3" aria-hidden /> Clear state filter
          </Link>
        )}
      </div>
      {total > 0 ? (
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          {STATE_ORDER.filter((k) => counts[k] > 0).map((k) => (
            <span key={k} className={cn("h-full", ALIAS_STATE_META[k].bar)} style={{ width: `${(counts[k] / total) * 100}%` }} />
          ))}
        </div>
      ) : (
        <div className="hatch h-1.5 rounded-full" aria-hidden />
      )}
      <ul className="flex flex-wrap gap-x-1 gap-y-1">
        {STATE_ORDER.map((k) => {
          const active = m.params.state === k;
          return (
            <li key={k}>
              <Link
                href={nav(m, { state: active ? undefined : k })}
                aria-current={active ? "true" : undefined}
                title={ALIAS_STATE_META[k].description}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent",
                  active ? "bg-accent text-accent-foreground" : "text-muted-foreground",
                )}
              >
                <span aria-hidden className={cn("size-2 rounded-sm", ALIAS_STATE_META[k].bar)} />
                {ALIAS_STATE_META[k].label}
                <span className="tabular font-mono text-foreground">{formatCount(counts[k])}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Category tabs, toolbar, pagination                                          */
/* -------------------------------------------------------------------------- */

export function CategoryTabs({ m }: { m: ExplorerModel }) {
  return (
    <nav aria-label="Token categories" className="-mx-4 relative overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b">
        {TOKEN_CATEGORIES.map((c) => {
          const n = m.stats.categories[c];
          const active = m.category === c;
          const keepView = m.params.view === "table" ? "table" : "visual";
          return (
            <li key={c}>
              <Link
                href={nav(m, { category: c, view: keepView })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
                  active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  n === 0 && !active && "text-muted-foreground",
                )}
              >
                {CATEGORY_LABELS[c]}
                <span className={cn("tabular rounded px-1 font-mono text-[11px]", active ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>{formatCount(n)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Toolbar({ m, resultLabel }: { m: ExplorerModel; resultLabel: string }) {
  const views: { view: ExplorerView; label: string }[] =
    m.category === "color"
      ? [
          { view: "visual", label: "Swatches" },
          ...(m.themedSets.length >= 2 ? [{ view: "themes" as const, label: "Themes" }] : []),
          { view: "contrast", label: "Contrast" },
          { view: "table", label: "Table" },
        ]
      : [
          { view: "visual", label: "Visual" },
          { view: "table", label: "Table" },
        ];
  const current = views.some((v) => v.view === m.params.view) ? m.params.view : "visual";
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Form action="/tokens" className="relative flex min-w-0 flex-1 items-center sm:max-w-sm" role="search">
        <input type="hidden" name="system" value={m.system.slug} />
        {m.selectedSet && <input type="hidden" name="set" value={m.selectedSet.slug} />}
        {m.params.theme && !m.selectedSet && <input type="hidden" name="theme" value={m.params.theme} />}
        <input type="hidden" name="category" value={m.category} />
        {current !== "visual" && <input type="hidden" name="view" value={current} />}
        {m.params.state && <input type="hidden" name="state" value={m.params.state} />}
        {m.params.a && <input type="hidden" name="a" value={m.params.a} />}
        {m.params.b && <input type="hidden" name="b" value={m.params.b} />}
        <label htmlFor="token-q" className="sr-only">
          Search tokens by name, CSS variable or value
        </label>
        <SearchIcon className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" aria-hidden />
        <input
          id="token-q"
          name="q"
          type="search"
          defaultValue={m.params.q}
          placeholder="Search name, --var or value"
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full rounded-md border border-input bg-background pr-16 pl-8 font-mono text-[13px] shadow-xs outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 dark:bg-input/30"
        />
        {m.params.q ? (
          <Link href={nav(m, { q: "" })} className="absolute right-2 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            Clear
          </Link>
        ) : (
          <kbd className="pointer-events-none absolute right-2 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">Enter</kbd>
        )}
      </Form>
      <div className="flex items-center justify-between gap-3">
        <p className="tabular text-xs text-muted-foreground" aria-live="polite">
          {resultLabel}
        </p>
        <nav aria-label="View" className="flex shrink-0 rounded-md border p-0.5">
          {views.map((v) => (
            <Link
              key={v.view}
              href={nav(m, { view: v.view })}
              aria-current={current === v.view ? "page" : undefined}
              className={cn(
                "rounded px-2.5 py-1 text-xs transition-colors",
                current === v.view ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function Pagination({ m, page, pages, label }: { m: ExplorerModel; page: number; pages: number; label?: string }) {
  if (pages <= 1) return null;
  const prev = page > 1 ? nav(m, { page: page - 1 }) : null;
  const next = page < pages ? nav(m, { page: page + 1 }) : null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t pt-4">
      <p className="tabular text-xs text-muted-foreground">
        Page {formatCount(page)} of {formatCount(pages)}
        {label ? ` · ${label}` : ""}
      </p>
      <div className="flex gap-2">
        {prev ? (
          <Button asChild size="sm" variant="outline">
            <Link href={prev} scroll>
              <ArrowLeftIcon aria-hidden /> Previous
            </Link>
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled>
            <ArrowLeftIcon aria-hidden /> Previous
          </Button>
        )}
        {next ? (
          <Button asChild size="sm" variant="outline">
            <Link href={next} scroll>
              Next <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled>
            Next <ArrowRightIcon aria-hidden />
          </Button>
        )}
      </div>
    </nav>
  );
}

/** Inferred-tier marker used in lists and tables. */
const TIER_INFERRED = "Tier inferred by ATLAS from naming and alias structure; the source does not declare it.";

export function TierMark({ tier, tierState, plain = false }: { tier: string | null; tierState: string; plain?: boolean }) {
  if (!tier) return <span className="text-muted-foreground" title="Tier not recorded">—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span>{tier}</span>
      {tierState === "inferred" &&
        (plain ? (
          <span title={TIER_INFERRED} className="rounded-full border border-inferred/25 bg-inferred-soft px-1.5 py-px text-[10px] leading-none font-medium text-[color:color-mix(in_oklch,var(--inferred)_70%,var(--foreground))]">
            Inferred
          </span>
        ) : (
          <VerificationBadge state="inferred" compact detail={TIER_INFERRED} />
        ))}
    </span>
  );
}
