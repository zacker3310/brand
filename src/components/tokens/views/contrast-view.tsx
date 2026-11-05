import Form from "next/form";
import Link from "next/link";
import { CheckIcon, XIcon } from "lucide-react";
import { EmptyState, VerificationBadge } from "@/components/atlas";
import type { ContrastPair } from "@/lib/tokens/compare";
import { cn, formatCount } from "@/lib/utils";
import { nav, type ExplorerModel } from "../explorer-chrome";
import type { ManualResult, Operand } from "../lib/contrast";
import { colorLabel, swatchColor, themeShortLabel } from "../lib/values";
import { Swatch } from "../swatch";

const RULES: Record<string, string> = {
  "on-x": "Paired by name: “on-X” text over “X”.",
  "x-foreground": "Paired by name: “X-foreground” over “X”.",
  "role-swap": "Paired by name: a foreground role segment swapped for a background role (e.g. fg → bg).",
  declared: "Pair supplied explicitly.",
};

function Pass({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded border px-1 py-px text-[10.5px] leading-none font-medium whitespace-nowrap",
        ok ? "border-verified/30 bg-verified-soft text-verified" : "border-conflicting/30 bg-conflicting-soft text-conflicting",
      )}
    >
      {ok ? <CheckIcon className="size-2.5" aria-hidden /> : <XIcon className="size-2.5" aria-hidden />}
      {label}
      <span className="sr-only">{ok ? " pass" : " fail"}</span>
    </span>
  );
}

function Sample({ fg, bg, className }: { fg: unknown; bg: unknown; className?: string }) {
  const f = swatchColor(fg);
  const b = swatchColor(bg);
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-md ring-1 ring-black/10 ring-inset dark:ring-white/10", className)} aria-hidden>
      <span className="checker absolute inset-0" />
      <span className="absolute inset-0" style={{ background: b ?? undefined }} />
      <span className="relative font-semibold" style={{ color: f ?? undefined }}>
        Aa
      </span>
    </span>
  );
}

