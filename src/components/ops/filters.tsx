import { FilterIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * GET filter form: the URL is the source of truth, so filtered views are shareable and work
 * without JavaScript. Native <select>/<input> keep it keyboard-friendly and light.
 */
export function FilterForm({ action, children, resetHref, active, className }: { action: string; children: React.ReactNode; resetHref: string; active: boolean; className?: string }) {
  return (
    <form action={action} method="get" role="search" aria-label="Filters" className={cn("flex flex-wrap items-end gap-3 rounded-xl border bg-surface-1 p-3", className)}>
      {children}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="secondary">
          <FilterIcon aria-hidden /> Apply
        </Button>
        {active && (
          <Link href={resetHref} className="text-xs text-muted-foreground hover:text-foreground">
            Reset
          </Link>
        )}
      </div>
    </form>
  );
}

const control =
  "h-8 rounded-md border border-input bg-background px-2.5 text-[13px] shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

export function FilterSelect({
  name,
  label,
  value,
  options,
  allLabel = "All",
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  const id = `f-${name}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      <select id={id} name={name} defaultValue={value ?? ""} className={cn(control, "max-w-56 pr-7")}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function FilterInput({ name, label, value, placeholder, className }: { name: string; label: string; value: string | undefined; placeholder?: string; className?: string }) {
  const id = `f-${name}`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className="text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      <input id={id} name={name} type="search" defaultValue={value ?? ""} placeholder={placeholder} maxLength={100} className={cn(control, "w-56 max-w-full")} />
    </div>
  );
}
