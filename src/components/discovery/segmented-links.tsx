import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SegmentedLinkItem {
  href: string;
  label: string;
  active: boolean;
  icon?: LucideIcon;
  count?: number;
  /** Hide the text label visually (icon-only), keeping it for assistive tech. */
  iconOnly?: boolean;
}

/** Link-based segmented control: URL-driven views that work without JavaScript. */
export function SegmentedLinks({ items, label, className, size = "sm" }: { items: SegmentedLinkItem[]; label: string; className?: string; size?: "sm" | "md" }) {
  return (
    <nav aria-label={label} className={cn("inline-flex shrink-0 items-center rounded-lg border bg-surface-1 p-0.5", className)}>
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <Link
            key={it.href + it.label}
            href={it.href}
            scroll={false}
            aria-current={it.active ? "page" : undefined}
            title={it.iconOnly ? it.label : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
              it.active ? "bg-background text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className="size-3.5" aria-hidden />}
            <span className={cn(it.iconOnly && "sr-only")}>{it.label}</span>
            {it.count !== undefined && <span className="tabular text-[11px] text-muted-foreground">{it.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
