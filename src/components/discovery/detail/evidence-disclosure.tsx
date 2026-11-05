import { ChevronDownIcon } from "lucide-react";
import { SourceLink, VERIFICATION_META } from "@/components/atlas";
import type { VerificationState } from "@/lib/contracts";
import { cn, hostname } from "@/lib/utils";
import type { FactEvidence } from "@/server/queries/systems";
import { formatDateTime, percent } from "../lib/format";

const RANK: Record<VerificationState, number> = { verified: 0, conflicting: 1, inferred: 2, unverified: 3, unavailable: 4 };

/** Strongest state across evidence rows: any verified row verifies the fact; conflicts surface next. */
export function aggregateState(rows: FactEvidence[]): VerificationState | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => RANK[a.state] - RANK[b.state])[0]!.state;
}

/**
 * Inline, keyboard-operable evidence for one fact (native <details>, no JS). The summary states the
 * aggregate verification state and number of sources; expanding lists each check with method,
 * retrieval time, excerpt and content hash.
 */
export function EvidenceDisclosure({ rows, className, emptyLabel = "No evidence row recorded" }: { rows: FactEvidence[]; className?: string; emptyLabel?: string }) {
  const state = aggregateState(rows);
  if (!state) return <span className={cn("text-[11px] text-subtle-foreground", className)}>{emptyLabel}</span>;
  const meta = VERIFICATION_META[state];
  const Icon = meta.icon;
  return (
    <details className={cn("group/ev", className)}>
      <summary
        className={cn(
          "inline-flex cursor-pointer list-none items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap select-none [&::-webkit-details-marker]:hidden",
          meta.className,
        )}
      >
        <Icon className="size-3" aria-hidden />
        {meta.label}
        <span className="font-normal opacity-75">
          · {rows.length} {rows.length === 1 ? "source" : "sources"}
        </span>
        <ChevronDownIcon className="size-3 transition-transform group-open/ev:rotate-180" aria-hidden />
      </summary>
      <ul className="mt-2 space-y-2 rounded-lg border bg-surface-1 p-2.5 text-xs">
        {rows.map((r) => (
          <li key={r.id} className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={cn("inline-flex items-center gap-1 font-medium", VERIFICATION_META[r.state].className, "border-0 bg-transparent p-0")}>
                {VERIFICATION_META[r.state].label}
              </span>
              <SourceLink href={r.sourceUrl} className="min-w-0 text-xs">
                <span className="break-all">{r.sourceTitle ?? (hostname(r.sourceUrl) ?? r.sourceUrl) + shortPath(r.sourceUrl)}</span>
              </SourceLink>
            </div>
            {r.excerpt && <p className="text-muted-foreground">“{r.excerpt}”</p>}
            <p className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-subtle-foreground">
              <span>{r.extractionMethod}</span>
              <time dateTime={r.retrievedAt}>{formatDateTime(r.retrievedAt)}</time>
              <span>conf. {percent(r.confidence)}</span>
              {r.contentHash && <span title={r.contentHash}>sha256:{r.contentHash.slice(0, 10)}</span>}
              {r.location && (
                <span className="max-w-full truncate" title={r.location}>
                  {r.location}
                </span>
              )}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

function shortPath(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/$/, "");
    return p.length > 1 ? (p.length > 48 ? `${p.slice(0, 46)}…` : p) : "";
  } catch {
    return "";
  }
}
