"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const OPS_SECTIONS = [
  { href: "/ops", label: "Overview" },
  { href: "/ops/systems", label: "Systems" },
  { href: "/ops/runs", label: "Runs" },
  { href: "/ops/queue", label: "Queue" },
  { href: "/ops/errors", label: "Errors" },
  { href: "/ops/quarantine", label: "Quarantine" },
  { href: "/ops/sources", label: "Sources" },
  { href: "/ops/registry", label: "Registry" },
  { href: "/ops/duplicates", label: "Duplicates" },
  { href: "/ops/evidence", label: "Evidence" },
] as const;

export function OpsNav({ counts }: { counts?: Partial<Record<string, number>> }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Operations" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 [scrollbar-width:none]">
      <ul className="flex min-w-max gap-0.5 border-b">
        {OPS_SECTIONS.map((s) => {
          const active = s.href === "/ops" ? pathname === "/ops" : pathname === s.href || pathname.startsWith(`${s.href}/`);
          const n = counts?.[s.href];
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-10 items-center gap-1.5 px-3 text-[13px] whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                  "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent",
                  active && "font-medium text-foreground after:bg-foreground",
                )}
              >
                {s.label}
                {n ? (
                  <span className="tabular rounded-full bg-conflicting-soft px-1.5 py-px font-mono text-[10px] leading-4 text-conflicting" aria-label={`${n} need attention`}>
                    {n}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
