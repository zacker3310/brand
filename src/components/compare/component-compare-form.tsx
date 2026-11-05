"use client";

import { ArrowRightIcon, WandSparklesIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { componentCompareHref, MAX_SYSTEMS, MIN_SYSTEMS } from "@/lib/scoring/params";
import { cn } from "@/lib/utils";
import { SystemPicker, type SystemChoice } from "./system-picker";
import { TypeCombobox, type TypeChoice } from "./type-combobox";

export interface TypeChoiceWithSystems extends TypeChoice {
  systems: Record<string, number>;
}

/** Picker for a component comparison. A GET form to /compare, enhanced with client-side routing. */
export function ComponentCompareForm({
  types,
  systems,
  initialType,
  initialSystems,
  submitLabel = "Compare",
  className,
  error,
}: {
  types: TypeChoiceWithSystems[];
  systems: SystemChoice[];
  initialType: string | null;
  initialSystems: string[];
  submitLabel?: string;
  className?: string;
  error?: string | null;
}) {
  const router = useRouter();
  const uid = useId();
  const [type, setType] = useState<string | null>(initialType);
  const [selected, setSelected] = useState<string[]>(initialSystems.slice(0, MAX_SYSTEMS));
  const [problem, setProblem] = useState<string | null>(error ?? null);
  const [pending, startTransition] = useTransition();
  const current = useMemo(() => types.find((t) => t.slug === type) ?? null, [types, type]);
  const implementing = current ? Object.entries(current.systems).sort((a, b) => b[1] - a[1]).map(([s]) => s) : [];

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!type) return setProblem("Choose a component type to compare.");
    if (selected.length < MIN_SYSTEMS) return setProblem(`Select at least ${MIN_SYSTEMS} systems.`);
    setProblem(null);
    startTransition(() => router.push(componentCompareHref({ type, systems: selected })));
  };

  return (
    <form action="/compare" method="get" onSubmit={onSubmit} className={cn("space-y-6", className)} noValidate>
      <div className="space-y-2">
        <label htmlFor={`${uid}-type`} className="text-sm font-medium">
          Component type
        </label>
        <TypeCombobox id={`${uid}-type`} types={types} value={type} onChange={setType} describedBy={`${uid}-type-hint`} />
        <p id={`${uid}-type-hint`} className="text-xs text-muted-foreground">
          ATLAS canonical types. Counts are systems with at least one indexed component classified as that type.
        </p>
      </div>

      <div className="space-y-2">
        <SystemPicker
          legend={`Systems to compare (${MIN_SYSTEMS}–${MAX_SYSTEMS})`}
          systems={systems}
          selected={selected}
          onChange={(next) => {
            setSelected(next);
            if (problem && next.length >= MIN_SYSTEMS) setProblem(null);
          }}
          typeName={current?.name ?? null}
          typeImpl={current?.systems ?? null}
        />
        {current && implementing.length >= MIN_SYSTEMS && selected.length === 0 && (
          <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setSelected(implementing.slice(0, MAX_SYSTEMS))}>
            <WandSparklesIcon aria-hidden />
            Select the {Math.min(implementing.length, MAX_SYSTEMS)} systems implementing {current.name}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {submitLabel}
          <ArrowRightIcon aria-hidden />
        </Button>
        <p role="status" aria-live="polite" className={cn("text-sm", problem ? "text-destructive" : "text-muted-foreground")}>
          {problem ?? (pending ? "Building comparison…" : "")}
        </p>
      </div>
    </form>
  );
}
