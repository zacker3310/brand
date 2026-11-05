"use client";

import { ArrowLeftIcon, ArrowRightIcon, CopyIcon, CornerDownRightIcon, Loader2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SourceLink, VerificationBadge } from "@/components/atlas";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { ChainEdge, InspectorData } from "@/server/queries/tokens";
import { cn, formatCount } from "@/lib/utils";
import { AliasStateBadge, ALIAS_STATE_META } from "../alias-state";
import { Swatch } from "../swatch";
import { authoredLabel, colorLabel, previewValue, swatchColor, themeShortLabel, themeValues } from "../lib/values";
import { useInspector } from "./context";

function useIsXl() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(min-width: 1280px)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 1280px)").matches,
    () => true,
  );
}

function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

type State = { status: "idle" } | { status: "loading"; id: string } | { status: "ready"; data: InspectorData } | { status: "error"; id: string; message: string };

/**
 * Inspector for the selected token: value, alias chain (upstream), per-theme values, dependents
 * (downstream) and component usages. Sticky side panel at >= 1280px, a sheet below that.
 */
export function TokenInspector({ initial, contrastHref }: { initial: InspectorData | null; contrastHref: string }) {
  const { selectedId, clear } = useInspector();
  const isXl = useIsXl();
  const hydrated = useHydrated();
  const [state, setState] = useState<State>(initial ? { status: "ready", data: initial } : { status: "idle" });
  const cache = useRef(new Map<string, InspectorData>(initial ? [[initial.token.id, initial]] : []));

  useEffect(() => {
    if (!selectedId) {
      setState({ status: "idle" });
      return;
    }
    const hit = cache.current.get(selectedId);
    if (hit) {
      setState({ status: "ready", data: hit });
      return;
    }
    const ac = new AbortController();
    setState({ status: "loading", id: selectedId });
    fetch(`/tokens/inspect/${selectedId}`, { signal: ac.signal, headers: { accept: "application/json" } })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "This token is not in the index (it may have been retired)." : `Request failed (${r.status}).`);
        return (await r.json()) as InspectorData;
      })
      .then((d) => {
        cache.current.set(d.token.id, d);
        setState({ status: "ready", data: d });
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        setState({ status: "error", id: selectedId, message: e instanceof Error ? e.message : "Could not load token." });
      });
    return () => ac.abort();
  }, [selectedId]);

  const body = <InspectorBody state={state} onClose={clear} contrastHref={contrastHref} />;
  const open = !!selectedId;

  if (hydrated && !isXl) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && clear()}>
        <SheetContent side="right" showCloseButton={false} className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md">
          <SheetTitle className="sr-only">Token inspector</SheetTitle>
          <SheetDescription className="sr-only">Value, alias chain, dependents and usages of the selected token.</SheetDescription>
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <aside aria-label="Token inspector" className={cn("min-w-0", open ? (hydrated ? "hidden xl:block" : "block") : "hidden")}>
      <div className="xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto rounded-xl border bg-card">{body}</div>
    </aside>
  );
}

function InspectorBody({ state, onClose, contrastHref }: { state: State; onClose: () => void; contrastHref: string }) {
  const live = state.status === "ready" ? `Inspecting ${state.data.token.name}` : state.status === "loading" ? "Loading token" : state.status === "error" ? state.message : "";
  return (
    <div className="flex flex-col">
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      {state.status === "idle" && (
        <div className="space-y-2 p-5 text-sm text-muted-foreground">
          <p className="type-eyebrow">Inspector</p>
          <p>Select a token to see its authored value, alias chain, the tokens that reference it and the components that use it.</p>
        </div>
      )}
      {state.status === "loading" && (
        <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden /> Loading token…
        </div>
      )}
      {state.status === "error" && (
        <div className="space-y-3 p-5 text-sm">
          <p className="font-medium">Could not load this token</p>
          <p className="text-muted-foreground">{state.message}</p>
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
      {state.status === "ready" && <InspectorContent data={state.data} onClose={onClose} contrastHref={contrastHref} />}
    </div>
  );
}

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      aria-label={done ? `${label} copied` : `Copy ${label}`}
      title={done ? "Copied" : `Copy ${label}`}
    >
      <CopyIcon className="size-3.5" aria-hidden />
    </button>
  );
}

function TokenButton({ id, name, sub }: { id: string | null; name: string; sub?: string | null }) {
  const { select } = useInspector();
  const inner = (
    <>
      <span className="min-w-0 truncate font-mono text-[12px]">{name}</span>
      {sub && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{sub}</span>}
    </>
  );
  if (!id) return <span className="flex min-w-0 items-center gap-2">{inner}</span>;
  return (
    <button type="button" onClick={() => select(id)} className="flex min-w-0 items-center gap-2 rounded text-left hover:text-primary hover:underline focus-visible:underline">
      {inner}
    </button>
  );
}

