import { Grid3x3Icon, ListIcon, SearchIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { COMPONENT_GROUPS, FRAMEWORKS, PLATFORMS } from "@/lib/taxonomy";
import { cn } from "@/lib/utils";
import type { SystemLabel } from "@/server/queries/components";
import { ariaPatternLabel } from "./lib/apg";
import { catalogHref, withoutFilter, type CatalogParams, type FilterKey } from "./lib/params";
import type { QueryExpansion } from "./lib/search";

export function Segmented({
  label,
  items,
  className,
}: {
  label: string;
  items: { href: string; label: string; active: boolean; icon?: typeof ListIcon; count?: number }[];
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("inline-flex rounded-lg border bg-surface-1 p-0.5", className)}>
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          scroll={false}
          aria-current={it.active ? "page" : undefined}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground",
            it.active && "bg-background text-foreground shadow-xs ring-1 ring-border dark:bg-accent",
          )}
        >
          {it.icon && <it.icon className="size-3.5" aria-hidden />}
          {it.label}
          {it.count !== undefined && <span className="tabular font-mono text-[11px] text-muted-foreground">{it.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function CatalogSearchInput({ params }: { params: CatalogParams }) {
  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor="catalog-q" className="sr-only">
        Search components and types
      </label>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id="catalog-q"
        type="search"
        name="q"
        defaultValue={params.q}
        placeholder="Filter by name, alias or type: combobox, snackbar, UnderlineNav…"
        autoComplete="off"
        spellCheck={false}
        className="h-9 w-full min-w-0 rounded-md border border-input bg-background pr-3 pl-8.5 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30 [&::-webkit-search-cancel-button]:opacity-60"
      />
    </div>
  );
}

const GROUP_NAMES = new Map(COMPONENT_GROUPS.map((g) => [g.slug, g.name]));
const FRAMEWORK_NAMES = new Map(FRAMEWORKS.map((f) => [f.slug, f.name]));
const PLATFORM_NAMES = new Map(PLATFORMS.map((p) => [p.slug, p.name]));

export function ActiveFilters({ params, systems }: { params: CatalogParams; systems: Map<string, SystemLabel> }) {
  const chips: { key: FilterKey; value?: string; label: string }[] = [];
  if (params.q) chips.push({ key: "q", label: `“${params.q}”` });
  for (const s of params.systems) chips.push({ key: "system", value: s, label: systems.get(s)?.shortName ?? s });
  if (params.group) chips.push({ key: "group", label: GROUP_NAMES.get(params.group) ?? params.group });
  for (const s of params.frameworks) chips.push({ key: "framework", value: s, label: FRAMEWORK_NAMES.get(s) ?? s });
  for (const s of params.platforms) chips.push({ key: "platform", value: s, label: PLATFORM_NAMES.get(s) ?? s });
  for (const s of params.patterns) chips.push({ key: "pattern", value: s, label: `Pattern: ${ariaPatternLabel(s)}` });
  if (params.a11y) chips.push({ key: "a11y", label: "A11y documented" });
  for (const s of params.has) chips.push({ key: "has", value: s, label: s === "source" ? "Has source link" : "Has props" });
  for (const s of params.classification) chips.push({ key: "class", value: s, label: `Classification: ${s}` });
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Active filters" className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <li key={`${c.key}:${c.value ?? ""}`}>
          <Link
            href={withoutFilter(params, c.key, c.value)}
            scroll={false}
            className="group inline-flex h-6 items-center gap-1 rounded-full border bg-surface-1 pr-1.5 pl-2.5 text-xs text-foreground/90 transition-colors hover:border-foreground/30"
          >
            {c.label}
            <XIcon className="size-3 text-muted-foreground group-hover:text-foreground" aria-hidden />
            <span className="sr-only">(remove filter)</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ExpansionNote({ expansion }: { expansion: QueryExpansion }) {
  if (expansion.reasons.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Also matching implementations ATLAS mapped to{" "}
      {expansion.reasons.map((r, i) => (
        <span key={r.slug}>
          {i > 0 && (i === expansion.reasons.length - 1 ? " and " : ", ")}
          <Link href={`/components/${r.slug}`} className="link-underline text-foreground/90">
            {r.name}
          </Link>
          <span className="text-muted-foreground"> ({r.via})</span>
        </span>
      ))}
      . Names stay system-specific: related types are not interchangeable.
    </p>
  );
}

export function viewItems(params: CatalogParams, counts: { types: number; components: number }) {
  return [
    { href: catalogHref(params, { view: "types" }), label: "Types", active: params.view === "types", count: counts.types },
    { href: catalogHref(params, { view: "components" }), label: "Components", active: params.view === "components", count: counts.components },
  ];
}

export function layoutItems(params: CatalogParams) {
  return [
    { href: catalogHref(params, { layout: "list" }), label: "List", active: params.layout === "list", icon: ListIcon },
    { href: catalogHref(params, { layout: "matrix" }), label: "Coverage matrix", active: params.layout === "matrix", icon: Grid3x3Icon },
  ];
}
