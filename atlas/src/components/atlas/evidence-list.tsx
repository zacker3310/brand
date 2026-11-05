import { FileSearchIcon } from "lucide-react";
import type { VerificationState } from "@/lib/contracts";
import { relativeTime } from "@/lib/utils";
import { SourceLink } from "./source-link";
import { VerificationBadge } from "./verification-badge";

export interface EvidenceRow {
  id: string;
  field: string;
  sourceUrl: string;
  sourceTitle: string | null;
  retrievedAt: Date | string;
  contentHash: string | null;
  extractionMethod: string;
  location: string | null;
  excerpt: string | null;
  state: VerificationState;
  confidence: number;
}

/** Inspectable provenance: every published claim traces to rows like these. */
export function EvidenceList({ rows, emptyLabel = "No evidence recorded." }: { rows: EvidenceRow[]; emptyLabel?: string }) {
  if (rows.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <FileSearchIcon className="size-4" aria-hidden /> {emptyLabel}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-lg border">
      {rows.map((r) => (
        <li key={r.id} className="grid gap-1.5 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-muted-foreground">{r.field}</span>
              <VerificationBadge state={r.state} />
            </div>
            <SourceLink href={r.sourceUrl} className="max-w-full truncate">
              {r.sourceTitle ?? r.sourceUrl}
            </SourceLink>
            {r.excerpt && <p className="line-clamp-2 text-xs text-muted-foreground">“{r.excerpt}”</p>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground sm:text-right">
            <dt className="sm:hidden">Method</dt>
            <dd className="font-mono">{r.extractionMethod}</dd>
            <dt className="sm:hidden">Retrieved</dt>
            <dd>
              <time dateTime={new Date(r.retrievedAt).toISOString()}>{relativeTime(r.retrievedAt)}</time>
            </dd>
            {r.location && (
              <>
                <dt className="sm:hidden">Location</dt>
                <dd className="max-w-64 truncate font-mono" title={r.location}>
                  {r.location}
                </dd>
              </>
            )}
            {r.contentHash && (
              <>
                <dt className="sm:hidden">Hash</dt>
                <dd className="font-mono" title={r.contentHash}>
                  sha256:{r.contentHash.slice(0, 10)}
                </dd>
              </>
            )}
            <dt className="sm:hidden">Confidence</dt>
            <dd className="tabular">confidence {Math.round(r.confidence * 100)}%</dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}
