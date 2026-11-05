import Form from "next/form";
import { EmptyState } from "@/components/atlas";
import { formatCount } from "@/lib/utils";
import type { ThemeCompareRow, TokenSetInfo } from "@/server/queries/tokens";
import { NativeSelect, NoJsSubmit } from "../controls";
import type { ExplorerModel } from "../explorer-chrome";
import { colorLabel, swatchColor } from "../lib/values";
import { Swatch } from "../swatch";
import { TokenAnchor } from "./shared";

/** Side-by-side comparison of two themed sets (paired names + theme-dependent tokens). */
export function ThemeCompareView({
  m,
  a,
  b,
  rows,
  total,
  differing,
  hrefFor,
}: {
  m: ExplorerModel;
  a: TokenSetInfo;
  b: TokenSetInfo;
  rows: ThemeCompareRow[];
  total: number;
  differing: number;
  hrefFor: (id: string) => string;
}) {
  const opts = m.themedSets.map((s) => ({ value: s.slug, label: `${s.name} (${s.theme})` }));
  return (
    <div className="space-y-5">
      <Form action="/tokens" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <input type="hidden" name="system" value={m.system.slug} />
        <input type="hidden" name="category" value="color" />
        <input type="hidden" name="view" value="themes" />
        {m.params.q && <input type="hidden" name="q" value={m.params.q} />}
        <NativeSelect name="a" label="Theme A" defaultValue={a.slug} options={opts} className="min-w-0 flex-1 basis-56" id="theme-a" />
        <NativeSelect name="b" label="Theme B" defaultValue={b.slug} options={opts} className="min-w-0 flex-1 basis-56" id="theme-b" />
        <NoJsSubmit label="Compare" />
        <p className="tabular w-full text-xs text-muted-foreground">
          {formatCount(total)} color tokens with a value in both · {formatCount(differing)} differ between the two themes. Paired by identical token name; theme-dependent tokens use their per-set value.
        </p>
      </Form>
      {rows.length === 0 ? (
        <EmptyState title="Nothing to compare" description="These two sets share no color token names, and no theme-dependent token resolves in both." />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
            <caption className="sr-only">{`Color tokens in ${a.name} and ${b.name}`}</caption>
            <thead>
              <tr className="border-b bg-surface-1 text-[11px] text-muted-foreground">
                <th scope="col" className="sticky left-0 z-10 bg-surface-1 px-3 py-2 font-medium">
                  Token
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {a.theme} · <span className="font-normal">{a.slug}</span>
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {b.theme} · <span className="font-normal">{b.slug}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.aId}-${r.name}`} className="border-b border-border/60 last:border-0">
                  <th scope="row" className="sticky left-0 z-10 max-w-[22rem] bg-card px-3 py-1.5 text-left font-normal">
                    <span className="block truncate font-mono" title={r.name}>
                      {r.name}
                    </span>
                    <span className="text-[10.5px] text-muted-foreground">
                      {r.kind === "theme-dependent" ? `theme-dependent · ${r.setSlug}` : "same name in both sets"}
                      {!r.differs && " · identical"}
                    </span>
                  </th>
                  <Cell id={r.aId} value={r.aValue} text={r.aText} hrefFor={hrefFor} />
                  <Cell id={r.bId} value={r.bValue} text={r.bText} hrefFor={hrefFor} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Cell({ id, value, text, hrefFor }: { id: string; value: unknown; text: string | null; hrefFor: (id: string) => string }) {
  const color = swatchColor(value);
  return (
    <td className="px-3 py-1.5">
      <TokenAnchor id={id} href={hrefFor(id)} className="flex items-center gap-2 rounded hover:underline">
        <Swatch value={value} className="h-6 w-10" />
        <span className="font-mono text-[11.5px] text-muted-foreground">{color ? colorLabel(value, text) : (text ?? "no static value")}</span>
      </TokenAnchor>
    </td>
  );
}
