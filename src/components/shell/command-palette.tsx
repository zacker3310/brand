"use client";

import { BoxIcon, CompassIcon, LayersIcon, LibraryIcon, PaletteIcon, PuzzleIcon, SearchIcon, ShapesIcon, SplitIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import type { SearchHit, SearchResult } from "@/lib/contracts";

const PaletteContext = createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null);

const ENTITY_LABEL: Record<string, string> = {
  system: "Design systems",
  component: "Components",
  "component-type": "Component types",
  pattern: "Patterns",
  "pattern-type": "Pattern types",
  token: "Tokens",
  framework: "Frameworks",
  category: "Categories",
};

const ENTITY_ICON: Record<string, typeof BoxIcon> = {
  system: LibraryIcon,
  component: BoxIcon,
  "component-type": ShapesIcon,
  pattern: PuzzleIcon,
  "pattern-type": PuzzleIcon,
  token: PaletteIcon,
  framework: LayersIcon,
  category: CompassIcon,
};

const QUICK_LINKS = [
  { href: "/systems", label: "Browse design systems", icon: LibraryIcon },
  { href: "/components", label: "Universal component catalog", icon: ShapesIcon },
  { href: "/compare", label: "Compare implementations", icon: SplitIcon },
  { href: "/tokens", label: "Token explorer", icon: PaletteIcon },
  { href: "/patterns", label: "Pattern library", icon: PuzzleIcon },
];

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !isEditable(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return (
    <PaletteContext.Provider value={value}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </PaletteContext.Provider>
  );
}

function isEditable(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function useCommandPalette() {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used inside CommandPaletteProvider");
  return ctx;
}

export function CommandPaletteTrigger() {
  const { setOpen } = useCommandPalette();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setOpen(true)}
      className="h-8 gap-2 border-border/80 bg-surface-1 px-2.5 text-muted-foreground hover:text-foreground sm:w-64 sm:justify-start lg:w-72"
      aria-label="Search systems, components, tokens and patterns"
      aria-keyshortcuts="Meta+K Control+K"
    >
      <SearchIcon className="size-3.5" aria-hidden />
      <span className="hidden min-w-0 truncate text-[13px] font-normal sm:inline">Search systems, components…</span>
      <Kbd className="ml-auto hidden shrink-0 sm:inline-flex">⌘K</Kbd>
    </Button>
  );
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const term = q.trim();
    abortRef.current?.abort();
    if (!term) {
      setResult(null);
      setError(null);
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}&limit=24`, { signal: ac.signal });
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        setResult((await res.json()) as SearchResult);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 140);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q]);

  const go = useCallback(
    (href: string) => {
      onOpenChange(false);
      setQ("");
      router.push(href);
    },
    [onOpenChange, router],
  );

  const groups = useMemo(() => {
    const m = new Map<string, SearchHit[]>();
    for (const h of result?.hits ?? []) {
      const arr = m.get(h.entityType) ?? [];
      if (arr.length < 6) arr.push(h);
      m.set(h.entityType, arr);
    }
    return [...m.entries()];
  }, [result]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search ATLAS" description="Search design systems, components, tokens and patterns" className="sm:max-w-2xl" shouldFilter={false}>
      <CommandInput placeholder="Try “React combobox”, “dark mode tokens”, “government”…" value={q} onValueChange={setQ} />
      <CommandList className="max-h-[min(60vh,520px)]">
        {!q.trim() && (
          <CommandGroup heading="Go to">
            {QUICK_LINKS.map((l) => (
              <CommandItem key={l.href} value={l.label} onSelect={() => go(l.href)}>
                <l.icon aria-hidden /> {l.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {q.trim() && !loading && !error && result && result.hits.length === 0 && <CommandEmpty>No indexed records match “{q}”.</CommandEmpty>}
        {error && <div className="px-4 py-6 text-sm text-conflicting">{error}</div>}
        {q.trim() && result && (result.expansions.length > 0 || Object.keys(result.interpretedFilters).length > 0) && (
          <div className="flex flex-wrap gap-1.5 border-b px-3 py-2 text-xs text-muted-foreground">
            {Object.entries(result.interpretedFilters).map(([k, v]) => (
              <span key={k} className="rounded bg-accent px-1.5 py-0.5 text-accent-foreground">
                {k}: {v.join(", ")}
              </span>
            ))}
            {result.expansions.length > 0 && <span>also searching: {result.expansions.slice(0, 5).join(", ")}</span>}
          </div>
        )}
        {groups.map(([type, hits], gi) => {
          const Icon = ENTITY_ICON[type] ?? BoxIcon;
          return (
            <div key={type}>
              {gi > 0 && <CommandSeparator />}
              <CommandGroup heading={ENTITY_LABEL[type] ?? type}>
                {hits.map((h) => (
                  <CommandItem key={`${h.entityType}:${h.entityId}`} value={`${q} ${h.entityType} ${h.entityId}`} onSelect={() => go(h.url)}>
                    <Icon aria-hidden />
                    <span className="truncate">{h.title}</span>
                    {h.subtitle && <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">{h.subtitle}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          );
        })}
        {q.trim() && (
          <CommandGroup heading="Search">
            <CommandItem value={`${q} __all`} onSelect={() => go(`/search?q=${encodeURIComponent(q.trim())}`)}>
              <SearchIcon aria-hidden /> See all results for “{q.trim()}”
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
