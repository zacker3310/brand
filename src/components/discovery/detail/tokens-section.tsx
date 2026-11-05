import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { SourceLink } from "@/components/atlas";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatCount } from "@/lib/utils";
import type { SystemDetail } from "@/server/queries/systems";
import { INFERRED_TEXT } from "../badges";
import { buildHref } from "../lib/params";
import { pickSwatches } from "../lib/swatches";

const ALIAS_META: Record<string, { label: string; description: string; className: string }> = {
  literal: { label: "Literal", description: "Value authored directly, no reference.", className: "bg-chart-1" },
  resolved: { label: "Resolved alias", description: "References another token; resolved to a concrete value.", className: "bg-chart-3" },
  "theme-dependent": {
    label: "Theme-dependent",
    description: "References a token that only exists in themed sets, so it resolves to a different value per theme.",
    className: "bg-chart-2",
  },
  external: { label: "External", description: "References a value outside this system's published token sets (e.g. a CSS variable or another package).", className: "bg-chart-4" },
  unresolved: { label: "Unresolved", description: "The reference target was not found in the published sets.", className: "bg-conflicting" },
  cycle: { label: "Cycle", description: "Circular reference; no value can be resolved.", className: "bg-conflicting" },
};
const ALIAS_ORDER = ["literal", "resolved", "theme-dependent", "external", "unresolved", "cycle"];

