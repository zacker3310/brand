import { CheckIcon } from "lucide-react";
import { cn, formatCount } from "@/lib/utils";

export interface FacetOption {
  value: string;
  label: string;
  count: number;
  selected: boolean;
  hint?: string;
}

/** Native checkbox/radio (submits without JS) styled to the ATLAS kit. */
export function FacetControl({
  type,
  name,
  option,
  idPrefix,
}: {
  type: "checkbox" | "radio";
  name: string;
  option: FacetOption;
  idPrefix: string;
}) {
  const id = `${idPrefix}-${name}-${option.value || "all"}`;
  const empty = option.count === 0 && !option.selected;
  return (
    <label
      htmlFor={id}
      className={cn(
        "group/opt relative flex min-h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 text-[13px] transition-colors hover:bg-accent/60",
        empty && "text-muted-foreground/70",
        option.selected && "text-foreground",
      )}
    >
      <input
        id={id}
        type={type}
        name={name}
        value={option.value}
        defaultChecked={option.selected}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "grid size-4 shrink-0 place-items-center border border-input bg-background transition-colors peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-checked:[&>svg]:opacity-100",
          type === "radio" ? "rounded-full" : "rounded-[4px]",
        )}
      >
        {type === "radio" ? (
          <span className="size-1.5 rounded-full bg-current opacity-0 transition-opacity [.peer:checked~span>&]:opacity-100" />
        ) : (
          <CheckIcon className="size-3 opacity-0 transition-opacity" strokeWidth={3} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate" title={option.hint ?? option.label}>
        {option.label}
      </span>
      <span className="tabular ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">{formatCount(option.count)}</span>
    </label>
  );
}

export function FacetGroup({
  legend,
  name,
  type = "checkbox",
  options,
  idPrefix,
  visible = 8,
  description,
}: {
  legend: string;
  name: string;
  type?: "checkbox" | "radio";
  options: FacetOption[];
  idPrefix: string;
  visible?: number;
  description?: string;
}) {
  if (options.length === 0) return null;
  // Selected values are always visible; the long tail folds into a native disclosure.
  const head: FacetOption[] = [];
  const tail: FacetOption[] = [];
  options.forEach((o, i) => (i < visible || o.selected ? head : tail).push(o));
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className="mb-1.5 px-2 font-mono text-[11px] font-medium tracking-[0.12em] text-subtle-foreground uppercase">{legend}</legend>
      {description && <p className="px-2 pb-1 text-[11px] leading-snug text-muted-foreground">{description}</p>}
      <div className="space-y-px">
        {head.map((o) => (
          <FacetControl key={o.value} type={type} name={name} option={o} idPrefix={idPrefix} />
        ))}
      </div>
      {tail.length > 0 && (
        <details className="group/more">
          <summary className="flex min-h-8 cursor-pointer list-none items-center rounded-md px-2 text-[12px] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="group-open/more:hidden">Show {tail.length} more</span>
            <span className="hidden group-open/more:inline">Show fewer</span>
          </summary>
          <div className="space-y-px">
            {tail.map((o) => (
              <FacetControl key={o.value} type={type} name={name} option={o} idPrefix={idPrefix} />
            ))}
          </div>
        </details>
      )}
    </fieldset>
  );
}
