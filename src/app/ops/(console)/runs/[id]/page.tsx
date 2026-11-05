import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/server/admin";
import { getRunDetail } from "@/server/queries/ops";
import { JobActions } from "@/components/ops/job-actions";
import { EmptyRow, Mono, OpsNotice, SectionTitle, ShortId, StatusPill, TableFrame, Time, formatDuration, one, qs, td, th } from "@/components/ops/ui";
import { cn, formatCount } from "@/lib/utils";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALIDATIONS = ["pending", "valid", "warning", "invalid", "conflict"];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `Run ${id.slice(0, 8)}` };
}

const STAGES = ["discover", "fetch", "parse", "publish"] as const;

export default async function RunDetailPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await requireAdminPage(`/ops/runs/${id}`);
  if (!UUID.test(id)) notFound();
  const vparam = one(sp.validation);
  const validation = vparam === "all" ? "all" : VALIDATIONS.includes(vparam ?? "") ? vparam! : "problems";
  const run = await getRunDetail(id, { validation });
  const validCount = run?.extractionSummary.filter((s) => s.validation === "valid").reduce((a, s) => a + s.n, 0) ?? 0;
  if (!run) notFound();
  const stageIdx = STAGES.indexOf((run.stage ?? "") as (typeof STAGES)[number]);
  const done = run.stage === "done" || run.status === "succeeded" || run.status === "partial";
  const statEntries = Object.entries(run.stats).filter(([, v]) => typeof v === "number") as [string, number][];
  const returnTo = `/ops/runs/${run.id}`;

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <Link href="/ops/runs" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-3" aria-hidden /> All runs
        </Link>
        <OpsNotice sp={sp} />
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="flex flex-wrap items-center gap-3 text-xl font-semibold tracking-tight">
              {run.systemName ?? "Unknown system"} <StatusPill status={run.status} />
            </h1>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <Mono>{run.id}</Mono>
              <span>{run.kind}</span>
              <span>triggered by {run.triggeredBy}</span>
              <Mono>
                {run.adapterId ?? "no adapter"}
                {run.adapterVersion ? `@${run.adapterVersion}` : ""}
              </Mono>
              {run.checkpoint.limit ? <span>limit {run.checkpoint.limit} documents</span> : null}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
            {[
              ["Created", <Time key="c" at={run.createdAt} />],
              ["Started", <Time key="s" at={run.startedAt} fallback="not started" />],
              ["Finished", <Time key="f" at={run.finishedAt} fallback="—" />],
              ["Duration", formatDuration(run.durationMs)],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="tabular font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </header>
      </div>

      <section aria-labelledby="stages-title">
        <SectionTitle id="stages-title" description="From the run checkpoint: per-document progress recorded by each stage.">
          Stages
        </SectionTitle>
        <ol className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((s, i) => {
            const state = done || i < stageIdx ? "done" : i === stageIdx ? (run.status === "failed" ? "failed" : "current") : "pending";
            return (
              <li key={s} className="space-y-2 bg-card p-4" aria-current={state === "current" ? "step" : undefined}>
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
                    {i + 1}. {s}
                  </p>
                  <span
                    className={cn(
                      "text-[11px]",
                      state === "done" && "text-verified",
                      state === "current" && "text-info",
                      state === "failed" && "text-conflicting",
                      state === "pending" && "text-muted-foreground",
                    )}
                  >
                    {state}
                  </span>
                </div>
                <div className="text-sm">
                  {s === "discover" &&
                    (run.checkpoint.discovered !== null ? (
                      <p>
                        <span className="tabular font-semibold">{formatCount(run.checkpoint.discovered)}</span> documents
                        {run.checkpoint.gone ? <span className="text-muted-foreground"> · {run.checkpoint.gone} gone</span> : null}
                      </p>
                    ) : (
                      <p className="text-muted-foreground">No checkpoint</p>
                    ))}
                  {(s === "fetch" || s === "parse") &&
                    (run.checkpoint[s].length ? (
                      <ul className="space-y-0.5">
                        {run.checkpoint[s].map((o) => (
                          <li key={o.outcome} className="flex justify-between gap-2 text-[13px]">
                            <span className={cn("text-muted-foreground", (o.outcome === "error" || o.outcome === "blocked") && "text-conflicting")}>{o.outcome}</span>
                            <span className="tabular font-mono text-xs">{formatCount(o.n)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">No documents recorded</p>
                    ))}
                  {s === "publish" &&
                    (run.checkpoint.publish ? (
                      <p>
                        System marked <StatusPill status={run.checkpoint.publish.ingestionStatus} />
                      </p>
                    ) : (
                      <p className="text-muted-foreground">Not published</p>
                    ))}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="stats-title">
        <SectionTitle id="stats-title" description="ingestion_run.stats as recorded by the engine.">
          Run statistics
        </SectionTitle>
        {statEntries.length ? (
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4 lg:grid-cols-6">
            {statEntries
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([k, v]) => (
                <div key={k} className="bg-card px-3 py-2.5">
                  <dt className="truncate font-mono text-[11px] text-muted-foreground">{k}</dt>
                  <dd className={cn("tabular text-sm font-medium", /error|quarantined|blocked/i.test(k) && v > 0 && "text-conflicting")}>{k === "durationMs" ? formatDuration(v) : formatCount(v)}</dd>
                </div>
              ))}
          </dl>
        ) : (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No statistics recorded yet.</p>
        )}
      </section>

      <section aria-labelledby="jobs-title">
        <SectionTitle id="jobs-title" count={run.jobs.length} description="Stage jobs for this run (ingestion_job).">
          Jobs
        </SectionTitle>
        <TableFrame label="Jobs for this run">
          <table className="w-full min-w-[720px] border-collapse">
            <thead className="border-b bg-surface-1">
              <tr>
                {["Job", "Kind", "Status", "Attempts", "Last error", "Finished", ""].map((h, i) => (
                  <th key={i} scope="col" className={th}>
                    {h || <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {run.jobs.length === 0 ? (
                <EmptyRow colSpan={7}>No jobs recorded for this run.</EmptyRow>
              ) : (
                run.jobs.map((j) => (
                  <tr key={j.id}>
                    <td className={td}>
                      <ShortId id={j.id} />
                    </td>
                    <td className={td}>
                      <Mono>{j.kind}</Mono>
                    </td>
                    <td className={td}>
                      <StatusPill status={j.status} />
                    </td>
                    <td className={`${td} tabular font-mono text-xs`}>
                      {j.attempts}/{j.maxAttempts}
                    </td>
                    <td className={`${td} max-w-md`}>{j.lastError ? <ErrorText text={j.lastError} /> : <span className="text-muted-foreground">—</span>}</td>
                    <td className={`${td} text-xs text-muted-foreground`}>
                      <Time at={j.finishedAt} fallback="—" />
                    </td>
                    <td className={`${td} text-right`}>
                      <JobActions jobId={j.id} status={j.status} returnTo={returnTo} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableFrame>
      </section>

      <section aria-labelledby="errors-title">
        <SectionTitle
          id="errors-title"
          count={run.errorTotal}
          description="ingestion_error rows recorded by this run."
          actions={
            run.system ? (
              <Link href={`/ops/errors${qs({ system: run.system, state: "all" })}`} className="text-xs font-medium text-muted-foreground hover:text-foreground">
                All errors for this system →
              </Link>
            ) : undefined
          }
        >
          Errors & warnings
        </SectionTitle>
        {run.errors.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">This run recorded no errors or warnings.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {run.errors.map((e) => (
              <li key={e.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:gap-4">
                <div className="flex items-center gap-2">
                  <StatusPill status={e.severity} />
                  <Mono className="text-muted-foreground">{e.stage}</Mono>
                </div>
                <div className="min-w-0 space-y-0.5">
                  <Mono className="font-medium">{e.code}</Mono>
                  <p className="text-[13px] break-words text-muted-foreground">{e.message}</p>
                  {e.url && <p className="truncate font-mono text-[11px] text-muted-foreground">{e.url}</p>}
                </div>
                <div className="text-xs text-muted-foreground">{e.resolvedAt ? "resolved" : <Time at={e.createdAt} />}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="extractions-title">
        <SectionTitle id="extractions-title" description="Normalized observations staged by this run, with validation results. Only valid and warning rows are published; “Needs review” hides valid rows.">
          Extractions
        </SectionTitle>
        {run.extractionSummary.length > 0 && (
          <nav aria-label="Filter extractions by validation" className="mb-3 flex flex-wrap gap-2">
            {(["problems", "all"] as const).map((v) => (
              <Link
                key={v}
                href={`/ops/runs/${run.id}${qs({ validation: v === "problems" ? undefined : v })}#extractions-title`}
                aria-current={validation === v ? "page" : undefined}
                className={cn("rounded-full border px-3 py-1 text-xs", validation === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
              >
                {v === "problems" ? "Needs review" : "All"}
              </Link>
            ))}
            {VALIDATIONS.filter((v) => run.extractionSummary.some((s) => s.validation === v)).map((v) => (
              <Link
                key={v}
                href={`/ops/runs/${run.id}${qs({ validation: v })}#extractions-title`}
                aria-current={validation === v ? "page" : undefined}
                className={cn("rounded-full border px-3 py-1 text-xs", validation === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
              >
                {v} <span className="tabular opacity-70">{run.extractionSummary.filter((s) => s.validation === v).reduce((a, s) => a + s.n, 0)}</span>
              </Link>
            ))}
          </nav>
        )}
        <div className="mb-4 flex flex-wrap gap-2">
          {run.extractionSummary.map((s) => (
            <span key={`${s.entityKind}-${s.validation}`} className="inline-flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-xs">
              <Mono>{s.entityKind}</Mono>
              <StatusPill status={s.validation} />
              <span className="tabular font-mono">{s.n}</span>
              <span className="text-muted-foreground">{s.published} published</span>
            </span>
          ))}
        </div>
        <TableFrame label="Extractions">
          <table className="w-full min-w-[720px] border-collapse">
            <thead className="border-b bg-surface-1">
              <tr>
                {["Kind", "Key", "Validation", "Published", "Issues"].map((h) => (
                  <th key={h} scope="col" className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {run.extractions.length === 0 ? (
                <EmptyRow colSpan={5}>
                  {validation === "problems" ? (
                    <>
                      No extraction needs review: all {formatCount(validCount)} passed validation.{" "}
                      <Link href={`/ops/runs/${run.id}?validation=all#extractions-title`} className="font-medium text-foreground hover:underline">
                        Show all
                      </Link>
                    </>
                  ) : (
                    <>No extractions{validation !== "all" ? ` with validation “${validation}”` : ""}.</>
                  )}
                </EmptyRow>
              ) : (
                run.extractions.map((x) => (
                  <tr key={x.id}>
                    <td className={td}>
                      <Mono className="text-muted-foreground">{x.entityKind}</Mono>
                    </td>
                    <td className={td}>
                      <Mono>{x.entityKey}</Mono>
                    </td>
                    <td className={td}>
                      <StatusPill status={x.validation} />
                    </td>
                    <td className={`${td} text-xs`}>{x.published ? "yes" : <span className="text-muted-foreground">no</span>}</td>
                    <td className={`${td} max-w-xl`}>
                      {x.issues.length ? (
                        <ul className="space-y-0.5">
                          {x.issues.slice(0, 4).map((i, k) => (
                            <li key={k} className="text-xs">
                              <Mono className={i.severity === "error" ? "text-conflicting" : "text-inferred"}>{i.code}</Mono> <span className="text-muted-foreground">{i.message}</span>
                              {i.path && <Mono className="text-muted-foreground"> @{i.path}</Mono>}
                            </li>
                          ))}
                          {x.issues.length > 4 && <li className="text-[11px] text-muted-foreground">+{x.issues.length - 4} more</li>}
                        </ul>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableFrame>
        {run.extractionTotal > run.extractions.length && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing the first {run.extractions.length} of {formatCount(run.extractionTotal)}.
          </p>
        )}
      </section>
    </div>
  );
}

function ErrorText({ text }: { text: string }) {
  const [first, ...rest] = text.split("\n");
  return (
    <details className="text-xs">
      <summary className="cursor-pointer truncate text-conflicting">{first}</summary>
      {rest.length > 0 && <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{rest.join("\n")}</pre>}
    </details>
  );
}