function EdgeTree({ fromId, edges, depth = 0, seen }: { fromId: string; edges: ChainEdge[]; depth?: number; seen: Set<string> }) {
  const mine = edges.filter((e) => e.fromId === fromId);
  if (!mine.length || depth > 7) return null;
  return (
    <ul className={cn("space-y-1.5", depth > 0 && "mt-1.5 ml-3 border-l pl-3")}>
      {mine.map((e) => {
        const loop = !!e.targetId && seen.has(e.targetId);
        const next = new Set(seen);
        if (e.targetId) next.add(e.targetId);
        return (
          <li key={`${e.fromId}-${e.ref}`} className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <CornerDownRightIcon className="size-3 shrink-0 text-subtle-foreground" aria-hidden />
              {e.targetId && e.targetResolved !== undefined && <Swatch value={e.targetResolved} className="size-3.5" />}
              <TokenButton id={e.targetId} name={e.targetName ?? e.ref} sub={e.targetSetSlug} />
              <AliasStateBadge state={e.state} compact />
            </div>
            {e.state === "theme-dependent" && <p className="mt-1 ml-5 text-[11px] text-muted-foreground">Resolves to a different value in each themed set; one is shown here.</p>}
            {e.state === "external" && <p className="mt-1 ml-5 text-[11px] text-muted-foreground">Target is outside the sets ATLAS indexed: <code className="font-mono">{e.ref}</code></p>}
            {loop ? <p className="mt-1 ml-5 text-[11px] text-conflicting">Reference loops back (cycle).</p> : e.targetId && <EdgeTree fromId={e.targetId} edges={edges} depth={depth + 1} seen={next} />}
          </li>
        );
      })}
    </ul>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 py-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-[13px]">{children}</dd>
    </div>
  );
}

