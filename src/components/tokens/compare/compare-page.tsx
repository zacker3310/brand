import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InfoIcon, RulerIcon } from "lucide-react";
import { EmptyState, PageContainer, PageHeader, SystemMark } from "@/components/atlas";
import { compareScales, extractScale } from "@/lib/tokens/compare";
import { cn, formatCount } from "@/lib/utils";
import { getScaleTokens, getSystemsBySlugs, listTokenSystems } from "@/server/queries/tokens";
import { buildScaleComparison, COMPARE_CATEGORIES, formatScaleValue, type CompareCategory, type ScaleComparisonView } from "../lib/scales";

type Raw = Record<string, string | string[] | undefined>;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SYSTEMS = 4;
const CATEGORY_LABEL: Record<CompareCategory, string> = { spacing: "Spacing", shape: "Shape", typography: "Typography" };

export function parseCompareParams(raw: Raw) {
  const sys = ([] as string[]).concat(raw.systems ?? []).flatMap((s) => s.split(",")).map((s) => s.trim()).filter((s) => SLUG.test(s));
  const systems = [...new Set(sys)].slice(0, MAX_SYSTEMS);
  const c = Array.isArray(raw.category) ? raw.category[0] : raw.category;
  const category: CompareCategory = (COMPARE_CATEGORIES as readonly string[]).includes(c ?? "") ? (c as CompareCategory) : "spacing";
  const tiers = (Array.isArray(raw.tiers) ? raw.tiers[0] : raw.tiers) === "all";
  return { systems, category, tiers, explicit: systems.length > 0 };
}

function compareHref(systems: string[], category: CompareCategory, tiers: boolean) {
  const usp = new URLSearchParams();
  if (systems.length) usp.set("systems", systems.join(","));
  usp.set("category", category);
  if (tiers) usp.set("tiers", "all");
  return `/tokens/compare?${usp.toString()}`;
}