export function TokensSection({ detail }: { detail: SystemDetail }) {
  const { core, tokenSets, tokenCategories, aliasStates, tokenTiers, swatchCandidates, counts } = detail;
  const total = counts.tokens;
  const swatches = pickSwatches(swatchCandidates, 16);
  const themes = [...new Set(tokenSets.map((s) => s.theme).filter((t): t is string => !!t))];
  const maxCat = Math.max(1, ...tokenCategories.map((c) => c.count));
  const aliasSorted = ALIAS_ORDER.map((s) => aliasStates.find((a) => a.state === s) ?? { state: s, count: 0 }).concat(
    aliasStates.filter((a) => !ALIAS_ORDER.includes(a.state)),
  );
  const tiers = new Map<string, { verified: number; inferred: number }>();
  for (const t of tokenTiers) {
    const k = t.tier ?? "untiered";
    const cur = tiers.get(k) ?? { verified: 0, inferred: 0 };
    if (t.state === "verified") cur.verified += t.count;
    else cur.inferred += t.count;
    tiers.set(k, cur);
  }
  const explore = buildHref("/tokens", [["system", core.slug]]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <dt className="text-[11px] text-muted-foreground">Tokens</dt>
            <dd className="tabular text-2xl font-semibold tracking-tight">{formatCount(total)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Token sets</dt>
            <dd className="tabular text-2xl font-semibold tracking-tight">{tokenSets.length}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Themes</dt>
            <dd className="text-sm">{themes.length ? themes.join(", ") : <span className="text-muted-foreground">Theme-agnostic only</span>}</dd>
          </div>
        </dl>
        <Link href={explore} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-card px-3 text-[13px] font-medium shadow-xs hover:bg-accent">
          Explore all tokens <ArrowRightIcon className="size-3.5" aria-hidden />
        </Link>
      </div>

      {swatches.length > 0 && (
        <figure className="space-y-2">
          <figcaption className="text-xs text-muted-foreground">
            Sample of {swatches.length} resolved color tokens (light or theme-agnostic sets, semantic tier first)
          </figcaption>
          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {swatches.map((s) => (
              <li key={s.hex + s.name} className="min-w-0">
                <Link href={buildHref("/tokens", [["system", core.slug], ["q", s.name]])} className="group block rounded-lg focus-visible:outline-2">
                  <span className={cn("block h-10 overflow-hidden rounded-md border border-black/10 dark:border-white/10", s.translucent && "checker")}>
                    <span className="block size-full" style={{ backgroundColor: s.hex }} />
                  </span>
                  <span className="mt-1 block truncate font-mono text-[10.5px] text-foreground/85 group-hover:underline" title={s.name}>
                    {s.name}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground" title={`${s.display} · ${s.setSlug}`}>
                    {s.hex}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </figure>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-2.5 rounded-xl border bg-card p-4">
          <h3 className="text-xs font-medium text-muted-foreground">By category</h3>
          <ul className="space-y-1.5">
            {tokenCategories.map((c) => (
              <li key={c.category} className="grid grid-cols-[6rem_minmax(0,1fr)_3.5rem] items-center gap-3 text-[13px]">
                <Link href={buildHref("/tokens", [["system", core.slug], ["category", c.category]])} className="capitalize hover:underline">
                  {c.category}
                </Link>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.max(2, (c.count / maxCat) * 100)}%` }} />
                </span>
                <span className="tabular text-right text-xs">{formatCount(c.count)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="text-xs font-medium text-muted-foreground">Alias resolution</h3>
          <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={aliasSorted.filter((a) => a.count).map((a) => `${ALIAS_META[a.state]?.label ?? a.state}: ${a.count}`).join(", ")}>
            {aliasSorted
              .filter((a) => a.count > 0)
              .map((a) => (
                <span key={a.state} className={cn("h-full", ALIAS_META[a.state]?.className ?? "bg-muted-foreground")} style={{ width: `${(a.count / Math.max(total, 1)) * 100}%` }} />
              ))}
          </div>
          <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {aliasSorted.map((a) => {
              const meta = ALIAS_META[a.state] ?? { label: a.state, description: "", className: "bg-muted-foreground" };
              return (
                <li key={a.state} className={cn("flex items-center justify-between gap-2 text-[13px]", a.count === 0 && "text-muted-foreground")}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0} className="inline-flex cursor-help items-center gap-2">
                        <span className={cn("size-2 rounded-full", meta.className, a.count === 0 && "opacity-40")} aria-hidden />
                        {meta.label}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">{meta.description}</TooltipContent>
                  </Tooltip>
                  <span className="tabular text-xs">{formatCount(a.count)}</span>
                </li>
              );
            })}
          </ul>
          {tiers.size > 0 && (
            <p className="border-t border-border/70 pt-2.5 text-xs text-muted-foreground">
              Tiers:{" "}
              {[...tiers.entries()].map(([tier, v], i) => (
                <span key={tier}>
                  {i > 0 && " · "}
                  <span className="text-foreground/85">{tier}</span> {formatCount(v.verified + v.inferred)}
                  {v.inferred > 0 && v.verified === 0 && <span className={INFERRED_TEXT}> (inferred)</span>}
                  {v.inferred > 0 && v.verified > 0 && <span> ({formatCount(v.inferred)} inferred)</span>}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      <div className="relative overflow-x-auto rounded-xl border bg-card" role="region" aria-label="Token sets" tabIndex={0}>
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Published token sets with theme, format, token count and source package</caption>
          <thead>
            <tr className="border-b text-left text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
              <th scope="col" className="px-4 py-2 font-medium">Set</th>
              <th scope="col" className="px-3 py-2 font-medium">Theme</th>
              <th scope="col" className="px-3 py-2 font-medium">Format</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Tokens</th>
              <th scope="col" className="px-4 py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {tokenSets.map((s) => (
              <tr key={s.slug}>
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  <span className="block font-medium">{s.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{s.slug}</span>
                </th>
                <td className="px-3 py-2 text-xs">{s.theme ?? <span className="text-muted-foreground">agnostic</span>}</td>
                <td className="px-3 py-2 font-mono text-xs">{s.format}</td>
                <td className="tabular px-3 py-2 text-right text-xs">{formatCount(s.tokens)}</td>
                <td className="px-4 py-2 text-xs">
                  <SourceLink href={s.sourceUrl} className="text-xs">
                    {s.packageName ? `${s.packageName}${s.packageVersion ? `@${s.packageVersion}` : ""}` : "Source file"}
                  </SourceLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
