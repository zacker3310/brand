"use client";

import { ChevronDownIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/**
 * Native <select> styled to match the kit. Native selects work without JavaScript inside GET forms and
 * give the best mobile UX. With JS, `autoSubmit` submits the enclosing form on change and hides the
 * fallback "Apply" button.
 */
export function NativeSelect({
  name,
  defaultValue,
  options,
  label,
  hideLabel = false,
  autoSubmit = true,
  className,
  selectClassName,
  id,
}: {
  name: string;
  defaultValue?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  label: string;
  hideLabel?: boolean;
  autoSubmit?: boolean;
  className?: string;
  selectClassName?: string;
  id?: string;
}) {
  const sid = id ?? `sel-${name}`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={sid} className={cn("type-eyebrow text-muted-foreground", hideLabel && "sr-only")}>
        {label}
      </label>
      <div className="relative min-w-0">
        <select
          id={sid}
          name={name}
          defaultValue={defaultValue}
          onChange={autoSubmit ? (e) => e.currentTarget.form?.requestSubmit() : undefined}
          className={cn(
            "h-9 w-full min-w-0 appearance-none truncate rounded-md border border-input bg-background pr-8 pl-3 text-sm shadow-xs transition-colors outline-none hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 dark:bg-input/30",
            selectClassName,
          )}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      </div>
    </div>
  );
}

/** Submit button shown only until hydration (selects auto-submit with JS). */
export function NoJsSubmit({ label = "Apply", className }: { label?: string; className?: string }) {
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (hydrated) return null;
  return (
    <button type="submit" className={cn("h-9 rounded-md border px-3 text-sm hover:bg-accent", className)}>
      {label}
    </button>
  );
}
