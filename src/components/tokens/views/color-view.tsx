import { cn } from "@/lib/utils";
import type { ExplorerToken, TokenIndexRow } from "@/server/queries/tokens";
import type { GroupSlice, Ramp } from "../lib/grouping";
import { colorLabel, previewValue, swatchColor, themeLabels, themeValues } from "../lib/values";
import { AliasStateBadge } from "../alias-state";
import { Swatch } from "../swatch";
import { chainLabel, GroupHeader, GroupList, GroupSection, relName, TokenAnchor, type ViewProps } from "./shared";

export function ColorView(p: ViewProps) {
  return (
    <GroupList
      p={p}
      render={(g) => (
        <GroupSection g={g}>
          <GroupHeader g={g} set={g.setId ? p.setById.get(g.setId) : undefined} multiSet={p.multiSet} />
          {g.ramps.length > 0 && (
            <div className="space-y-3">
              {g.ramps.map((r) => (
                <RampRow key={r.family} ramp={r} p={p} group={g} />
              ))}
            </div>
          )}
          {g.themed.length > 0 && <ThemedMatrix rows={g.themed} p={p} group={g} />}
          {g.list.length > 0 && (
            <ul className="grid gap-x-6 sm:grid-cols-2">
              {g.list.map((row) => {
                const t = p.tokens.get(row.id);
                return t ? <ColorItem key={row.id} t={t} p={p} label={g.label} /> : null;
              })}
            </ul>
          )}
        </GroupSection>
      )}
    />
  );
}

function RampRow({ ramp, p, group }: { ramp: Ramp<TokenIndexRow>; p: ViewProps; group: GroupSlice<TokenIndexRow> }) {
  return (
    <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:items-start">
      <p className="truncate pt-3 font-mono text-xs text-muted-foreground" title={`${group.label}.${ramp.label}`}>
        {ramp.label}
      </p>
      <div className="overflow-x-auto pb-1">
        <ol className="flex min-w-max gap-px sm:min-w-0" aria-label={`${group.label} ${ramp.label} ramp, ${ramp.steps.length} steps`}>
          {ramp.steps.map((s, i) => {
            const t = p.tokens.get(s.row.id);
            const v = t ? previewValue(t) : null;
            const label = colorLabel(v, t?.valueText);
            return (
              <li key={s.row.id} className="min-w-8 flex-1 sm:min-w-0">
                <TokenAnchor
                  id={s.row.id}
                  href={p.hrefFor(s.row.id)}
                  label={`${s.row.name}: ${label || "no static value"}`}
                  title={`${s.row.name}\n${label}`}
                  className="group block rounded-md"
                >
                  <Swatch
                    value={v}
                    className={cn("block h-11 w-full rounded-none transition-transform group-hover:scale-y-110", i === 0 && "rounded-l-md", i === ramp.steps.length - 1 && "rounded-r-md")}
                  />
                  <span className="mt-1 block truncate text-center font-mono text-[10px] text-muted-foreground group-hover:text-foreground">{s.stepLabel}</span>
                </TokenAnchor>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function ColorItem({ t, p, label }: { t: ExplorerToken; p: ViewProps; label: string }) {
  const v = previewValue(t);
  const value = swatchColor(v) ? colorLabel(v, t.valueText) : (t.valueText ?? (typeof t.rawValue === "string" ? t.rawValue : null));
  const chain = chainLabel(t, p.edges);
  const odd = t.aliasState === "external" || t.aliasState === "unresolved" || t.aliasState === "cycle";
  return (
    <li className="min-w-0 border-b border-border/60">
      <TokenAnchor id={t.id} href={p.hrefFor(t.id)} className="flex min-w-0 items-center gap-3 rounded-md px-1.5 py-2 transition-colors hover:bg-accent/60">
        <Swatch value={v} className="size-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[12.5px]" title={t.name}>
            {relName(t.name, label)}
            {t.deprecated && <span className="ml-1.5 font-sans text-[10px] text-conflicting uppercase">deprecated</span>}
          </span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {chain ? (
              <>
                <span aria-hidden>→ </span>
                {chain}
                {value ? <span className="text-subtle-foreground"> → {value}</span> : null}
              </>
            ) : (
              (value ?? <span className="font-sans">no static value</span>)
            )}
          </span>
        </span>
        {odd && <AliasStateBadge state={t.aliasState} compact tooltip={false} />}
      </TokenAnchor>
    </li>
  );
}

/** Theme-dependent tokens: one row per token, one column per themed set (split swatches with labels). */
function ThemedMatrix({ rows, p, group }: { rows: TokenIndexRow[]; p: ViewProps; group: GroupSlice<TokenIndexRow> }) {
  const tokens = rows.map((r) => p.tokens.get(r.id)).filter((t): t is ExplorerToken => !!t);
  const keys = new Set<string>();
  for (const t of tokens) for (const v of themeValues(t.resolvedValue)) keys.add(v.setSlug);
  const setBySlug = new Map([...p.setById.values()].map((s) => [s.slug, s]));
  let cols = [...keys].sort((a, b) => (p.setOrder.indexOf(a) === -1 ? 1e9 : p.setOrder.indexOf(a)) - (p.setOrder.indexOf(b) === -1 ? 1e9 : p.setOrder.indexOf(b)));
  if (p.theme) cols = cols.filter((c) => setBySlug.get(c)?.theme === p.theme);
  if (!cols.length) cols = [...keys];
  const labels = themeLabels(cols, (k) => setBySlug.get(k));
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Theme-dependent: each token resolves to a different value in every themed set.{p.theme ? ` Showing ${p.theme} sets only.` : ""}
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-max border-collapse text-left">
          <caption className="sr-only">{`${group.label}: values per themed set`}</caption>
          <thead>
            <tr className="border-b bg-surface-1">
              <th scope="col" className="sticky left-0 z-10 bg-surface-1 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                Token
              </th>
              {cols.map((c) => {
                const s = setBySlug.get(c);
                return (
                  <th key={c} scope="col" className="px-3 py-2 text-[11px] font-medium whitespace-nowrap text-muted-foreground" title={s?.name ?? c}>
                    {labels.get(c)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => {
              const vals = new Map(themeValues(t.resolvedValue).map((v) => [v.setSlug, v.value]));
              return (
                <tr key={t.id} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
                  <th scope="row" className="sticky left-0 z-10 max-w-[18rem] bg-card px-3 py-1.5 text-left font-normal">
                    <TokenAnchor id={t.id} href={p.hrefFor(t.id)} className="block truncate rounded font-mono text-[12px] hover:underline" title={t.name}>
                      {relName(t.name, group.label)}
                    </TokenAnchor>
                    {t.refs[0]?.targetName && <span className="block truncate font-mono text-[10.5px] text-muted-foreground">→ {t.refs[0].targetName}</span>}
                  </th>
                  {cols.map((c) => {
                    const v = vals.get(c);
                    return (
                      <td key={c} className="px-3 py-1.5">
                        {v === undefined ? (
                          <span className="text-xs text-subtle-foreground" title="No value for this themed set">
                            —
                          </span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <Swatch value={v} className="size-5" />
                            <span className="font-mono text-[11px] text-muted-foreground">{swatchColor(v) ? colorLabel(v) : String(v)}</span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
