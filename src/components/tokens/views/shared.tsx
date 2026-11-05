import type { GroupSlice } from "@/components/tokens/lib/grouping";
import { cn, formatCount } from "@/lib/utils";
import { linearChain, type EdgeMap, type ExplorerToken, type TokenIndexRow, type TokenSetInfo } from "@/server/queries/tokens";
import { ThemeChip } from "../explorer-chrome";

export interface ViewProps {
  groups: GroupSlice<TokenIndexRow>[];
  tokens: Map<string, ExplorerToken>;
  edges: EdgeMap;
  /** href that selects a token in the inspector (works without JS). */
  hrefFor: (id: string) => string;
  setById: Map<string, TokenSetInfo>;
  /** Sets shown together (show set labels on groups). */
  multiSet: boolean;
  /** Ordered set slugs (for theme columns). */
  setOrder: string[];
  /** Active theme filter (limits theme columns). */
  theme?: string;
  /** The selected set when a single set is shown. */
  singleSet?: TokenSetInfo;
}

/** Name relative to the group prefix ("md.sys.color.primary" in "md.sys.color" -> "primary"). */
export function relName(name: string, label: string): string {
  if (!label || label === "Other") return name;
  if (name.startsWith(`${label}.`)) return name.slice(label.length + 1);
  if (name.startsWith(`${label}-`) || name.startsWith(`${label}_`)) return name.slice(label.length + 1);
  return name;
}

export function GroupHeader({ g, set, multiSet, note }: { g: GroupSlice<TokenIndexRow>; set?: TokenSetInfo; multiSet: boolean; note?: React.ReactNode }) {
  const id = groupId(g);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3 id={id} className="min-w-0 font-mono text-[13px] font-medium break-all">
        {g.label === "Other" ? <span className="font-sans">Other tokens</span> : g.label}
      </h3>
      <span className="tabular text-xs text-muted-foreground">
        {formatCount(g.count)} token{g.count === 1 ? "" : "s"}
        {g.part ? ` · part ${g.part.index} of ${g.part.total}` : ""}
      </span>
      {multiSet && set && (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{set.name}</span>
          <ThemeChip theme={set.theme} />
        </span>
      )}
      {note}
    </div>
  );
}

export function groupId(g: GroupSlice<TokenIndexRow>) {
  return `g-${g.key.replace(/[^a-zA-Z0-9]+/g, "-")}${g.part ? `-${g.part.index}` : ""}`;
}

export function GroupSection({ g, children, className }: { g: GroupSlice<TokenIndexRow>; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={groupId(g)} className={cn("space-y-3", className)}>
      {children}
    </section>
  );
}

/** "→ base.color.neutral.13" chain text (names only), stopping at theme-dependent hops. */
export function chainLabel(t: ExplorerToken, edges: EdgeMap, maxHops = 3): string | null {
  const chain = linearChain(t.id, edges, maxHops);
  if (!chain.length) return t.refs.length > 1 ? `${t.refs.length} references` : null;
  return chain.map((e) => e.targetName ?? e.ref).join(" → ");
}

export function TokenAnchor({
  id,
  href,
  className,
  children,
  label,
  title,
}: {
  id: string;
  href: string;
  className?: string;
  children: React.ReactNode;
  label?: string;
  title?: string;
}) {
  return (
    <a href={href} data-inspect={id} aria-label={label} title={title} className={cn("outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
      {children}
    </a>
  );
}
