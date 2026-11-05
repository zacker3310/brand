import Link from "next/link";
import { requireAdminPage } from "@/server/admin";
import { quarantine, systemOptions } from "@/server/queries/ops";
import { FilterForm, FilterSelect } from "@/components/ops/filters";
import { EmptyRow, Mono, Pager, SectionTitle, ShortId, StatusPill, TableFrame, Time, one, pageParam, qs, stickyCell, td, th } from "@/components/ops/ui";
import { cn } from "@/lib/utils";

export const metadata = { title: "Quarantine" };

export default async function QuarantinePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("/ops/quarantine");
  const sp = await searchParams;
  const state = one(sp.state) === "warning" ? "warning" : "quarantined";
  const system = one(sp.system);
  const page = pageParam(sp.page);
  const pageSize = 50;
  const [q, systems] = await Promise.all([quarantine({ system, state, page, pageSize }), systemOptions()]);
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Quarantine</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Extractions whose latest observation failed validation (invalid) or disagrees with another source (conflict). They are never published; the previously published record, if any,
          stays live. Warnings are published with their issues attached.
        </p>
      </header>
      <nav aria-label="Validation state" className="flex gap-1">
        {(["quarantined", "warning"] as const).map((s) => (
          <Link
            key={s}
            href={`/ops/quarantine${qs({ state: s === "quarantined" ? undefined : s, system })}`}
            aria-current={state === s ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-xs", state === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
          >
            {s === "quarantined" ? "Quarantined (invalid / conflict)" : "Published with warnings"}
          </Link>
        ))}
      </nav>
      <FilterForm action="/ops/quarantine" resetHref={`/ops/quarantine${qs({ state: state === "warning" ? state : undefined })}`} active={!!system}>
        {state === "warning" && <input type="hidden" name="state" value="warning" />}
        <FilterSelect name="system" label="System" value={system} options={systems.map((s) => ({ value: s.slug, label: s.name }))} />
      </FilterForm>
      {q.bySystem.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Counts by system">
          {q.bySystem.map((b) => (
            <li key={b.system}>
              <Link href={`/ops/quarantine${qs({ state: state === "warning" ? state : undefined, system: b.system })}`} className="inline-flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-xs hover:border-foreground/20">
                <Mono>{b.system}</Mono> <span className="tabular font-mono text-muted-foreground">{b.n}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <section aria-labelledby="q-title">
        <SectionTitle id="q-title" count={q.total}>
          {state === "quarantined" ? "Quarantined extractions" : "Extractions with warnings"}
        </SectionTitle>
        <TableFrame label="Extractions">
          <table className="w-full min-w-[900px] border-collapse">
            <thead className="border-b bg-surface-1">
              <tr>
                <th scope="col" className={`${th} ${stickyCell} bg-surface-1`}>
                  Entity
                </th>
                <th scope="col" className={th}>
                  System
                </th>
                <th scope="col" className={th}>
                  Validation
                </th>
                <th scope="col" className={th}>
                  Validation issues
                </th>
                <th scope="col" className={th}>
                  Run
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {q.rows.length === 0 ? (
                <EmptyRow colSpan={5}>
                  {state === "quarantined"
                    ? "Nothing is quarantined: the latest extraction of every entity passed validation."
                    : "No published extraction carries warnings."}
                </EmptyRow>
              ) : (
                q.rows.map((x) => (
                  <tr key={x.id} className="align-top">
                    <td className={`${td} ${stickyCell}`}>
                      <Mono className="font-medium">{x.entityKey}</Mono>
                      <div className="text-[11px] text-muted-foreground">{x.entityKind}</div>
                    </td>
                    <td className={td}>{x.systemName}</td>
                    <td className={td}>
                      <StatusPill status={x.validation} />
                    </td>
                    <td className={`${td} max-w-xl`}>
                      {x.issues.length ? (
                        <ul className="space-y-1">
                          {x.issues.map((i, k) => (
                            <li key={k} className="text-xs">
                              <Mono className={i.severity === "error" ? "text-[color-mix(in_oklch,var(--conflicting)_78%,var(--foreground))]" : "text-[color-mix(in_oklch,var(--inferred)_62%,var(--foreground))]"}>{i.code}</Mono> <span className="text-foreground/85">{i.message}</span>
                              {i.path && <Mono className="text-muted-foreground"> at {i.path}</Mono>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-xs text-muted-foreground">No issue detail recorded</span>
                      )}
                    </td>
                    <td className={`${td} text-xs`}>
                      <ShortId id={x.runId} href={`/ops/runs/${x.runId}`} />
                      <div className="text-[11px] text-muted-foreground">
                        <Time at={x.runCreatedAt} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableFrame>
        <div className="mt-3">
          <Pager page={page} pageSize={pageSize} total={q.total} href={(p) => `/ops/quarantine${qs({ state: state === "warning" ? state : undefined, system, page: p })}`} />
        </div>
      </section>
    </div>
  );
}
