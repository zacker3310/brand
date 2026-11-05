"use client";

import { SearchIcon } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface PropRow {
  name: string;
  type: string | null;
  defaultValue: string | null;
  required: boolean | null;
  deprecated: boolean;
  description: string | null;
  allowedValues: string[] | null;
}

export interface PropImplementation {
  key: string;
  label: string;
  props: PropRow[];
}

function matches(p: PropRow, q: string) {
  if (!q) return true;
  const n = q.toLowerCase();
  return (
    p.name.toLowerCase().includes(n) ||
    (p.type ?? "").toLowerCase().includes(n) ||
    (p.description ?? "").toLowerCase().includes(n) ||
    (p.allowedValues ?? []).some((v) => v.toLowerCase().includes(n))
  );
}

/** Updates one query param in place (shareable URL, no navigation, no scroll). */
function replaceParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", url);
}

const MAX_ALLOWED = 12;

function Unstated({ what }: { what: string }) {
  return (
    <span className="text-[11px] text-subtle-foreground italic" title={`The source does not state ${what}.`}>
      not stated
    </span>
  );
}

/**
 * API table, one tab per implementation (framework or documented sub-component).
 * Without JS: tabs are links (?impl=) and the filter is a GET form (?pq=), both rendered by the server.
 */
export function PropsTable({
  implementations,
  initialImpl,
  initialFilter,
}: {
  implementations: PropImplementation[];
  initialImpl: string;
  initialFilter: string;
}) {
  const [impl, setImpl] = useState(implementations.some((i) => i.key === initialImpl) ? initialImpl : (implementations[0]?.key ?? ""));
  const [filter, setFilter] = useState(initialFilter);
  const deferred = useDeferredValue(filter);
  const active = implementations.find((i) => i.key === impl) ?? implementations[0];
  const rows = useMemo(() => (active ? active.props.filter((p) => matches(p, deferred.trim())) : []), [active, deferred]);
  if (!active) return null;
  const required = active.props.filter((p) => p.required === true).length;
  const changeImpl = (v: string) => {
    setImpl(v);
    replaceParam("impl", v === implementations[0]?.key ? null : v);
  };
  const table = (
      <div className="overflow-x-auto rounded-xl border bg-card" role="region" aria-label={`${active.label} props, scrollable`} tabIndex={0}>
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[13px]">
        <caption className="sr-only">Props documented for the {active.label} implementation</caption>
        <thead>
          <tr className="text-left font-mono text-[11px] tracking-[0.1em] text-subtle-foreground uppercase">
            <th scope="col" className="sticky left-0 z-10 w-48 border-r border-b bg-surface-1 px-3 py-2 font-medium">
              Name
            </th>
            <th scope="col" className="w-64 border-b bg-surface-1 px-3 py-2 font-medium">
              Type
            </th>
            <th scope="col" className="border-b bg-surface-1 px-3 py-2 font-medium">
              Default
            </th>
            <th scope="col" className="border-b bg-surface-1 px-3 py-2 font-medium">
              Required
            </th>
            <th scope="col" className="border-b bg-surface-1 px-3 py-2 font-medium">
              Description
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                No props match “{deferred}”.
              </td>
            </tr>
          )}
          {rows.map((p) => (
            <tr key={p.name} className="group/row align-top">
              <th scope="row" className="sticky left-0 z-10 border-r border-b border-border/60 bg-card px-3 py-2.5 text-left font-normal group-hover/row:bg-accent">
                <code className={cn("font-mono text-[12.5px] font-medium break-all", p.deprecated && "text-muted-foreground line-through")}>{p.name}</code>
                {p.deprecated && (
                  <span className="mt-1 block w-fit rounded border border-conflicting/30 bg-conflicting-soft px-1 py-px font-mono text-[10px] text-conflicting uppercase">
                    Deprecated
                  </span>
                )}
              </th>
              <td className="border-b border-border/60 px-3 py-2.5">
                {p.type ? <code className="font-mono text-[12px] break-words text-foreground/85">{p.type}</code> : <Unstated what="a type" />}
                {p.allowedValues && p.allowedValues.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Allowed values">
                    {p.allowedValues.slice(0, MAX_ALLOWED).map((v) => (
                      <li key={v} className="rounded border bg-surface-1 px-1 py-px font-mono text-[11px] text-foreground/80">
                        {v}
                      </li>
                    ))}
                    {p.allowedValues.length > MAX_ALLOWED && (
                      <li className="px-1 text-[11px] text-muted-foreground">+{p.allowedValues.length - MAX_ALLOWED} more</li>
                    )}
                  </ul>
                )}
              </td>
              <td className="border-b border-border/60 px-3 py-2.5">
                {p.defaultValue !== null ? <code className="font-mono text-[12px] break-all">{p.defaultValue}</code> : <Unstated what="a default" />}
              </td>
              <td className="border-b border-border/60 px-3 py-2.5">
                {p.required === true ? (
                  <span className="font-medium text-foreground">Required</span>
                ) : p.required === false ? (
                  <span className="text-muted-foreground">Optional</span>
                ) : (
                  <Unstated what="whether it is required" />
                )}
              </td>
              <td className="max-w-md border-b border-border/60 px-3 py-2.5 text-[13px] leading-relaxed text-foreground/85">
                {p.description ?? <Unstated what="a description" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const deprecated = active.props.filter((p) => p.deprecated).length;

  const multi = implementations.length > 1;

  const filterForm = (
    <form method="get" action="#api" role="search" aria-label="Filter props" className="relative sm:w-64" onSubmit={(e) => e.preventDefault()}>
      {impl !== implementations[0]?.key && <input type="hidden" name="impl" value={impl} />}
      <label htmlFor="props-filter" className="sr-only">
        Filter props by name, type or description
      </label>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id="props-filter"
        type="search"
        name="pq"
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
          replaceParam("pq", e.target.value.trim() || null);
        }}
        placeholder="Filter props"
        autoComplete="off"
        className="h-8 w-full rounded-md border border-input bg-background pr-2 pl-8 text-[13px] shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      />
    </form>
  );

  const status = (
    <p className="tabular text-xs text-muted-foreground" role="status" aria-live="polite">
      {deferred.trim() ? `${rows.length} of ${active.props.length} props match` : `${active.props.length} props`}
      {required > 0 && ` · ${required} required`}
      {deprecated > 0 && ` · ${deprecated} deprecated`}
    </p>
  );

  if (!multi) {
    return (
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] font-medium">{active.label}</p>
          {filterForm}
        </div>
        {status}
        {table}
      </div>
    );
  }

  return (
    <Tabs value={impl} onValueChange={changeImpl} className="gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <TabsList aria-label="Implementation" className="h-auto max-w-full flex-wrap justify-start">
          {implementations.map((i) => (
            <TabsTrigger key={i.key} value={i.key} asChild className="h-7 flex-none px-2.5 text-[13px]">
              <a
                href={`?impl=${encodeURIComponent(i.key)}#api`}
                onClick={(e) => {
                  if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) e.preventDefault();
                }}
              >
                {i.label}
                <span className="tabular font-mono text-[10px] text-muted-foreground">{i.props.length}</span>
              </a>
            </TabsTrigger>
          ))}
        </TabsList>
        {filterForm}
      </div>
      {status}
      {implementations.map((i) => (
        <TabsContent key={i.key} value={i.key} className="mt-0">
          {i.key === active.key && table}
        </TabsContent>
      ))}
    </Tabs>
  );
}
