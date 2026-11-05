import { SourceLink } from "@/components/atlas";
import type { ExplorerToken, TokenSetInfo } from "@/server/queries/tokens";
import { authoredLabel, colorLabel, previewValue, swatchColor, themeValues } from "../lib/values";
import { AliasStateBadge } from "../alias-state";
import { TierMark } from "../explorer-chrome";
import { SplitSwatch, Swatch } from "../swatch";
import { TokenAnchor } from "./shared";

/** Dense token table: horizontally scrollable inside its own container, sticky name column. */
export function TableView({ tokens, hrefFor, setById, sourceFor }: { tokens: ExplorerToken[]; hrefFor: (id: string) => string; setById: Map<string, TokenSetInfo>; sourceFor: (t: ExplorerToken) => string }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[1100px] border-collapse text-left text-[12.5px] [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2">
        <caption className="sr-only">Tokens in the current scope</caption>
        <thead>
          <tr className="border-b bg-surface-1 text-[11px] text-muted-foreground">
            <th scope="col" className="sticky left-0 z-10 bg-surface-1 font-medium">
              Name
            </th>
            <th scope="col" className="font-medium">
              CSS variable
            </th>
            <th scope="col" className="font-medium">
              Value (authored)
            </th>
            <th scope="col" className="font-medium">
              Resolved
            </th>
            <th scope="col" className="font-medium">
              Alias state
            </th>
            <th scope="col" className="font-medium">
              Tier
            </th>
            <th scope="col" className="font-medium">
              Deprecated
            </th>
            <th scope="col" className="font-medium">
              Set · location
            </th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => {
            const tv = themeValues(t.resolvedValue);
            const pv = previewValue(t);
            const color = t.category === "color";
            const set = setById.get(t.setId);
            return (
              <tr key={t.id} className="border-b border-border/60 align-top last:border-0 hover:bg-accent/30">
                <th scope="row" className="sticky left-0 z-10 max-w-[20rem] bg-card text-left font-normal">
                  <TokenAnchor id={t.id} href={hrefFor(t.id)} className="block rounded font-mono break-all hover:underline">
                    {t.name}
                  </TokenAnchor>
                </th>
                <td className="max-w-[14rem] font-mono break-all text-muted-foreground">{t.cssVar ?? <span className="text-subtle-foreground">—</span>}</td>
                <td className="max-w-[16rem] font-mono break-all">{authoredLabel(t.rawValue, t.type) || <span className="text-subtle-foreground">—</span>}</td>
                <td className="max-w-[16rem]">
                  {tv.length ? (
                    <span className="flex items-center gap-2">
                      {color && <SplitSwatch values={tv.map((v) => ({ key: v.setSlug, value: v.value }))} className="h-4 w-10" />}
                      <span className="text-muted-foreground">{tv.length} themes</span>
                    </span>
                  ) : t.valueText ? (
                    <span className="flex items-start gap-2">
                      {color && swatchColor(pv) && <Swatch value={pv} className="mt-0.5 size-4" />}
                      <span className="font-mono break-all">{color && swatchColor(pv) ? colorLabel(pv, t.valueText) : t.valueText}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No static value</span>
                  )}
                </td>
                <td>
                  <AliasStateBadge state={t.aliasState} compact tooltip={false} />
                </td>
                <td className="whitespace-nowrap">
                  <TierMark tier={t.tier} tierState={t.tierState} plain />
                </td>
                <td>{t.deprecated ? <span className="text-conflicting">Yes</span> : <span className="text-subtle-foreground">No</span>}</td>
                <td className="max-w-[18rem]">
                  <span className="block truncate text-muted-foreground" title={set?.name}>
                    {set?.slug ?? t.setSlug}
                  </span>
                  {t.location ? (
                    <SourceLink href={sourceFor(t)} className="max-w-full text-[11.5px]">
                      <span className="font-mono break-all">{t.location}</span>
                    </SourceLink>
                  ) : (
                    <span className="text-[11.5px] text-subtle-foreground">Location not recorded</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
