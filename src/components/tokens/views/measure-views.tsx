import { categorizeToken } from "@/lib/tokens/categorize";
import { formatTokenValue } from "@/lib/tokens/format";
import { cn } from "@/lib/utils";
import type { ExplorerToken, TokenIndexRow } from "@/server/queries/tokens";
import type { GroupSlice } from "../lib/grouping";
import { authoredLabel, dimensionOf, motionOf, opacityOf, previewValue, safeCss, shadowCss } from "../lib/values";
import { AliasStateBadge } from "../alias-state";
import { EasingCurve, MotionAllToggle, MotionPreview } from "../motion-preview";
import { chainLabel, GroupHeader, GroupList, GroupSection, relName, TokenAnchor, type ViewProps } from "./shared";

const BAR_MAX = 480;
const REFERENCE_MS = 1000;

function tokensOf(g: GroupSlice<TokenIndexRow>, p: ViewProps) {
  return g.list.map((r) => p.tokens.get(r.id)).filter((t): t is ExplorerToken => !!t);
}

function displayOf(t: ExplorerToken): string {
  const v = previewValue(t);
  return (v !== null && v !== undefined ? formatTokenValue(v, t.type) : null) ?? t.valueText ?? authoredLabel(t.rawValue, t.type) ?? "";
}

function NameCell({ t, p, label, sub }: { t: ExplorerToken; p: ViewProps; label: string; sub?: React.ReactNode }) {
  const chain = chainLabel(t, p.edges);
  return (
    <span className="min-w-0">
      <span className="block truncate font-mono text-[12.5px]" title={t.name}>
        {relName(t.name, label)}
        {t.deprecated && <span className="ml-1.5 font-sans text-[10px] text-conflicting uppercase">deprecated</span>}
      </span>
      <span className="block truncate font-mono text-[11px] text-muted-foreground">
        {chain ? `→ ${chain}` : null}
        {sub}
      </span>
    </span>
  );
}

function Flag({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "inferred" }) {
  return (
    <span className={cn("rounded border px-1 py-px font-sans text-[10px] leading-none whitespace-nowrap", tone === "inferred" ? "border-inferred/30 bg-inferred-soft text-[color:color-mix(in_oklch,var(--inferred)_70%,var(--foreground))]" : "text-muted-foreground")}>
      {children}
    </span>
  );
}

function StateBadge({ t }: { t: ExplorerToken }) {
  if (!t.aliasState || t.aliasState === "resolved" || t.aliasState === "literal") return null;
  return <AliasStateBadge state={t.aliasState} compact tooltip={false} />;
}

