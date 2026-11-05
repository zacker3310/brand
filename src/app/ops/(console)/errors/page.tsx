import { ArrowLeftIcon, CheckIcon, ChevronRightIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { requireAdminPage } from "@/server/admin";
import { errorGroups, listErrors, systemOptions, type ErrorFilters } from "@/server/queries/ops";
import { Button } from "@/components/ui/button";
import { FilterForm, FilterInput, FilterSelect } from "@/components/ops/filters";
import { EmptyRow, Mono, OpsNotice, Pager, SectionTitle, ShortId, StatusPill, TableFrame, Time, one, pageParam, qs, stickyCell, td, th } from "@/components/ops/ui";
import { resolveErrorAction, resolveErrorGroupAction } from "@/app/ops/actions";

export const metadata = { title: "Extraction errors" };

const STAGES = ["discover", "fetch", "parse", "normalize", "validate", "publish", "run"];

export default async function ErrorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("/ops/errors");
  const sp = await searchParams;
  const state = (["open", "resolved", "all"] as const).find((s) => s === one(sp.state)) ?? "open";
  const f: ErrorFilters = { system: one(sp.system), stage: STAGES.includes(one(sp.stage) ?? "") ? one(sp.stage) : undefined, code: one(sp.code)?.slice(0, 80), state };
  const drill = !!(f.system && f.stage && f.code);
  const page = pageParam(sp.page);
  const [groups, systems, detail] = await Promise.all([errorGroups(f), systemOptions(), drill ? listErrors({ ...f, page, pageSize: 50 }) : Promise.resolve(null)]);
  const here = `/ops/errors${qs({ system: f.system, stage: f.stage, code: f.code, state: state === "open" ? undefined : state, page: page > 1 ? page : undefined })}`;
  const totalOpen = groups.reduce((a, g) => a + g.open, 0);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Extraction errors</h1>
        <p className="text-sm text-muted-foreground">
          ingestion_error grouped by system, stage and code. Resolving marks rows handled; it does not change data. A recurring error reappears on the next run.
        </p>
      </header>
      <OpsNotice sp={sp} />
      <FilterForm action="/ops/errors" resetHref="/ops/errors" active={!!(f.system || f.stage || f.code || state !== "open")}>
        <FilterSelect name="system" label="System" value={f.system} options={[{ value: "_none", label: "(no system)" }, ...systems.map((s) => ({ value: s.slug, label: s.name }))]} />
        <FilterSelect name="stage" label="Stage" value={f.stage} options={STAGES.map((s) => ({ value: s, label: s }))} />
        <FilterInput name="code" label="Code" value={f.code} placeholder="e.g. HTTP_404" className="[&_input]:w-40 [&_input]:font-mono" />
        <FilterSelect
          name="state"
          label="State"
          value={state === "open" ? undefined : state}
          allLabel="Open"
          options={[
            { value: "resolved", label: "Resolved" },
            { value: "all", label: "All" },
          ]}
        />
      </FilterForm>

      {drill && detail ? (
        <section aria-labelledby="drill-title" className="space-y-3">
          <Link href={`/ops/errors${qs({ state: state === "open" ? undefined : state })}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeftIcon className="size-3" aria-hidden /> All groups
          </Link>
          <SectionTitle
            id="drill-title"
            count={detail.total}
            description={
              <>
                <Mono>{f.system === "_none" ? "(no system)" : f.system}</Mono> · <Mono>{f.stage}</Mono> · <Mono>{f.code}</Mono>
              </>
            }
            actions={
              groups[0]?.open ? (
                <form action={resolveErrorGroupAction}>
                  <input type="hidden" name="system" value={f.system} />
                  <input type="hidden" name="stage" value={f.stage} />
                  <input type="hidden" name="code" value={f.code} />
                  <input type="hidden" name="returnTo" value={here} />
                  <Button type="submit" size="sm" variant="outline">
                    <CheckIcon aria-hidden /> Mark {groups[0].open} open resolved
                  </Button>
                </form>
              ) : undefined
            }
          >
            Occurrences
          </SectionTitle>
          <ul className="divide-y rounded-xl border bg-card">
            {detail.rows.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No occurrences match.</li>}
            {detail.rows.map((e) => (
              <li key={e.id} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={e.severity} />
                    {e.resolvedAt ? <span className="text-[11px] text-verified">resolved <Time at={e.resolvedAt} /></span> : <span className="text-[11px] text-muted-foreground">open</span>}
                    <span className="text-[11px] text-muted-foreground">
                      <Time at={e.createdAt} />
                    </span>
                    {e.runId && (
                      <span className="text-[11px] text-muted-foreground">
                        run <ShortId id={e.runId} href={`/ops/runs/${e.runId}`} />
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] break-words">{e.message}</p>
                  {e.url && <p className="truncate font-mono text-[11px] text-muted-foreground">{e.url}</p>}
                  {e.details && Object.keys(e.details).length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Details</summary>
                      <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(e.details, null, 2)}</pre>
                    </details>
                  )}
                </div>
                <form action={resolveErrorAction} className="self-start">
                  <input type="hidden" name="errorId" value={e.id} />
                  <input type="hidden" name="returnTo" value={here} />
                  {e.resolvedAt && <input type="hidden" name="reopen" value="1" />}
                  <Button type="submit" size="xs" variant="ghost" className="text-muted-foreground">
                    {e.resolvedAt ? <RotateCcwIcon aria-hidden /> : <CheckIcon aria-hidden />}
                    {e.resolvedAt ? "Reopen" : "Resolve"}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
          <Pager page={page} pageSize={50} total={detail.total} href={(p) => `/ops/errors${qs({ system: f.system, stage: f.stage, code: f.code, state: state === "open" ? undefined : state, page: p })}`} />
        </section>
      ) : (
        <section aria-labelledby="groups-title">
          <SectionTitle id="groups-title" count={groups.length} description={`${totalOpen} open occurrence${totalOpen === 1 ? "" : "s"} across these groups. Errors first, then by open count.`}>
            Error groups
          </SectionTitle>
          <TableFrame label="Error groups">
            <table className="w-full min-w-[900px] border-collapse">
              <thead className="border-b bg-surface-1">
                <tr>
                  <th scope="col" className={`${th} ${stickyCell} bg-surface-1`}>
                    Code
                  </th>
                  <th scope="col" className={th}>
                    System
                  </th>
                  <th scope="col" className={th}>
                    Stage
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Open
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Resolved
                  </th>
                  <th scope="col" className={th}>
                    Latest message
                  </th>
                  <th scope="col" className={th}>
                    Last seen
                  </th>
                  <th scope="col" className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {groups.length === 0 ? (
                  <EmptyRow colSpan={8}>{state === "open" ? "No open errors. Every recorded error has been resolved, or none were recorded." : "No errors match these filters."}</EmptyRow>
                ) : (
                  groups.map((g) => {
                    const sys = g.system ?? "_none";
                    const drillHref = `/ops/errors${qs({ system: sys, stage: g.stage, code: g.code, state: state === "open" ? undefined : state })}`;
                    return (
                      <tr key={`${sys}-${g.stage}-${g.code}-${g.severity}`} className="hover:bg-muted/40">
                        <td className={`${td} ${stickyCell}`}>
                          <Link href={drillHref} className="inline-flex items-center gap-1 font-mono text-[12px] font-medium hover:underline">
                            {g.code} <ChevronRightIcon className="size-3 text-muted-foreground" aria-hidden />
                          </Link>
                          <div className="mt-1">
                            <StatusPill status={g.severity} />
                          </div>
                        </td>
                        <td className={td}>{g.systemName ?? <span className="text-muted-foreground">(no system)</span>}</td>
                        <td className={td}>
                          <Mono className="text-muted-foreground">{g.stage}</Mono>
                        </td>
                        <td className={`${td} tabular text-right font-mono text-xs ${g.open ? (g.severity === "error" ? "text-conflicting" : "text-inferred") : "text-muted-foreground"}`}>{g.open}</td>
                        <td className={`${td} tabular text-right font-mono text-xs text-muted-foreground`}>{g.resolved}</td>
                        <td className={`${td} max-w-md`}>
                          <p className="line-clamp-2 text-xs text-muted-foreground">{g.sampleMessage}</p>
                        </td>
                        <td className={`${td} text-xs text-muted-foreground`}>
                          <Time at={g.lastSeen} />
                        </td>
                        <td className={`${td} text-right`}>
                          {g.open > 0 && (
                            <form action={resolveErrorGroupAction}>
                              <input type="hidden" name="system" value={sys} />
                              <input type="hidden" name="stage" value={g.stage} />
                              <input type="hidden" name="code" value={g.code} />
                              <input type="hidden" name="returnTo" value={here} />
                              <Button type="submit" size="xs" variant="outline">
                                <CheckIcon aria-hidden /> Resolve<span className="sr-only">{` ${g.open} open ${g.code} errors`}</span>
                              </Button>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </TableFrame>
        </section>
      )}
    </div>
  );
}
