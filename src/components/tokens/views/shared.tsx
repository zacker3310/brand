import { Fragment } from "react";
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

export function GroupHeader({ g, multiSet, note }: { g: GroupSlice<TokenIndexRow>; set?: TokenSetInfo; multiSet: boolean; note?: React.ReactNode }) {
  const id = groupId(g);
  const H = multiSet ? "h4" : "h3";
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <H id={id} className="min-w-0 font-mono text-[13px] font-medium break-all">
        {g.label === "Other" ? <span className="font-sans">Other tokens</span> : g.label}
      </H>
      <span className="tabular text-xs text-muted-foreground">
        {formatCount(g.count)} token{g.count === 1 ? "" : "s"}
        {g.part ? ` · part ${g.part.index} of ${g.part.total}` : ""}
      </span>
      {note}
    </div>
  );
}

/** Band introducing a token set when several sets are listed together. */
export function SetBand({ set }: { set: TokenSetInfo | undefined }) {
  if (!set) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-surface-2 px-3 py-2">
      <h3 className="text-[13px] font-medium">{set.name}</h3>
      <ThemeChip theme={set.theme} />
      <span className="tabular ml-auto font-mono text-[11px] text-muted-foreground">
        {set.slug} · {formatCount(set.tokenCount)} tokens
      </span>
    </div>
  );
}

/** Renders groups in order, inserting a set band whenever the set changes (multi-set scope). */
export function GroupList({ p, render, header }: { p: ViewProps; render: (g: GroupSlice<TokenIndexRow>) => React.ReactNode; header?: React.ReactNode }) {
  const out: React.ReactNode[] = [];
  let last: string | null | undefined;
  for (const g of p.groups) {
    if (p.multiSet && g.setId !== last) {
      out.push(<SetBand key={`set-${g.setId}`} set={g.setId ? p.setById.get(g.setId) : undefined} />);
      last = g.setId;
    }
    out.push(<Fragment key={`${g.key}-${g.part?.index ?? 0}`}>{render(g)}</Fragment>);
  }
  return (
    <div className="space-y-10">
      {header}
      {out}
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