function Groups({ p, render, header }: { p: ViewProps; render: (g: GroupSlice<TokenIndexRow>) => React.ReactNode; header?: React.ReactNode }) {
  return (
    <GroupList
      p={p}
      header={header}
      render={(g) => (
        <GroupSection g={g}>
          <GroupHeader g={g} multiSet={p.multiSet} />
          {render(g)}
        </GroupSection>
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Spacing: proportional bars at true size                                     */
/* -------------------------------------------------------------------------- */

function DimensionRow({ t, p, label }: { t: ExplorerToken; p: ViewProps; label: string }) {
  const d = dimensionOf(previewValue(t));
  const px = d?.px ?? null;
  const w = px === null ? null : Math.min(Math.abs(px), BAR_MAX);
  return (
    <li className="min-w-0">
      <TokenAnchor id={t.id} href={p.hrefFor(t.id)} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 rounded-md px-2 py-2 transition-colors hover:bg-accent/60 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto]">
        <NameCell t={t} p={p} label={label} />
        <span className="col-span-2 row-start-2 flex min-w-0 items-center md:col-span-1 md:row-start-auto" aria-hidden>
          {w === null ? (
            <span className="hatch h-3 w-24 rounded-sm border border-dashed" />
          ) : w === 0 ? (
            <span className="h-3 w-px bg-foreground/50" />
          ) : (
            <span className={cn("h-3 max-w-full rounded-sm", px! < 0 ? "hatch border border-primary/60" : "bg-primary/70")} style={{ width: `${w}px` }} />
          )}
          {px !== null && Math.abs(px) > BAR_MAX && <span className="ml-1 text-[10px] text-muted-foreground">…</span>}
        </span>
        <span className="flex items-center justify-end gap-1.5 font-mono text-[12px] whitespace-nowrap">
          {d?.converted && <Flag>{d.display}</Flag>}
          {d?.unitless && <Flag tone="inferred">unitless</Flag>}
          {px !== null && px < 0 && <Flag>negative</Flag>}
          <StateBadge t={t} />
          <span className="tabular">{px !== null ? `${Math.round(px * 100) / 100}px` : (d?.display ?? (displayOf(t) || "—"))}</span>
        </span>
      </TokenAnchor>
    </li>
  );
}

export function SpacingView(p: ViewProps) {
  return (
    <Groups
      p={p}
      header={<p className="text-xs text-muted-foreground">Bars are drawn at true size (1:1 CSS px, capped at {BAR_MAX}px). rem values are converted at a 16px root; unitless numbers are flagged, not assumed.</p>}
      render={(g) => (
        <ul className="divide-y divide-border/60">
          {tokensOf(g, p).map((t) => (
            <DimensionRow key={t.id} t={t} p={p} label={g.label} />
          ))}
        </ul>
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Shape: radius boxes, border widths                                          */
/* -------------------------------------------------------------------------- */

export function ShapeView(p: ViewProps) {
  return (
    <Groups
      p={p}
      render={(g) => {
        const ts = tokensOf(g, p);
        return (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
            {ts.map((t) => {
              const v = previewValue(t);
              const sub = categorizeToken(t.name, t.type, v).subcategory;
              const display = displayOf(t);
              const isWidth = sub === "borderWidth";
              const d = dimensionOf(v);
              const radius = !isWidth && typeof display === "string" ? safeCss(display) : null;
              const border = sub === "border" ? safeCss(formatTokenValue(v, "border")) : null;
              return (
                <li key={t.id} className="min-w-0">
                  <TokenAnchor id={t.id} href={p.hrefFor(t.id)} className="flex h-full min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50">
                    <span className="grid h-16 place-items-center" aria-hidden>
                      {isWidth ? (
                        d?.px !== null && d?.px !== undefined ? (
                          <span className="w-20 bg-foreground/80" style={{ height: `${Math.max(0.5, Math.min(d.px, 24))}px` }} />
                        ) : (
                          <span className="hatch h-6 w-20 rounded-sm" />
                        )
                      ) : border ? (
                        <span className="size-14 rounded-md" style={{ border }} />
                      ) : radius && (d === null || d.px !== null || /\s/.test(radius) || /%$/.test(radius)) ? (
                        <span className="size-14 border-2 border-primary/70 bg-primary/10" style={{ borderRadius: radius }} />
                      ) : (
                        <span className="hatch size-14 rounded-sm border border-dashed" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[12px]" title={t.name}>
                        {relName(t.name, g.label)}
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[11px] text-muted-foreground" title={display}>
                          {display || "—"}
                        </span>
                        <StateBadge t={t} />
                      </span>
                    </span>
                  </TokenAnchor>
                </li>
              );
            })}
          </ul>
        );
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Elevation: shadow cards, z-index ladder, numeric levels                     */
/* -------------------------------------------------------------------------- */

export function ElevationView(p: ViewProps) {
  return (
    <Groups
      p={p}
      render={(g) => {
        const ts = tokensOf(g, p);
        const shadows: { t: ExplorerToken; css: string }[] = [];
        const others: ExplorerToken[] = [];
        for (const t of ts) {
          const css = shadowCss(previewValue(t));
          if (css && categorizeToken(t.name, t.type, previewValue(t)).subcategory !== "zIndex") shadows.push({ t, css });
          else others.push(t);
        }
        const set = (g.setId ? p.setById.get(g.setId) : undefined) ?? p.singleSet;
        const darkStage = !!set?.theme?.startsWith("dark");
        return (
          <div className="space-y-4">
            {shadows.length > 0 && (
              <div className={cn("rounded-xl border p-5", set?.theme ? (darkStage ? "bg-[#16181d]" : "bg-[#f6f7f9]") : "bg-surface-1")}>
                {set?.theme && <p className={cn("mb-4 text-[11px]", darkStage ? "text-white/60" : "text-black/55")}>Previewed on a {darkStage ? "dark" : "light"} stage to match the {set.theme} set.</p>}
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-6">
                  {shadows.map(({ t, css }) => (
                    <li key={t.id} className="min-w-0">
                      <TokenAnchor id={t.id} href={p.hrefFor(t.id)} className="block min-w-0 rounded-lg">
                        <span className={cn("block h-20 rounded-lg", set?.theme ? (darkStage ? "bg-[#22252b]" : "bg-white") : "bg-card")} style={{ boxShadow: css }} aria-hidden />
                        <span className={cn("mt-3 block truncate font-mono text-[12px]", set?.theme && (darkStage ? "text-white/90" : "text-black/85"))} title={t.name}>
                          {relName(t.name, g.label)}
                        </span>
                        <span className={cn("block truncate font-mono text-[10.5px]", set?.theme ? (darkStage ? "text-white/55" : "text-black/55") : "text-muted-foreground")} title={css}>
                          {css}
                        </span>
                      </TokenAnchor>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {others.length > 0 && (
              <ul className="divide-y divide-border/60 rounded-lg border">
                {[...others]
                  .sort((a, b) => (Number(previewValue(b)) || 0) - (Number(previewValue(a)) || 0))
                  .map((t) => {
                    const v = previewValue(t);
                    const sub = categorizeToken(t.name, t.type, v).subcategory;
                    const d = dimensionOf(v);
                    return (
                      <li key={t.id}>
                        <TokenAnchor id={t.id} href={p.hrefFor(t.id)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-md px-3 py-2 hover:bg-accent/60">
                          <NameCell t={t} p={p} label={g.label} />
                          <span className="flex items-center gap-2 font-mono text-[12px]">
                            {sub === "zIndex" ? <Flag>z-index</Flag> : d?.px !== null && d?.px !== undefined ? <Flag>level (not a shadow)</Flag> : null}
                            <StateBadge t={t} />
                            <span className="tabular">{displayOf(t) || "—"}</span>
                          </span>
                        </TokenAnchor>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        );
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Motion                                                                      */
/* -------------------------------------------------------------------------- */

export function MotionView(p: ViewProps) {
  return (
    <Groups
      p={p}
      header={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-xs text-muted-foreground">
            Durations animate linearly at their real length. Easing curves animate over a {REFERENCE_MS}ms reference. Transitions use both of their values.
          </p>
          <MotionAllToggle />
        </div>
      }
      render={(g) => (
        <ul className="divide-y divide-border/60">
          {tokensOf(g, p).map((t) => {
            const m = motionOf(previewValue(t), t.type);
            const duration = m?.durationMs ?? (m?.easing ? REFERENCE_MS : null);
            const easing = m?.easing?.css ?? "linear";
            const kind = m?.durationMs !== null && m?.durationMs !== undefined && m.easing ? "transition" : m?.easing ? "easing" : m?.durationMs !== null && m?.durationMs !== undefined ? "duration" : null;
            return (
              <li key={t.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-2 py-2.5 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto]">
                <TokenAnchor id={t.id} href={p.hrefFor(t.id)} className="flex min-w-0 items-center gap-3 rounded-md hover:underline">
                  {m?.easing?.points ? <EasingCurve points={m.easing.points} /> : null}
                  <NameCell t={t} p={p} label={g.label} />
                </TokenAnchor>
                <span className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:row-start-auto">
                  {duration === 0 ? (
                    <span className="text-[11px] text-muted-foreground">0ms: changes apply instantly, nothing to animate.</span>
                  ) : duration !== null && kind ? (
                    <MotionPreview durationMs={duration} easing={easing} label={t.name} />
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Not a duration or easing; not animated.</span>
                  )}
                </span>
                <span className="flex items-center justify-end gap-1.5 font-mono text-[12px]">
                  {kind && <Flag>{kind}</Flag>}
                  <StateBadge t={t} />
                  <span className="max-w-[14rem] truncate" title={displayOf(t)}>
                    {displayOf(t) || "—"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Layout: breakpoints ruler                                                   */
/* -------------------------------------------------------------------------- */

export function LayoutView(p: ViewProps) {
  return (
    <Groups
      p={p}
      render={(g) => {
        const ts = tokensOf(g, p);
        const marks = ts
          .map((t) => ({ t, d: dimensionOf(previewValue(t)) }))
          .filter((x): x is { t: ExplorerToken; d: NonNullable<ReturnType<typeof dimensionOf>> & { px: number } } => x.d?.px !== null && x.d?.px !== undefined && x.d.px >= 0);
        const max = Math.max(...marks.map((x) => x.d.px), 0);
        const scaleMax = max > 0 ? Math.ceil((max * 1.08) / 100) * 100 : 0;
        return (
          <div className="space-y-4">
            {marks.length >= 2 && scaleMax > 0 && (
              <figure className="rounded-xl border bg-surface-1 px-4 pt-4 pb-3">
                <figcaption className="mb-3 text-[11px] text-muted-foreground">Ruler from 0 to {scaleMax}px (rem converted at 16px).</figcaption>
                <div className="relative h-24" role="img" aria-label={`Ruler: ${marks.map((x) => `${relName(x.t.name, g.label)} at ${Math.round(x.d.px)}px`).join(", ")}`}>
                  <div className="absolute inset-x-0 bottom-5 h-px bg-border" />
                  {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                    <span key={f} className="absolute bottom-0 -translate-x-1/2 font-mono text-[10px] text-muted-foreground" style={{ left: `${f * 100}%` }}>
                      {Math.round(scaleMax * f)}
                    </span>
                  ))}
                  {marks.map((x, i) => (
                    <span key={x.t.id} className="absolute bottom-5 flex -translate-x-1/2 flex-col items-center" style={{ left: `${(x.d.px / scaleMax) * 100}%` }} aria-hidden>
                      <span className="mb-1 max-w-24 truncate font-mono text-[10px] text-muted-foreground" style={{ marginBottom: `${4 + (i % 3) * 16}px` }}>
                        {relName(x.t.name, g.label)}
                      </span>
                      <span className="w-px bg-primary/70" style={{ height: `${8 + (i % 3) * 16}px` }} />
                    </span>
                  ))}
                </div>
              </figure>
            )}
            <ul className="divide-y divide-border/60">
              {ts.map((t) => (
                <DimensionRow key={t.id} t={t} p={p} label={g.label} />
              ))}
            </ul>
          </div>
        );
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Opacity                                                                     */
/* -------------------------------------------------------------------------- */

export function OpacityView(p: ViewProps) {
  return (
    <Groups
      p={p}
      render={(g) => (
        <ul className="grid gap-x-6 sm:grid-cols-2">
          {tokensOf(g, p).map((t) => {
            const o = opacityOf(previewValue(t));
            return (
              <li key={t.id} className="min-w-0 border-b border-border/60">
                <TokenAnchor id={t.id} href={p.hrefFor(t.id)} className="flex min-w-0 items-center gap-3 rounded-md px-1.5 py-2 hover:bg-accent/60">
                  <span className="checker relative size-8 shrink-0 overflow-hidden rounded-[5px] ring-1 ring-black/10 ring-inset" aria-hidden>
                    {o !== null ? <span className="absolute inset-0 bg-primary" style={{ opacity: o }} /> : <span className="hatch absolute inset-0 bg-surface-1" />}
                  </span>
                  <NameCell t={t} p={p} label={g.label} />
                  <span className="ml-auto flex items-center gap-1.5 font-mono text-[12px]">
                    <StateBadge t={t} />
                    <span className="tabular">{o !== null ? `${Math.round(o * 1000) / 10}%` : displayOf(t) || "—"}</span>
                  </span>
                </TokenAnchor>
              </li>
            );
          })}
        </ul>
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Other                                                                       */
/* -------------------------------------------------------------------------- */

export function OtherView(p: ViewProps) {
  return (
    <Groups
      p={p}
      render={(g) => (
        <ul className="divide-y divide-border/60 rounded-lg border">
          {tokensOf(g, p).map((t) => (
            <li key={t.id}>
              <TokenAnchor id={t.id} href={p.hrefFor(t.id)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-md px-3 py-2 hover:bg-accent/60">
                <NameCell t={t} p={p} label={g.label} sub={t.type ? <span className="ml-1 text-muted-foreground">({t.type})</span> : null} />
                <span className="flex items-center gap-1.5 font-mono text-[12px]">
                  <StateBadge t={t} />
                  <span className="max-w-[18rem] truncate" title={displayOf(t)}>
                    {displayOf(t) || "—"}
                  </span>
                </span>
              </TokenAnchor>
            </li>
          ))}
        </ul>
      )}
    />
  );
}
