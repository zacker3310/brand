"use client";

import { ChevronDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { componentCompareHref } from "@/lib/scoring/params";
import { cn } from "@/lib/utils";
import { useHydrated } from "./use-hydrated";

/**
 * Chooses which of a system's components (classified as the compared type) fills its column.
 * Native <select> in a GET form: submits with a button before hydration, navigates on change after.
 */
export function ComponentPickSelect({
  system,
  systemName,
  type,
  systems,
  picks,
  value,
  options,
  diffOnly,
  idPrefix = "pick",
}: {
  idPrefix?: string;
  system: string;
  systemName: string;
  type: string;
  systems: string[];
  picks: Record<string, string>;
  value: string;
  options: { slug: string; name: string; lifecycle: string }[];
  diffOnly: boolean;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [pending, start] = useTransition();
  const id = `${idPrefix}-${system}`;
  const otherPicks = Object.entries(picks).filter(([s]) => s !== system);
  return (
    <form action="/compare" method="get" className="flex items-center gap-1.5">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="systems" value={systems.join(",")} />
      {otherPicks.map(([s, c]) => (
        <input key={s} type="hidden" name="pick" value={`${s}:${c}`} />
      ))}
      {diffOnly && <input type="hidden" name="diff" value="1" />}
      <label htmlFor={id} className="sr-only">
        {systemName} component to compare
      </label>
      <div className="relative min-w-0 flex-1">
        <select
          id={id}
          name="pick"
          defaultValue={`${system}:${value}`}
          disabled={pending}
          onChange={(e) => {
            if (!hydrated) return;
            const slug = e.target.value.split(":")[1] ?? value;
            start(() => router.push(componentCompareHref({ type, systems, picks: { ...picks, [system]: slug }, diffOnly }), { scroll: false }));
          }}
          className={cn(
            "h-7 w-full min-w-0 appearance-none truncate rounded-md border border-input bg-background pr-7 pl-2 text-xs shadow-xs transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30",
            pending && "opacity-60",
          )}
        >
          {options.map((o) => (
            <option key={o.slug} value={`${system}:${o.slug}`}>
              {o.name}
              {o.lifecycle === "deprecated" ? " (deprecated)" : ""}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      </div>
      {!hydrated && (
        <button type="submit" className="h-7 rounded-md border px-2 text-xs font-medium hover:bg-accent">
          Show
        </button>
      )}
    </form>
  );
}