function InspectorContent({ data, onClose, contrastHref }: { data: InspectorData; onClose: () => void; contrastHref: string }) {
  const t = data.token;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus({ preventScroll: true }), [t.id]);
  const setOrder = Object.keys(data.setThemes);
  const tv = themeValues(t.resolvedValue, setOrder);
  const pv = previewValue(t);
  const isColor = t.category === "color";
  const authored = authoredLabel(t.rawValue, t.type);
  const resolved = t.valueText;
  const meta = ALIAS_STATE_META[(t.aliasState ?? "literal") as keyof typeof ALIAS_STATE_META];
  const fgHref = `${contrastHref}&fg=${encodeURIComponent(t.name)}`;
  const bgHref = `${contrastHref}&bg=${encodeURIComponent(t.name)}`;
  return (
    <div className="divide-y">
      <div className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="type-eyebrow">
            {t.category} · {data.set.name}
          </p>
          <button type="button" onClick={onClose} className="-mt-1 -mr-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close inspector">
            <XIcon className="size-4" aria-hidden />
          </button>
        </div>
        <div className="flex items-start gap-1">
          <h2 ref={headingRef} tabIndex={-1} className="min-w-0 font-mono text-[15px] leading-snug font-medium break-all outline-none">
            {t.name}
          </h2>
          <Copy text={t.name} label="token name" />
        </div>
        {isColor && (
          <div className="overflow-hidden rounded-lg">
            {tv.length ? (
              <div className="flex h-16">
                {tv.map((v) => (
                  <div key={v.setSlug} className="relative flex-1" title={`${data.setThemes[v.setSlug]?.name ?? v.setSlug}: ${colorLabel(v.value)}`}>
                    <Swatch value={v.value} className="absolute inset-0 size-full rounded-none" />
                  </div>
                ))}
              </div>
            ) : (
              <Swatch value={pv} className="h-16 w-full rounded-lg" />
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <AliasStateBadge state={t.aliasState} />
          {t.tier && (
            <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-none">
              {t.tier}
              {t.tierState === "inferred" && <VerificationBadge state="inferred" compact detail="Tier inferred by ATLAS from naming and alias structure; the source does not declare it." />}
            </span>
          )}
          {t.deprecated && <span className="rounded border border-conflicting/30 bg-conflicting-soft px-1.5 py-0.5 text-[11px] leading-none text-conflicting">Deprecated</span>}
        </div>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
      </div>

      <dl className="px-5 py-3">
        <Row label="Authored">
          <code className="font-mono text-[12px] break-all">{authored || "—"}</code>
        </Row>
        <Row label="Resolved">
          {tv.length ? (
            <span className="text-muted-foreground">Per theme (below)</span>
          ) : resolved ? (
            <code className="font-mono text-[12px] break-all">{resolved}</code>
          ) : (
            <span className="text-muted-foreground">No static value ({t.aliasState ?? "literal"})</span>
          )}
        </Row>
        {t.cssVar && (
          <Row label="CSS variable">
            <span className="flex items-center gap-1">
              <code className="min-w-0 font-mono text-[12px] break-all">{t.cssVar}</code>
              <Copy text={`var(${t.cssVar})`} label="CSS variable" />
            </span>
          </Row>
        )}
        <Row label="Type">{t.type ? <code className="font-mono text-[12px]">{t.type}</code> : <span className="text-muted-foreground">Not declared by source</span>}</Row>
        <Row label="Set">
          <span className="block">{data.set.name}</span>
          <span className="block text-xs text-muted-foreground">
            {[data.set.theme, data.set.format, data.set.packageName && `${data.set.packageName}${data.set.packageVersion ? `@${data.set.packageVersion}` : ""}`].filter(Boolean).join(" · ")}
          </span>
        </Row>
        {t.location && (
          <Row label="Location">
            <SourceLink href={data.sourceUrl} className="max-w-full text-[12px]">
              <span className="font-mono break-all">{t.location}</span>
            </SourceLink>
          </Row>
        )}
        {t.description && <Row label="Description">{t.description}</Row>}
      </dl>

      {tv.length > 0 && (
        <section className="space-y-2 px-5 py-4" aria-labelledby="insp-themes">
          <h3 id="insp-themes" className="text-xs font-semibold">
            Value per themed set
          </h3>
          <ul className="space-y-1.5">
            {tv.map((v) => {
              const s = data.setThemes[v.setSlug];
              return (
                <li key={v.setSlug} className="flex items-center gap-2 text-[12px]">
                  <Swatch value={v.value} className="size-4" />
                  <span className="w-24 shrink-0 truncate" title={s?.name ?? v.setSlug}>
                    {themeShortLabel(s?.theme, v.setSlug)}
                  </span>
                  <code className="min-w-0 truncate font-mono text-muted-foreground">{swatchColor(v.value) ? colorLabel(v.value) : authoredLabel(v.value)}</code>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-2 px-5 py-4" aria-labelledby="insp-up">
        <h3 id="insp-up" className="flex items-center gap-1.5 text-xs font-semibold">
          <ArrowRightIcon className="size-3.5" aria-hidden /> References (upstream)
        </h3>
        {t.refs.length ? (
          <EdgeTree fromId={t.id} edges={data.edges} seen={new Set([t.id])} />
        ) : (
          <p className="text-xs text-muted-foreground">{t.isAlias ? "Alias references were not recorded for this token." : "None. This token holds a literal value."}</p>
        )}
      </section>

      <section className="space-y-2 px-5 py-4" aria-labelledby="insp-down">
        <h3 id="insp-down" className="flex items-center gap-1.5 text-xs font-semibold">
          <ArrowLeftIcon className="size-3.5" aria-hidden /> Referenced by (downstream)
          <span className="tabular ml-auto font-normal text-muted-foreground">{formatCount(data.dependents.total)}</span>
        </h3>
        {data.dependents.total === 0 ? (
          <p className="text-xs text-muted-foreground">No indexed token references this token.</p>
        ) : (
          <>
            {data.dependents.viaTheme > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {formatCount(data.dependents.viaTheme)} theme-dependent reference{data.dependents.viaTheme === 1 ? "" : "s"} resolve through this token name in each themed set.
              </p>
            )}
            <ul className="space-y-1">
              {data.dependents.items.map((d) => (
                <li key={d.id} className="min-w-0">
                  <TokenButton id={d.id} name={d.name} sub={d.setSlug === data.set.slug ? null : d.setSlug} />
                </li>
              ))}
            </ul>
            {data.dependents.total > data.dependents.items.length && (
              <p className="text-[11px] text-muted-foreground">
                Showing {data.dependents.items.length} of {formatCount(data.dependents.total)}.
              </p>
            )}
          </>
        )}
      </section>

      <section className="space-y-2 px-5 py-4" aria-labelledby="insp-use">
        <h3 id="insp-use" className="flex items-center text-xs font-semibold">
          Used by components
          <span className="tabular ml-auto font-normal text-muted-foreground">{formatCount(data.usages.total)}</span>
        </h3>
        {data.usages.total === 0 ? (
          <p className="text-xs text-muted-foreground">No documented component usage was extracted for this token.</p>
        ) : (
          <ul className="space-y-1">
            {data.usages.items.map((u) => (
              <li key={`${u.componentSlug}-${u.property}`} className="flex min-w-0 items-center gap-2 text-[12px]">
                <a className="link-underline truncate" href={`/systems/${encodeURIComponent(u.systemSlug)}/components/${encodeURIComponent(u.componentSlug)}`}>
                  {u.componentName}
                </a>
                {u.property && <code className="truncate font-mono text-[11px] text-muted-foreground">{u.property}</code>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isColor && (
        <div className="flex flex-wrap gap-2 px-5 py-4">
          <Button asChild size="xs" variant="outline">
            <a href={fgHref}>Check as foreground</a>
          </Button>
          <Button asChild size="xs" variant="outline">
            <a href={bgHref}>Check as background</a>
          </Button>
        </div>
      )}
    </div>
  );
}
