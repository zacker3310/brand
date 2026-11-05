import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { toCssColor } from "@/lib/tokens/color";
import { cn, formatCount } from "@/lib/utils";
import type { TokenUsageRow } from "@/server/queries/components";
import { tokenValueEntries } from "../lib/tokens";
import { tokensHref } from "../lib/urls";

const VISIBLE_PER_CATEGORY = 10;
const MAX_ENTRIES = 6;

const ALIAS_NOTE: Record<string, string> = {
  unresolved: "Alias target not found in the indexed sets",
  cycle: "Alias chain loops back on itself",
  external: "Refers to a token outside this system's indexed sets",
};

function Swatch({ value }: { value: unknown }) {
  const css = toCssColor(value);
  if (!css) return null;
  return (
    <span aria-hidden className="checker relative inline-block size-3.5 shrink-0 overflow-hidden rounded-[4px] ring-1 ring-foreground/15">
      <span className="absolute inset-0" style={{ background: css }} />
    </span>
  );
}

function ValueCell({ row }: { row: TokenUsageRow }) {
  const entries = tokenValueEntries(row.values);
  const shown = entries.slice(0, MAX_ENTRIES);
  return (
    <ul className="space-y-0.5">
      {shown.map((e, i) => (
        <li key={`${e.label ?? ""}-${i}`} className="flex min-w-0 items-center gap-1.5">
          {e.label && <span className="w-24 shrink-0 truncate font-mono text-[10px] text-subtle-foreground" title={e.label}>{e.label}</span>}
          {row.category === "color" && <Swatch value={e.value} />}
          {e.text ? (
            <code className="min-w-0 truncate font-mono text-[11.5px] text-foreground/85" title={e.text}>
              {e.text}
            </code>
          ) : (
            <span className="text-[11px] text-muted-foreground italic" title={e.aliasState ? ALIAS_NOTE[e.aliasState] : undefined}>
              {e.aliasState && ALIAS_NOTE[e.aliasState] ? e.aliasState : "value not resolved"}
            </span>
          )}
        </li>
      ))}
      {entries.length > shown.length && <li className="text-[11px] text-muted-foreground">+{entries.length - shown.length} more themes</li>}
    </ul>
  );
}

function Rows({ rows, systemSlug }: { rows: TokenUsageRow[]; systemSlug: string }) {
  return (
    <>
      {rows.map((t) => (
        <tr key={t.name} className="align-top">
          <th scope="row" className="max-w-0 border-b border-border/60 px-3 py-2 text-left font-normal sm:w-[40%]">
            <Link href={tokensHref(systemSlug, t.name)} className="group inline-flex max-w-full items-center gap-1 font-mono text-[12px] hover:underline hover:underline-offset-4">
              <span className="truncate" title={t.name}>
                {t.name}
              </span>
              <ArrowUpRightIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </Link>
            {t.properties.length > 0 && (
              <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground" title={t.properties.join(", ")}>
                {t.properties.join(", ")}
              </p>
            )}
          </th>
          <td className="max-w-0 border-b border-border/60 px-3 py-2">
            <ValueCell row={t} />
          </td>
        </tr>
      ))}
    </>
  );
}

/** Tokens the component references, grouped by category. Values are as resolved by ATLAS, per theme. */
export function TokenUsage({ tokens, systemSlug }: { tokens: TokenUsageRow[]; systemSlug: string }) {
  const byCategory = new Map<string, TokenUsageRow[]>();
  for (const t of tokens) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);
  const cats = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
  return (
    <div className="space-y-6">
      {cats.map(([cat, rows]) => {
        const head = rows.slice(0, VISIBLE_PER_CATEGORY);
        const tail = rows.slice(VISIBLE_PER_CATEGORY);
        return (
          <div key={cat} className="space-y-2">
            <h3 className="flex items-baseline gap-2 text-[13px] font-medium capitalize">
              {cat}
              <span className="tabular font-mono text-[11px] font-normal text-muted-foreground">{formatCount(rows.length)}</span>
            </h3>
            <div className="overflow-hidden rounded-xl border bg-card">
              <table className={cn("w-full table-fixed border-separate border-spacing-0 text-[13px]")}>
                <caption className="sr-only">{cat} tokens used by this component</caption>
                <thead className="sr-only">
                  <tr>
                    <th scope="col">Token and CSS properties</th>
                    <th scope="col">Value per theme</th>
                  </tr>
                </thead>
                <tbody>
                  <Rows rows={head} systemSlug={systemSlug} />
                </tbody>
              </table>
              {tail.length > 0 && (
                <details className="group/more border-t border-border/60">
                  <summary className="flex min-h-9 cursor-pointer list-none items-center px-3 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <span className="group-open/more:hidden">Show {formatCount(tail.length)} more {cat} tokens</span>
                    <span className="hidden group-open/more:inline">Show fewer</span>
                  </summary>
                  <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
                    <caption className="sr-only">More {cat} tokens</caption>
                    <thead className="sr-only">
                      <tr>
                        <th scope="col">Token and CSS properties</th>
                        <th scope="col">Value per theme</th>
                      </tr>
                    </thead>
                    <tbody>
                      <Rows rows={tail} systemSlug={systemSlug} />
                    </tbody>
                  </table>
                </details>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
