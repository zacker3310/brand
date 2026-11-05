"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { SystemMark } from "@/components/atlas/system-mark";
import { MAX_SYSTEMS } from "@/lib/scoring/params";
import { cn } from "@/lib/utils";
import { useHydrated } from "./use-hydrated";

export interface SystemChoice {
  slug: string;
  name: string;
  ingestionStatus: string;
  components: number;
}

const INDEXED = new Set(["indexed", "partial"]);

/**
 * Inline multi-select of design systems (native checkboxes, so it submits without JS). When a
 * component type is given, systems implementing it come first; the rest are labelled honestly as
 * not in the ATLAS index for that type. Selection order is column order.
 */
export function SystemPicker({
  systems,
  selected,
  onChange,
  typeName,
  typeImpl,
  max = MAX_SYSTEMS,
  legend = "Systems",
  listClassName,
}: {
  systems: SystemChoice[];
  selected: string[];
  onChange: (next: string[]) => void;
  typeName?: string | null;
  /** systemSlug -> number of components of the chosen type. */
  typeImpl?: Record<string, number> | null;
  max?: number;
  legend?: string;
  listClassName?: string;
}) {
  const hydrated = useHydrated();
  const [q, setQ] = useState("");
  const uid = useId();
  const byslug = useMemo(() => new Map(systems.map((s) => [s.slug, s])), [systems]);

  const sections = useMemo(() => {
    const name = (a: SystemChoice, b: SystemChoice) => a.name.localeCompare(b.name);
    if (typeImpl) {
      const yes = systems.filter((s) => (typeImpl[s.slug] ?? 0) > 0).sort((a, b) => (typeImpl[b.slug] ?? 0) - (typeImpl[a.slug] ?? 0) || name(a, b));
      const no = systems.filter((s) => !(typeImpl[s.slug] ?? 0)).sort(name);
      return [
        { id: "yes", title: `Implements ${typeName ?? "this type"}`, items: yes, empty: `No indexed system has a component classified as ${typeName ?? "this type"} yet.` },
        { id: "no", title: `Not in ATLAS index for ${typeName ?? "this type"}`, items: no, empty: null },
      ];
    }
    const idx = systems.filter((s) => INDEXED.has(s.ingestionStatus) && s.components > 0).sort((a, b) => b.components - a.components || name(a, b));
    const meta = systems.filter((s) => !(INDEXED.has(s.ingestionStatus) && s.components > 0)).sort(name);
    return [
      { id: "idx", title: "Indexed: components and tokens", items: idx, empty: "No system is indexed yet." },
      { id: "meta", title: "Registry metadata only", items: meta, empty: null },
    ];
  }, [systems, typeImpl, typeName]);

  const needle = q.trim().toLowerCase();
  const matches = (s: SystemChoice) => !needle || s.name.toLowerCase().includes(needle) || s.slug.includes(needle);
  const full = selected.length >= max;
  const toggle = (slug: string, on: boolean) => {
    if (on && !selected.includes(slug) && selected.length < max) onChange([...selected, slug]);
    if (!on) onChange(selected.filter((s) => s !== slug));
  };

  const meta = (s: SystemChoice) => {
    if (typeImpl) {
      const n = typeImpl[s.slug] ?? 0;
      if (n) return `${n} component${n === 1 ? "" : "s"}`;
      return INDEXED.has(s.ingestionStatus) && s.components > 0 ? "none classified" : "metadata only";
    }
    return INDEXED.has(s.ingestionStatus) && s.components > 0 ? `${s.components} components` : "metadata only";
  };

  return (
    <fieldset className="min-w-0 space-y-2.5" aria-describedby={`${uid}-hint`}>
      <div className="flex items-baseline justify-between gap-3">
        <legend className="text-sm font-medium">{legend}</legend>
        <span id={`${uid}-hint`} className="tabular text-xs text-muted-foreground" aria-live="polite">
          {hydrated ? `${selected.length} of ${max} selected` : `Choose 2 to ${max}`}
          {hydrated && full ? " · limit reached" : ""}
        </span>
      </div>

      {hydrated && (
        <div className="flex min-h-8 flex-wrap items-center gap-1.5" aria-label="Selected systems">
          {selected.length === 0 && <span className="text-xs text-muted-foreground">Nothing selected yet. Columns follow selection order.</span>}
          {selected.map((slug, i) => {
            const s = byslug.get(slug);
            return (
              <span key={slug} className="inline-flex items-center gap-1.5 rounded-md border bg-surface-1 py-0.5 pr-0.5 pl-1.5 text-xs">
                <span className="tabular font-mono text-[10px] text-subtle-foreground">{i + 1}</span>
                <span className="max-w-40 truncate font-medium">{s?.name ?? slug}</span>
                <button
                  type="button"
                  onClick={() => toggle(slug, false)}
                  className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`Remove ${s?.name ?? slug}`}
                >
                  <XIcon className="size-3" aria-hidden />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        {hydrated && (
          <label className="flex items-center gap-2 border-b px-3">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">Filter systems</span>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter systems…"
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoComplete="off"
            />
          </label>
        )}
        <div className={cn("max-h-72 overflow-y-auto overscroll-contain", listClassName)}>
          {sections.map((sec) => {
            const visible = sec.items.filter(matches);
            return (
              <div key={sec.id} role="group" aria-labelledby={`${uid}-${sec.id}`}>
                <div id={`${uid}-${sec.id}`} className="sticky top-0 z-10 flex items-center justify-between border-b bg-surface-1/95 px-3 py-1.5 backdrop-blur">
                  <span className="type-eyebrow">{sec.title}</span>
                  <span className="tabular font-mono text-[11px] text-subtle-foreground">{sec.items.length}</span>
                </div>
                {sec.items.length === 0 && sec.empty && <p className="px-3 py-3 text-xs text-muted-foreground">{sec.empty}</p>}
                {hydrated && sec.items.length > 0 && visible.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">No match in this group.</p>}
                <ul>
                  {sec.items.map((s) => {
                    const checked = selected.includes(s.slug);
                    const disabled = hydrated && full && !checked;
                    return (
                      <li key={s.slug} hidden={hydrated && !matches(s)}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-accent/50 has-[:focus-visible]:bg-accent/60",
                            checked && "bg-accent/40",
                            disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                          )}
                        >
                          {hydrated ? (
                            <input
                              type="checkbox"
                              name="systems"
                              value={s.slug}
                              checked={checked}
                              disabled={disabled}
                              onChange={(e) => toggle(s.slug, e.target.checked)}
                              className="size-4 shrink-0 accent-primary"
                            />
                          ) : (
                            <input type="checkbox" name="systems" value={s.slug} defaultChecked={checked} className="size-4 shrink-0 accent-primary" />
                          )}
                          <SystemMark name={s.name} slug={s.slug} size="sm" />
                          <span className="min-w-0 flex-1 truncate">{s.name}</span>
                          <span className={cn("shrink-0 text-xs", meta(s).includes("component") ? "text-muted-foreground" : "text-subtle-foreground")}>{meta(s)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}
