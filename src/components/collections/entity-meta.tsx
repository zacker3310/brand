import { BoxIcon, LibraryIcon, PaletteIcon, PuzzleIcon, ShapesIcon, SplitIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ENTITY_TYPE_LABELS, type EntityType } from "./schema";

export const ENTITY_ICON: Record<EntityType, typeof BoxIcon> = {
  system: LibraryIcon,
  component: BoxIcon,
  "component-type": ShapesIcon,
  token: PaletteIcon,
  pattern: PuzzleIcon,
  comparison: SplitIcon,
};

export function EntityTypeTag({ type, className, count }: { type: EntityType; className?: string; count?: number }) {
  const Icon = ENTITY_ICON[type];
  const label = count === undefined ? ENTITY_TYPE_LABELS[type].one : count === 1 ? ENTITY_TYPE_LABELS[type].one : ENTITY_TYPE_LABELS[type].many;
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-muted-foreground uppercase", className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {count !== undefined && <span className="tabular text-foreground">{count}</span>}
      {label}
    </span>
  );
}

/** "3 systems · 2 components" from per-type counts, in a stable order. */
export function typeCountsText(counts: Partial<Record<EntityType, number>>): string {
  const order: EntityType[] = ["system", "component", "component-type", "pattern", "token", "comparison"];
  return order
    .filter((t) => (counts[t] ?? 0) > 0)
    .map((t) => `${counts[t]} ${(counts[t] === 1 ? ENTITY_TYPE_LABELS[t].one : ENTITY_TYPE_LABELS[t].many).toLowerCase()}`)
    .join(" · ");
}