export async function ComparePage({ raw }: { raw: Raw }) {
  const p = parseCompareParams(raw);
  const available = await listTokenSystems();
  const slugs = p.explicit ? p.systems : available.slice(0, 2).map((s) => s.slug);
  const systems = await getSystemsBySlugs(slugs);
  if (p.explicit && systems.length === 0) notFound();
  const tokens = await getScaleTokens(
    systems.map((s) => s.id),
    p.category === "spacing" ? ["spacing"] : p.category === "shape" ? ["shape"] : ["typography"],
    { includeComponentTier: p.tiers },
  );
  const inputs = systems.map((s) => tokens.get(s.id) ?? []);
  const views = buildScaleComparison(
    p.category,
    (i, key) => extractScale(inputs[i] ?? [], key),
    systems.length,
    (a, b) => {
      const c = compareScales(a, b);
      return { exact: c.summary.exact, overlap: c.summary.overlap };
    },
  );
  const tokenCounts = inputs.map((x) => x.length);

  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <Link href="/tokens" className="text-muted-foreground hover:text-foreground">
            Token explorer
          </Link>
        }
        title="Compare token scales"
        display
        description="Put the numeric scales of up to four systems side by side: spacing, corner radius and border widths, font sizes, weights, line heights and tracking."
      />

      <div role="note" className="mt-8 flex gap-3 rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-sm text-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div className="space-y-0.5">
          <p className="font-medium">Aligned by value, not by meaning; ATLAS does not imply semantic equivalence.</p>
          <p className="text-muted-foreground">
            Token names are not compared: a shared row only means each system defines a token with that numeric value. rem and em are converted at a 16px root.
          </p>
        </div>
      </div>

      <Form action="/tokens/compare" className="mt-6 grid gap-5 rounded-xl border bg-card p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <fieldset className="min-w-0 space-y-2">
          <legend className="type-eyebrow text-muted-foreground mb-2">Systems (up to {MAX_SYSTEMS})</legend>
          <div className="flex flex-wrap gap-2">
            {available.map((s) => {
              const checked = slugs.includes(s.slug);
              return (
                <label
                  key={s.slug}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors hover:bg-accent/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    checked && "border-primary/40 bg-accent/60",
                  )}
                >
                  <input type="checkbox" name="systems" value={s.slug} defaultChecked={checked} className="size-3.5 accent-[var(--primary)]" />
                  <SystemMark name={s.name} slug={s.slug} size="sm" className="size-5 text-[8px]" />
                  <span>{s.name}</span>
                  <span className="tabular font-mono text-[11px] text-muted-foreground">{formatCount(s.tokenCount)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-end gap-4">
          <fieldset className="space-y-2">
            <legend className="type-eyebrow text-muted-foreground mb-2">Scale</legend>
            <div className="flex rounded-md border p-0.5">
              {COMPARE_CATEGORIES.map((c) => (
                <label key={c} className="cursor-pointer rounded px-2.5 py-1 text-xs has-[:checked]:bg-accent has-[:checked]:font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                  <input type="radio" name="category" value={c} defaultChecked={p.category === c} className="sr-only" />
                  {CATEGORY_LABEL[c]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 pb-1.5 text-xs text-muted-foreground">
            <input type="checkbox" name="tiers" value="all" defaultChecked={p.tiers} className="size-3.5 accent-[var(--primary)]" />
            Include component tokens
          </label>
          <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Compare
          </button>
        </div>
      </Form>

      {!p.explicit && systems.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">Showing the two systems with the most indexed tokens. Choose others above.</p>
      )}

      <nav aria-label="Scale category" className="mt-8 flex gap-1 border-b">
        {COMPARE_CATEGORIES.map((c) => (
          <Link
            key={c}
            href={compareHref(slugs, c, p.tiers)}
            aria-current={p.category === c ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              p.category === c ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {CATEGORY_LABEL[c]}
          </Link>
        ))}
      </nav>

      {systems.length === 0 ? (
        <EmptyState className="mt-8" icon={RulerIcon} title="Choose at least one system" description="Select systems above to align their scales by value." />
      ) : (
        <div className="mt-8 space-y-14">
          {views.map((v) => (
            <ScaleSection key={v.key} v={v} systems={systems} tokenCounts={tokenCounts} tiers={p.tiers} categoryNoun={p.category} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function ScaleSection({
  v,
  systems,
  tokenCounts,
  tiers,
  categoryNoun,
}: {
  v: ScaleComparisonView;
  systems: { slug: string; name: string }[];
  tokenCounts: number[];
  tiers: boolean;
  categoryNoun: string;
}) {
  const total = v.perSystem.reduce((a, s) => a + s.steps.length, 0);
  // Bars are proportional up to 512px; sentinel values such as 9999px ("full" radius) are drawn off-scale.
  const pxValues = v.rows.filter((r) => r.unit === "px").map((r) => Math.abs(r.value));
  const inScale = pxValues.filter((x) => x <= 512);
  const maxPx = Math.max(0, ...(inScale.length ? inScale : pxValues));
  const id = `scale-${v.key}`;
  return (
    <section aria-labelledby={id} className="space-y-4">
      <div className="space-y-1">
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {v.label}
        </h2>
        <p className="text-sm text-muted-foreground">{v.description}</p>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {systems.map((s, i) => {
          const ps = v.perSystem[i]!;
          const ov = v.overlapWithFirst[i];
          return (
            <li key={s.slug} className="flex items-start gap-3 rounded-lg border p-3">
              <SystemMark name={s.name} slug={s.slug} size="sm" />
              <div className="min-w-0 space-y-0.5 text-xs">
                <p className="truncate text-sm font-medium">{s.name}</p>
                {ps.steps.length ? (
                  <p className="tabular text-muted-foreground">
                    {formatCount(ps.steps.length)} tokens · {formatCount(ps.values)} distinct values
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    None of its {formatCount(tokenCounts[i] ?? 0)} indexed {categoryNoun} tokens{tiers ? "" : " (component tier excluded)"} is a numeric {v.label.toLowerCase()} value. Not evidence the system has none.
                  </p>
                )}
                {ov && ps.steps.length > 0 && (
                  <p className="tabular text-muted-foreground">
                    {formatCount(ov.exact)} values shared with {systems[0]!.name} · {Math.round(ov.overlap * 100)}% overlap
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {total === 0 ? (
        <EmptyState icon={RulerIcon} title={`No ${v.label.toLowerCase()} tokens to align`} description="None of the selected systems has numeric tokens of this kind in its indexed token sets." />
      ) : (
        <div className="relative overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px] [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2">
            <caption className="sr-only">{`${v.label}: tokens aligned by numeric value`}</caption>
            <thead>
              <tr className="border-b bg-surface-1 text-[11px] text-muted-foreground">
                <th scope="col" className="sticky left-0 z-10 w-40 bg-surface-1 font-medium">
                  Value
                </th>
                {systems.map((s) => (
                  <th key={s.slug} scope="col" className="font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {v.rows.map((r) => {
                const all = r.sharedBy === systems.length && systems.length > 1;
                return (
                  <tr key={`${r.unit}-${r.value}`} className={cn("border-b border-border/60 align-top last:border-0", all && "bg-accent/40")}>
                    <th scope="row" className="sticky left-0 z-10 bg-card text-left font-normal">
                      <span className="tabular block font-mono text-[13px] font-medium">{formatScaleValue(r.value, r.unit)}</span>
                      {r.unit === "px" && maxPx > 0 && (
                        <span
                          aria-hidden
                          title={Math.abs(r.value) > maxPx ? "Off scale" : undefined}
                          className={cn("mt-1 block h-1.5 rounded-sm", r.value < 0 || Math.abs(r.value) > maxPx ? "hatch border border-primary/50" : "bg-primary/60")}
                          style={{ width: `${Math.max(2, (Math.min(Math.abs(r.value), maxPx) / maxPx) * 120)}px` }}
                        />
                      )}
                      {systems.length > 1 && <span className="mt-1 block text-[10.5px] text-muted-foreground">{all ? "in all systems" : `in ${r.sharedBy} of ${systems.length}`}</span>}
                    </th>
                    {r.cells.map((cell, i) => (
                      <td key={systems[i]!.slug}>
                        {cell.length === 0 ? (
                          <span className="text-muted-foreground" aria-label="No token with this value">
                            —
                          </span>
                        ) : (
                          <ul className="space-y-0.5">
                            {cell.slice(0, 4).map((step) => (
                              <li key={step.name} className="min-w-0">
                                <Link
                                  href={`/tokens?system=${encodeURIComponent(systems[i]!.slug)}&q=${encodeURIComponent(step.name)}`}
                                  className="font-mono break-all hover:underline"
                                >
                                  {step.name}
                                </Link>
                                {(step.converted || step.unitAssumed) && (
                                  <span className="ml-1.5 font-mono text-[10.5px] text-muted-foreground">{step.unitAssumed ? "unitless" : step.display}</span>
                                )}
                              </li>
                            ))}
                            {cell.length > 4 && <li className="text-[11px] text-muted-foreground">+{cell.length - 4} more with this value</li>}
                          </ul>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
