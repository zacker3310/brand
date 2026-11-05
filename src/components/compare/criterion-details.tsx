import { ChevronRightIcon, InfoIcon } from "lucide-react";
import { SystemMark } from "@/components/atlas/system-mark";
import { CONFIDENCE_NOTE, RUBRIC_DEFINITIONS } from "@/lib/scoring/definitions";
import type { CriterionId, RubricInput } from "@/lib/scoring/types";
import { cn } from "@/lib/utils";
import { INFERRED_TEXT } from "./tone";
import { ConfidenceLine, ScoreBar, ScoreValue, type ScoredSystem } from "./scorecard";

const SOURCE_LABEL = { registry: "Registry", components: "Components", tokens: "Tokens" } as const;

function InputRow({ i }: { i: RubricInput }) {
  const known = i.value !== null;
  const informational = i.weight === 0;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-2">
      <span className="min-w-0 text-xs font-medium text-foreground/90">{i.label}</span>
      <span className="tabular text-right font-mono text-[10px] text-muted-foreground">
        {informational ? "info" : `w ${i.weight}`}
        {!informational && known && ` · ${Math.round((i.value as number) * 100)}%`}
      </span>
      <span className={cn("col-span-2 text-xs leading-snug break-words", known || informational ? "text-muted-foreground" : "text-unavailable")}>
        {i.display}
        {!known && !informational && <span className="ml-1 rounded border border-dashed border-unavailable/50 px-1 text-[10px]">unknown · excluded from score</span>}
        {known && !informational && i.coverage < 1 && (
          <span className={cn("ml-1 rounded border border-inferred/30 bg-inferred-soft px-1 text-[10px]", INFERRED_TEXT)}>
            {i.value === 0 ? "not found; weak evidence" : `observed for ${Math.round(i.coverage * 100)}%`}
          </span>
        )}
      </span>
      {i.note && <span className="col-span-2 text-[11px] leading-snug text-muted-foreground">{i.note}</span>}
    </li>
  );
}

/** One section per criterion: the rubric definition (expandable) and each system's inputs and explanation. */
export function CriterionDetails({ criterion, systems }: { criterion: CriterionId; systems: ScoredSystem[] }) {
  const d = RUBRIC_DEFINITIONS[criterion];
  return (
    <section id={criterion} aria-labelledby={`${criterion}-title`} className="scroll-mt-20 space-y-4">
      <div className="space-y-1">
        <h3 id={`${criterion}-title`} className="text-base font-semibold tracking-tight">
          {d.label}
        </h3>
        <p className="text-sm text-muted-foreground">{d.question}</p>
      </div>
      <details className="group/def rounded-lg border bg-surface-1/50">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-open/def:rotate-90" aria-hidden />
          How this is scored
          <span className="ml-auto font-mono text-[10px] font-normal text-muted-foreground">from {d.sources.map((s) => SOURCE_LABEL[s]).join(" + ")}</span>
        </summary>
        <div className="space-y-3 border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <ul className="list-disc space-y-1 pl-4">
            {d.method.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          {d.caveats.map((c) => (
            <p key={c} className="flex items-start gap-1.5 text-foreground/80">
              <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {c}
            </p>
          ))}
          <p className="text-muted-foreground">{CONFIDENCE_NOTE}</p>
        </div>
      </details>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {systems.map((s) => {
          const r = s.results.find((x) => x.criterion === criterion);
          if (!r) return null;
          return (
            <li key={s.slug} id={`${criterion}-${s.slug}`} className="min-w-0 scroll-mt-20 rounded-lg border bg-card target:ring-2 target:ring-ring/50">
              <div className="space-y-2 border-b px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <SystemMark name={s.name} slug={s.slug} size="sm" />
                    <span className="truncate text-sm font-medium">{s.name}</span>
                  </span>
                  <ScoreValue r={r} />
                </div>
                <ScoreBar score={r.score} />
                <ConfidenceLine r={r} />
              </div>
              <div className="space-y-2 px-3 py-3">
                <p className="text-[13px] leading-relaxed break-words text-foreground/90">{r.explanation}</p>
                {r.caps.length > 0 && (
                  <ul className="space-y-1">
                    {r.caps.map((c) => (
                      <li key={c} className={cn("text-[11px] leading-snug", INFERRED_TEXT)}>
                        Confidence limited: {c}
                      </li>
                    ))}
                  </ul>
                )}
                <ul className="divide-y divide-border/70 border-t">
                  {r.inputs.map((i) => (
                    <InputRow key={i.key} i={i} />
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
