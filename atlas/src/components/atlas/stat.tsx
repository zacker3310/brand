import { cn, formatCount } from "@/lib/utils";

export function Stat({ value, label, hint, className }: { value: number | string; label: string; hint?: string; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <div className="tabular text-2xl font-semibold tracking-tight sm:text-3xl">{typeof value === "number" ? formatCount(value) : value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {hint && <div className="text-[11px] text-subtle-foreground">{hint}</div>}
    </div>
  );
}
