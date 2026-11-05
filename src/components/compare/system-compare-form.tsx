"use client";

import { ArrowRightIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { MAX_SYSTEMS, MIN_SYSTEMS, systemCompareHref } from "@/lib/scoring/params";
import type { CriterionId } from "@/lib/scoring/types";
import { cn } from "@/lib/utils";
import { SystemPicker, type SystemChoice } from "./system-picker";

export interface CriterionChoice {
  id: CriterionId;
  label: string;
  short: string;
}

/** GET form to /compare/systems: systems (2-5) + rubric criteria checkboxes. */
export function SystemCompareForm({
  systems,
  criteria,
  initialSystems,
  initialCriteria,
  submitLabel = "Compare systems",
  error,
}: {
  systems: SystemChoice[];
  criteria: CriterionChoice[];
  initialSystems: string[];
  initialCriteria: CriterionId[];
  submitLabel?: string;
  error?: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(initialSystems.slice(0, MAX_SYSTEMS));
  const [crit, setCrit] = useState<CriterionId[]>(initialCriteria);
  const [problem, setProblem] = useState<string | null>(error ?? null);
  const [pending, start] = useTransition();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (selected.length < MIN_SYSTEMS) return setProblem(`Select at least ${MIN_SYSTEMS} systems.`);
    if (!crit.length) return setProblem("Select at least one criterion.");
    setProblem(null);
    const ordered = criteria.map((c) => c.id).filter((c) => crit.includes(c));
    start(() => router.push(systemCompareHref({ systems: selected, criteria: ordered })));
  };

  return (
    <form action="/compare/systems" method="get" onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
      <SystemPicker legend={`Systems (${MIN_SYSTEMS}–${MAX_SYSTEMS})`} systems={systems} selected={selected} onChange={setSelected} />
      <div className="flex min-w-0 flex-col gap-6">
        <fieldset>
          <legend className="float-left text-sm font-medium">Criteria</legend>
          <div className="float-right flex items-baseline gap-3">
            <span className="flex gap-2 text-xs">
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setCrit(criteria.map((c) => c.id))}>
                Select all<span className="sr-only"> criteria</span>
              </button>
              <span className="text-muted-foreground" aria-hidden>
                ·
              </span>
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setCrit([])}>
                Clear<span className="sr-only"> criteria</span>
              </button>
            </span>
          </div>
          <ul className="clear-both mt-2.5 divide-y rounded-lg border bg-card">
            {criteria.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-accent/50 has-[:focus-visible]:bg-accent/60">
                  <input
                    type="checkbox"
                    name="criteria"
                    value={c.id}
                    checked={crit.includes(c.id)}
                    onChange={(e) => setCrit((cur) => (e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id)))}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{c.label}</span>
                    <span className="block text-xs text-muted-foreground">{c.short}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {submitLabel}
            <ArrowRightIcon aria-hidden />
          </Button>
          <p role="status" aria-live="polite" className={cn("text-sm", problem ? "text-destructive" : "text-muted-foreground")}>
            {problem ?? (pending ? "Scoring…" : "")}
          </p>
        </div>
      </div>
    </form>
  );
}
