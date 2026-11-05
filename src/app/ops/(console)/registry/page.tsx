import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { requireAdminPage } from "@/server/admin";
import { STALE_VERIFICATION_DAYS, registryCoverage, type RegistryEntryRow } from "@/server/queries/ops";
import { SourceLink } from "@/components/atlas";
import { Meter, Mono, SectionTitle, StatusPill, Tile, Time } from "@/components/ops/ui";
import { formatCount } from "@/lib/utils";

export const metadata = { title: "Registry coverage" };

export default async function RegistryPage() {
  await requireAdminPage("/ops/registry");
  const r = await registryCoverage();
  const maxBucket = Math.max(1, ...r.confidence.map((c) => c.n));
  const verified = r.counts.verified ?? 0;
  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Registry coverage</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The researched registry: {formatCount(r.rankedCandidates)} ranked candidates were audited; entries that failed (no public documentation, duplicates) are kept with their reasons and
          replaced by distinct verified systems so the published registry stays at {formatCount(verified)}.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile label="Verified (published)" value={r.counts.verified ?? 0} tone="ok" />
        <Tile label="Rejected" value={r.counts.rejected ?? 0} hint="No public docs, discontinued…" />
        <Tile label="Duplicates" value={r.counts.duplicate ?? 0} hint="Same system as another entry" />
        <Tile label="Replacements" value={r.replacements.length} hint="Verified systems added in their place" />
        <Tile label="Ranked candidates audited" value={r.rankedCandidates} hint={r.counts.candidate ? `${r.counts.candidate} still in research` : "None left in research"} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="conf-title">
          <SectionTitle id="conf-title" description="Registry confidence of verified systems (0–1), from the verification checks.">
            Confidence distribution
          </SectionTitle>
          <ul className="space-y-2 rounded-xl border bg-card p-4">
            {r.confidence.map((c) => (
              <li key={c.bucket} className="grid grid-cols-[6rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm">
                <Mono className="text-muted-foreground">{c.bucket}</Mono>
                <Meter value={c.n} max={maxBucket} tone={c.bucket.startsWith("0.9") || c.bucket === "1.00" ? "ok" : c.bucket.startsWith("0.8") ? "neutral" : "warn"} label={`${c.bucket}: ${c.n}`} />
                <span className="tabular text-right font-mono text-xs">{c.n}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="low-title">
          <SectionTitle id="low-title" description="Verified entries with the lowest confidence: first candidates for re-verification.">
            Lowest confidence
          </SectionTitle>
          <ul className="divide-y rounded-xl border bg-card">
            {r.lowestConfidence.map((e) => (
              <li key={e.slug} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="truncate">{e.name}</span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  {e.failedChecks > 0 && <span className="text-inferred">{e.failedChecks} failed checks</span>}
                  <Mono>{e.confidence.toFixed(2)}</Mono>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="nv-title">
        <SectionTitle id="nv-title" count={r.notVerified.length} description="Rejected and duplicate entries, with the reason recorded during research and the system that replaced them.">
          Not verified
        </SectionTitle>
        <EntryList rows={r.notVerified} />
      </section>

      <section aria-labelledby="rep-title">
        <SectionTitle id="rep-title" count={r.replacements.length} description="Verified systems added to replace a rejected or duplicate candidate.">
          Replacements
        </SectionTitle>
        <ul className="grid gap-2 sm:grid-cols-2">
          {r.replacements.map((e) => (
            <li key={e.slug} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
              <span className="truncate text-muted-foreground line-through decoration-subtle-foreground/60">{e.replaces?.name ?? e.replaces?.slug}</span>
              <ArrowRightIcon className="size-3.5 shrink-0 text-subtle-foreground" aria-label="replaced by" />
              <span className="truncate font-medium">{e.name}</span>
              <Mono className="ml-auto shrink-0 text-xs text-muted-foreground">{e.confidence.toFixed(2)}</Mono>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="stale">
        <SectionTitle id="stale" count={r.stale.length} description={`Verified systems whose last verification is older than ${STALE_VERIFICATION_DAYS} days (or missing).`}>
          Stale verification
        </SectionTitle>
        {r.stale.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Every verified system was checked within the last {STALE_VERIFICATION_DAYS} days.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {r.stale.map((e) => (
              <li key={e.slug} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="truncate">{e.name}</span>
                <span className="text-xs text-muted-foreground">
                  verified <Time at={e.lastVerifiedAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Re-verify with <Mono>npx tsx scripts/registry/check.ts &lt;url&gt;</Mono>, then update data/registry and run <Mono>npm run db:seed</Mono>.
        </p>
      </section>
    </div>
  );
}

function EntryList({ rows }: { rows: RegistryEntryRow[] }) {
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {rows.map((e) => (
        <li key={e.slug} className="grid gap-2 px-4 py-3 md:grid-cols-[16rem_minmax(0,1fr)]">
          <div className="space-y-1">
            <p className="font-medium">{e.name}</p>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={e.status} />
              {e.rank !== null && <Mono className="text-[11px] text-subtle-foreground">rank #{e.rank}</Mono>}
            </div>
            {e.homepageUrl && (
              <SourceLink href={e.homepageUrl} className="text-xs text-muted-foreground">
                {e.homepageUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </SourceLink>
            )}
          </div>
          <div className="min-w-0 space-y-1.5 text-[13px]">
            <p className="text-foreground/85">{e.notes ?? <span className="text-subtle-foreground">No reason recorded.</span>}</p>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {e.duplicateOf && (
                <span>
                  duplicate of{" "}
                  <Link href={`/systems/${e.duplicateOf.slug}`} className="font-medium text-foreground hover:underline">
                    {e.duplicateOf.name ?? e.duplicateOf.slug}
                  </Link>
                </span>
              )}
              {e.replacedBy && (
                <span>
                  replaced by{" "}
                  <Link href={`/systems/${e.replacedBy.slug}`} className="font-medium text-foreground hover:underline">
                    {e.replacedBy.name ?? e.replacedBy.slug}
                  </Link>
                </span>
              )}
              <span>
                {e.checks} checks{e.failedChecks ? `, ${e.failedChecks} failed` : ""} · verified <Time at={e.lastVerifiedAt} />
              </span>
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