export function ContrastView({
  m,
  setLabel,
  pairs,
  totalPairs,
  failing,
  page,
  pageSize,
  manual,
  fg,
  bg,
  candidateCount,
}: {
  m: ExplorerModel;
  setLabel: (slug: string | null) => string;
  pairs: ContrastPair[];
  totalPairs: number;
  failing: number;
  page: number;
  pageSize: number;
  manual: ManualResult[] | null;
  fg: Operand | null;
  bg: Operand | null;
  candidateCount: number;
}) {
  return (
    <div className="space-y-8">
      <section aria-labelledby="manual-title" className="space-y-4 rounded-xl border bg-card p-4">
        <div className="space-y-1">
          <h2 id="manual-title" className="text-sm font-medium">
            Check a pair
          </h2>
          <p className="text-xs text-muted-foreground">Enter a token name from the current scope or any CSS color. Token pairs are measured within each theme they share.</p>
        </div>
        <Form action="/tokens" className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <input type="hidden" name="system" value={m.system.slug} />
          {m.selectedSet && <input type="hidden" name="set" value={m.selectedSet.slug} />}
          {m.params.theme && !m.selectedSet && <input type="hidden" name="theme" value={m.params.theme} />}
          <input type="hidden" name="category" value="color" />
          <input type="hidden" name="view" value="contrast" />
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="type-eyebrow">Foreground</span>
            <input
              name="fg"
              defaultValue={m.params.fg ?? ""}
              placeholder="fgColor.default or #1f2328"
              spellCheck={false}
              autoComplete="off"
              className="h-9 rounded-md border border-input bg-background px-3 font-mono text-[13px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 dark:bg-input/30"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="type-eyebrow">Background</span>
            <input
              name="bg"
              defaultValue={m.params.bg ?? ""}
              placeholder="bgColor.default or #ffffff"
              spellCheck={false}
              autoComplete="off"
              className="h-9 rounded-md border border-input bg-background px-3 font-mono text-[13px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 dark:bg-input/30"
            />
          </label>
          <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Check contrast
          </button>
        </Form>
        <div aria-live="polite">
          {(fg?.kind === "invalid" || bg?.kind === "invalid") && (
            <ul className="space-y-1 text-xs text-conflicting">
              {fg?.kind === "invalid" && <li>Foreground “{fg.input}”: {fg.reason}</li>}
              {bg?.kind === "invalid" && <li>Background “{bg.input}”: {bg.reason}</li>}
            </ul>
          )}
          {manual && manual.length === 0 && fg?.kind !== "invalid" && bg?.kind !== "invalid" && (
            <p className="text-xs text-muted-foreground">These two tokens have no theme in common, so they are never shown together.</p>
          )}
          {manual && manual.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {manual.map((r) => (
                <li key={r.theme ?? "any"} className="flex items-center gap-4 rounded-lg border p-3">
                  <Sample fg={r.fg} bg={r.bg} className="h-14 w-20 text-xl" />
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-xs text-muted-foreground">{r.theme ? setLabel(r.theme) : "Literal colors"}</p>
                    <p className="tabular text-xl font-semibold tracking-tight">
                      {r.result.ratio.toFixed(2)}
                      <span className="text-sm font-normal text-muted-foreground">:1</span>
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <Pass ok={r.result.aa.normal} label="AA" />
                      <Pass ok={r.result.aa.large} label="AA large" />
                      <Pass ok={r.result.aaa.normal} label="AAA" />
                      <Pass ok={r.result.aaa.large} label="AAA large" />
                      <Pass ok={r.result.nonText} label="UI 3:1" />
                    </div>
                    {(r.result.fgComposited || r.result.bgComposited) && (
                      <p className="text-[11px] text-inferred">
                        Translucent color composited{r.result.backdrop ? ` over ${r.result.backdrop}` : ""}; the real ratio depends on what is behind it.
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="pairs-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 id="pairs-title" className="text-sm font-medium">
              Foreground / background pairs found by name
            </h2>
            <p className="max-w-2xl text-xs text-muted-foreground">
              {formatCount(totalPairs)} pairs among {formatCount(candidateCount)} color values in scope · {formatCount(failing)} below AA for normal text. Pairing is an ATLAS
              heuristic on token names, not a pairing the source declares. Worst ratios first.
            </p>
          </div>
          <Link
            href={nav(m, { failing: m.params.failing ? undefined : true, view: "contrast" })}
            aria-current={m.params.failing ? "true" : undefined}
            className={cn("rounded-md border px-2.5 py-1 text-xs hover:bg-accent", m.params.failing && "border-primary/40 bg-accent text-accent-foreground")}
          >
            {m.params.failing ? "Showing failing AA only" : "Show failing AA only"}
          </Link>
        </div>
        {pairs.length === 0 ? (
          <EmptyState
            title={totalPairs === 0 ? "No pairs found by name in this scope" : "No pairs on this page"}
            description="ATLAS only pairs tokens whose names follow a recognizable foreground/background convention (on-X, X-foreground, fg/bg role swaps). Use the checker above for any pair."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[760px] border-collapse text-left text-[12.5px]">
              <caption className="sr-only">Contrast ratios of name-paired tokens</caption>
              <thead>
                <tr className="border-b bg-surface-1 text-[11px] text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">
                    <span className="sr-only">Sample</span>
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Foreground
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Background
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Theme
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Ratio
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    WCAG 2.2
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Pairing
                  </th>
                </tr>
              </thead>
              <tbody>
                {pairs.slice((page - 1) * pageSize, page * pageSize).map((p) => (
                  <tr key={`${p.theme}-${p.fg}-${p.bg}`} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-1.5">
                      <Sample fg={p.fgValue} bg={p.bgValue} className="h-8 w-12 text-sm" />
                    </td>
                    <td className="max-w-[16rem] px-3 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <Swatch value={p.fgValue} className="size-3.5" />
                        <span className="truncate font-mono" title={p.fg}>
                          {p.fg}
                        </span>
                      </span>
                      <span className="font-mono text-[10.5px] text-muted-foreground">{colorLabel(p.fgValue)}</span>
                    </td>
                    <td className="max-w-[16rem] px-3 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <Swatch value={p.bgValue} className="size-3.5" />
                        <span className="truncate font-mono" title={p.bg}>
                          {p.bg}
                        </span>
                      </span>
                      <span className="font-mono text-[10.5px] text-muted-foreground">{colorLabel(p.bgValue)}</span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{setLabel(p.theme)}</td>
                    <td className="tabular px-3 py-1.5 text-right font-mono font-medium">
                      {p.ratio.toFixed(2)}
                      {p.approximate && (
                        <span className="ml-0.5 text-inferred" title="Translucent color composited; approximate">
                          ≈
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="flex flex-wrap gap-1">
                        <Pass ok={p.aa.normal} label="AA" />
                        <Pass ok={p.aa.large} label="AA lg" />
                        <Pass ok={p.aaa.normal} label="AAA" />
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <VerificationBadge state={p.pairing === "declared" ? "verified" : "inferred"} compact detail={RULES[p.rule] ?? p.rule} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export function themeLabelFor(setThemes: Map<string, { name: string; theme: string | null }>) {
  return (slug: string | null) => {
    if (!slug) return "—";
    const s = setThemes.get(slug);
    return s ? `${themeShortLabel(s.theme, s.name)} · ${slug}` : slug;
  };
}
