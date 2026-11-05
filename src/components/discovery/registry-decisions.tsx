import Link from "next/link";
import { ArrowRightIcon, CopyIcon, XCircleIcon } from "lucide-react";
import { SourceLink, SystemMark } from "@/components/atlas";
import type { RegistryDecision, RegistrySummary } from "@/server/queries/systems";
import { cn } from "@/lib/utils";
import { formatDate, plural } from "./lib/format";

const STATUS_META = {
  rejected: { label: "Rejected", icon: XCircleIcon, className: "border-conflicting/30 bg-conflicting-soft text-conflicting" },
  duplicate: { label: "Duplicate", icon: CopyIcon, className: "border-border bg-muted text-foreground" },
  replaced: { label: "Replaced", icon: ArrowRightIcon, className: "border-border bg-muted text-foreground" },
} as const;

function SystemRef({ slug, name, published }: { slug: string; name: string | null; published: boolean }) {
  if (!published) return <span className="font-mono text-xs">{name ?? slug}</span>;
  return (
    <Link href={`/systems/${slug}`} className="inline-flex items-center gap-1.5 font-medium hover:underline">
      <SystemMark name={name ?? slug} slug={slug} size="sm" className="size-5 text-[8px]" />
      {name ?? slug}
    </Link>
  );
}

/** Transparency about the 100: every candidate that did not make it, with the reason and its replacement. */
export function RegistryDecisions({ decisions, summary }: { decisions: RegistryDecision[]; summary: RegistrySummary }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        {[
          { n: summary.verified, label: "Verified and published", hint: `${summary.verifiedFromQueue} from the research queue + ${summary.replacements} replacements` },
          { n: summary.rejected, label: "Rejected", hint: "Inaccessible or unsuitable; kept with the reason" },
          { n: summary.duplicate, label: "Duplicates", hint: "Same system as another entry; points to the canonical one" },
          { n: summary.candidates, label: "Ranked queue candidates", hint: "Initial research list positions" },
        ].map((s) => (
          <div key={s.label} className="bg-card p-4">
            <div className="tabular text-2xl font-semibold tracking-tight">{s.n}</div>
            <div className="text-xs font-medium">{s.label}</div>
            <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.hint}</div>
          </div>
        ))}
      </div>

      {decisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rejected or duplicate registry entries are recorded.</p>
      ) : (
        <ol className="divide-y divide-border rounded-xl border bg-card">
          {decisions.map((d) => {
            const meta = STATUS_META[d.status as keyof typeof STATUS_META] ?? STATUS_META.rejected;
            const Icon = meta.icon;
            return (
              <li key={d.slug} className="grid grid-cols-1 gap-3 p-4 sm:p-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-6">
                <div className="space-y-2">
                  <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none font-medium", meta.className)}>
                    <Icon className="size-3" aria-hidden />
                    {meta.label}
                  </span>
                  <h3 className="text-[15px] leading-tight font-semibold tracking-tight">{d.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {d.organization ?? "Organization not recorded"}
                    {d.rank !== null && <span className="tabular"> · queue #{d.rank}</span>}
                  </p>
                  {d.homepageUrl && (
                    <SourceLink href={d.homepageUrl} className="text-xs">
                      Candidate URL
                    </SourceLink>
                  )}
                </div>
                <div className="min-w-0 space-y-3">
                  <p className="text-[13px] leading-relaxed text-foreground/90">{d.notes ?? "No reasoning recorded."}</p>
                  <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                    {d.duplicateOf && (
                      <div className="flex items-center gap-2">
                        <dt className="text-muted-foreground">Canonical entry</dt>
                        <dd>
                          <SystemRef {...d.duplicateOf} />
                        </dd>
                      </div>
                    )}
                    {d.replacedBy && (
                      <div className="flex items-center gap-2">
                        <dt className="text-muted-foreground">Replaced in the 100 by</dt>
                        <dd>
                          <SystemRef {...d.replacedBy} />
                        </dd>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <dt className="text-muted-foreground">Checks</dt>
                      <dd className="tabular">
                        {plural(d.checks.total, "check")}
                        {d.checks.failed > 0 && <span className="text-muted-foreground"> · {d.checks.failed} failed</span>}
                      </dd>
                    </div>
                    {d.verifiedAt && (
                      <div className="flex items-center gap-2">
                        <dt className="text-muted-foreground">Reviewed</dt>
                        <dd>
                          <time dateTime={d.verifiedAt}>{formatDate(d.verifiedAt)}</time>
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
