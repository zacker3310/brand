"use client";

import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useHydrated } from "./use-hydrated";

export interface TypeChoice {
  slug: string;
  name: string;
  group: string;
  groupName: string;
  systemCount: number;
}

const countLabel = (n: number) => (n === 0 ? "not indexed" : `${n} system${n === 1 ? "" : "s"}`);

const controlClass =
  "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm shadow-xs transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * Canonical component type picker. Server HTML (and no-JS clients) get a native <select>;
 * once hydrated it becomes a searchable combobox. Both submit `type=<slug>`.
 */
export function TypeCombobox({
  id,
  types,
  value,
  onChange,
  describedBy,
}: {
  id: string;
  types: TypeChoice[];
  value: string | null;
  onChange: (slug: string) => void;
  describedBy?: string;
}) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; items: TypeChoice[] }>();
    for (const t of types) {
      const g = m.get(t.group) ?? { name: t.groupName, items: [] };
      g.items.push(t);
      m.set(t.group, g);
    }
    for (const g of m.values()) g.items.sort((a, b) => b.systemCount - a.systemCount || a.name.localeCompare(b.name));
    return [...m.entries()];
  }, [types]);
  const selected = types.find((t) => t.slug === value) ?? null;

  if (!hydrated) {
    return (
      <div className="relative">
        <select
          id={id}
          name="type"
          defaultValue={value ?? ""}
          aria-describedby={describedBy}
          className={cn(controlClass, "appearance-none pr-9")}
          required
        >
          <option value="" disabled>
            Choose a component type…
          </option>
          {groups.map(([g, { name, items }]) => (
            <optgroup key={g} label={name}>
              {items.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.name} · {countLabel(t.systemCount)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronsUpDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    <>
      <input type="hidden" name="type" value={value ?? ""} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={`${id}-list`}
            aria-describedby={describedBy}
            className={controlClass}
          >
            {selected ? (
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate font-medium">{selected.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{countLabel(selected.systemCount)}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Choose a component type…</span>
            )}
            <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search component types…" aria-label="Search component types" />
            <CommandList id={`${id}-list`} className="max-h-80">
              <CommandEmpty>No canonical type matches.</CommandEmpty>
              {groups.map(([g, { name, items }]) => (
                <CommandGroup key={g} heading={name}>
                  {items.map((t) => (
                    <CommandItem
                      key={t.slug}
                      value={`${t.name} ${t.slug}`}
                      onSelect={() => {
                        onChange(t.slug);
                        setOpen(false);
                      }}
                      className="justify-between"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <CheckIcon className={cn("size-3.5", t.slug === value ? "opacity-100" : "opacity-0")} aria-hidden />
                        <span className={cn("truncate", t.systemCount === 0 && "text-muted-foreground")}>{t.name}</span>
                      </span>
                      <span className={cn("tabular shrink-0 font-mono text-[11px]", t.systemCount ? "text-muted-foreground" : "text-subtle-foreground")}>
                        {t.systemCount || "—"}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
