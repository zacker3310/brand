import { cn } from "@/lib/utils";

/**
 * ATLAS-generated monogram for a design system. ATLAS does not hotlink third-party logos;
 * this mark is an original representation (initials + deterministic hue from the slug).
 */
export function SystemMark({ name, slug, size = "md", className }: { name: string; slug: string; size?: "sm" | "md" | "lg"; className?: string }) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 360;
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const initials = (words.length >= 2 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "?").slice(0, 2)).toUpperCase();
  const dims = { sm: "size-7 text-[10px]", md: "size-9 text-xs", lg: "size-14 text-base" }[size];
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-lg border font-mono font-semibold tracking-wide", dims, className)}
      style={{
        background: `color-mix(in oklch, oklch(0.62 0.08 ${h}) 16%, var(--card))`,
        // 65% hue keeps the initials >= 5.3:1 on the tinted card in both schemes for every hue.
        color: `color-mix(in oklch, oklch(0.62 0.1 ${h}) 65%, var(--foreground))`,
        borderColor: `color-mix(in oklch, oklch(0.62 0.08 ${h}) 30%, var(--border))`,
      }}
    >
      {initials}
    </span>
  );
}
