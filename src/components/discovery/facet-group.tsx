import { cn, formatCount } from "@/lib/utils";

export interface FacetGroupOption {
  value: string;
  label: string;
  count: number;
  selected: boolean;
  hint?: string;
}

/**
 * Checkbox facet inside a GET form. Counts are disjunctive (computed with every other facet
 * applied). Long lists show the first `visible` options and disclose the rest natively, so the
 * group works without JavaScript; a selected option in the overflow keeps the disclosure open.
 */
export function FacetGroup({
  name,
  title,
  options,
  visible = 7,
  description,
}: {
  name: string;
  title: string;
  options: FacetGroupOption[];
  visible?: number;
  description?: string;
}) {
  if (!options.length) return null;
  const head = options.slice(0, visible);
  const tail = options.slice(visible);
  const id = `facet-${name}`;
  return (
    <fieldset className="space-y-1.5" aria-describedby={description ? `${id}-desc` : undefined}>
      <legend className="mb-1.5 flex w-full items-center justify-between text-xs font-medium text-foreground">
        {title}
        {options.some((o) => o.selected) && (
          <span className="tabular rounded bg-accent px-1 text-[10px] font-medium text-accent-foreground">{options.filter((o) => o.selected).length}</span>
        )}
      </legend>
      {description && (
        <p id={`${id}-desc`} className="-mt-0.5 mb-1.5 text-[11px] leading-snug text-muted-foreground">
          {description}
        </p>
      )}
      <ul className="space-y-px">
        {head.map((o) => (
          <FacetOption key={o.value} name={name} option={o} />
        ))}
      </ul>
      {tail.length > 0 && (
        <details className="group/more" open={tail.some((o) => o.selected) || undefined}>
          <summary className="cursor-pointer list-none rounded px-1.5 py-1 text-xs text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="group-open/more:hidden">Show {tail.length} more</span>
            <span className="hidden group-open/more:inline">Show fewer</span>
          </summary>
          <ul className="space-y-px">
            {tail.map((o) => (
              <FacetOption key={o.value} name={name} option={o} />
            ))}
          </ul>
        </details>
      )}
    </fieldset>
  );
}

function FacetOption({ name, option: o }: { name: string; option: FacetGroupOption }) {
  const id = `f-${name}-${o.value}`;
  return (
    <li>
      <label
        htmlFor={id}
        title={o.hint}
        className={cn(
          "flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] transition-colors hover:bg-accent/60",
          o.count === 0 && !o.selected && "text-muted-foreground/70",
        )}
      >
        <input
          id={id}
          type="checkbox"
          name={name}
          value={o.value}
          defaultChecked={o.selected}
          className="size-3.5 shrink-0 rounded-[4px] border-input accent-primary"
        />
        <span className="min-w-0 flex-1 truncate">{o.label}</span>
        <span className="tabular text-[11px] text-muted-foreground">{formatCount(o.count)}</span>
      </label>
    </li>
  );
}
