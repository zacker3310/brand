import { PlayIcon } from "lucide-react";
import Link from "next/link";
import { requireAdminPage } from "@/server/admin";
import { SYSTEM_SORTS, opsSystems, type SystemSort } from "@/server/queries/ops";
import { SystemMark } from "@/components/atlas";
import { Button } from "@/components/ui/button";
import { FilterForm, FilterInput, FilterSelect } from "@/components/ops/filters";
import { EmptyRow, Mono, OpsNotice, StatusPill, TableFrame, Time, one, qs, stickyCell, td, th } from "@/components/ops/ui";
import { INGESTION_STATUSES } from "@/lib/contracts";
import { cn, formatCount } from "@/lib/utils";

export const metadata = { title: "Systems" };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default async function OpsSystemsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("/ops/systems");
  const sp = await searchParams;
  const q = one(sp.q)?.slice(0, 100);
  const status = (INGESTION_STATUSES as readonly string[]).includes(one(sp.status) ?? "") ? one(sp.status) : undefined;
  const sort: SystemSort = (SYSTEM_SORTS as readonly string[]).includes(one(sp.sort) ?? "") ? (one(sp.sort) as SystemSort) : "name";
  const registry = one(sp.registry) === "all" ? "all" : "verified";
  const rows = await opsSystems({ q, status, sort, registry });
  const returnTo = `/ops/systems${qs({ q, status, sort: sort === "name" ? undefined : sort, registry: registry === "all" ? "all" : undefined })}`;
  const sortHref = (s: SystemSort) => `/ops/systems${qs({ q, status, sort: s === "name" ? undefined : s, registry: registry === "all" ? "all" : undefined })}`;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Systems</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Per-system index depth from published records. “Enqueue run” only inserts a run and its job; a worker (npm run worker) does the work. Systems no adapter handles are
          refused with a notice and stay at metadata level.
        </p>
      </header>
      <OpsNotice sp={sp} />
      <FilterForm action="/ops/systems" resetHref="/ops/systems" active={!!(q || status || registry === "all" || sort !== "name")}>
        <FilterInput name="q" label="Search" value={q} placeholder="Name or slug" />
        <FilterSelect name="status" label="Ingestion status" value={status} options={INGESTION_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} />
        <FilterSelect name="registry" label="Registry" value={registry === "all" ? "all" : undefined} allLabel="Verified" options={[{ value: "all", label: "All entries" }]} />
        {sort !== "name" && <input type="hidden" name="sort" value={sort} />}
      </FilterForm>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {formatCount(rows.length)} system{rows.length === 1 ? "" : "s"} · {formatCount(rows.filter((r) => r.lastRun).length)} ingested at least once
      </p>
      <TableFrame label="Systems">
        <table className="w-full min-w-[1120px] border-collapse">
          <thead className="border-b bg-surface-1">
            <tr>
              <th scope="col" className={`${th} ${stickyCell} bg-surface-1`} aria-sort={sort === "name" ? "ascending" : undefined}>
                <Link href={sortHref("name")} className={cn("hover:text-foreground", sort === "name" && "text-foreground")}>
                  System{sort === "name" && <span aria-hidden> ↑</span>}
                </Link>
              </th>
              <SortHead sort={sort} href={sortHref} s="status">Ingestion</SortHead>
              <SortHead sort={sort} href={sortHref} s="components" right>
                Components
              </SortHead>
              <th scope="col" className={`${th} text-right`}>
                Coverage
              </th>
              <SortHead sort={sort} href={sortHref} s="tokens" right>
                Tokens
              </SortHead>
              <SortHead sort={sort} href={sortHref} s="patterns" right>
                Patterns
              </SortHead>
              <SortHead sort={sort} href={sortHref} s="evidence" right>
                Evidence
              </SortHead>
              <th scope="col" className={`${th} text-right`}>
                Errors
              </th>
              <SortHead sort={sort} href={sortHref} s="last-ingested">Last ingested</SortHead>
              <th scope="col" className={th}>
                Last run
              </th>
              <th scope="col" className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <EmptyRow colSpan={11}>No systems match these filters.</EmptyRow>
            ) : (
              rows.map((r) => {
                const adapter = r.adapterId;
                const ingested = !NOT_INGESTED.has(r.ingestionStatus);
                return (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className={`${td} ${stickyCell}`}>
                      <div className="flex items-center gap-2.5">
                        <SystemMark name={r.name} slug={r.slug} size="sm" />
                        <div className="min-w-0">
                          <Link href={`/systems/${r.slug}`} className="block max-w-48 truncate font-medium hover:underline">
                            {r.name}
                          </Link>
                          <Mono className="text-[11px] text-muted-foreground">{adapter ? `adapter: ${adapter}` : "not ingested yet"}</Mono>
                        </div>
                      </div>
                    </td>
                    <td className={td}>
                      <StatusPill status={r.ingestionStatus} />
                      {r.registryStatus !== "verified" && (
                        <div className="mt-1">
                          <StatusPill status={r.registryStatus} />
                        </div>
                      )}
                    </td>
                    <Num v={r.components} ingested={ingested} />
                    <td className={`${td} text-right text-[11px] whitespace-nowrap text-muted-foreground`}>
                      {r.components ? (
                        <span className="inline-flex gap-2 font-mono">
                          <abbr title={`${pct(r.componentsClassified, r.components)} classified into the ATLAS taxonomy`} className="no-underline">
                            T {pct(r.componentsClassified, r.components)}
                          </abbr>
                          <abbr title={`${pct(r.componentsWithProps, r.components)} with documented properties`} className="no-underline">
                            P {pct(r.componentsWithProps, r.components)}
                          </abbr>
                          <abbr title={`${pct(r.componentsWithA11y, r.components)} with accessibility data`} className="no-underline">
                            A {pct(r.componentsWithA11y, r.components)}
                          </abbr>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{ingested ? "none published" : "not extracted"}</span>
                      )}
                    </td>
                    <Num v={r.tokens} sub={r.tokenSets ? `${r.tokenSets} sets` : undefined} ingested={ingested} />
                    <Num v={r.patterns} ingested={ingested} />
                    <Num v={r.evidence} />
                    <td className={`${td} tabular text-right font-mono text-xs ${r.openErrors ? "text-[color-mix(in_oklch,var(--conflicting)_78%,var(--foreground))]" : "text-muted-foreground"}`}>
                      {r.openErrors ? (
                        <Link href={`/ops/errors?system=${r.slug}`} className="hover:underline">
                          {r.openErrors}
                        </Link>
                      ) : (
                        0
                      )}
                    </td>
                    <td className={`${td} text-xs`}>
                      <Time at={r.lastIngestedAt} />
                    </td>
                    <td className={`${td} text-xs`}>
                      {r.lastRun ? (
                        <Link href={`/ops/runs/${r.lastRun.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                          <StatusPill status={r.lastRun.status} /> <Time at={r.lastRun.createdAt} className="text-muted-foreground" />
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">no runs</span>
                      )}
                    </td>
                    <td className={`${td} text-right`}>
                      {r.registryStatus === "verified" ? (
                        <form method="post" action="/ops/enqueue">
                          <input type="hidden" name="system" value={r.slug} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <Button
                            type="submit"
                            size="xs"
                            variant="outline"
                          >
                            <PlayIcon aria-hidden /> Enqueue run<span className="sr-only">{` for ${r.name}`}</span>
                          </Button>
                        </form>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">not in registry</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}

function SortHead({ s, sort, href, children, right }: { s: SystemSort; sort: SystemSort; href: (s: SystemSort) => string; children: React.ReactNode; right?: boolean }) {
  const asc = s === "name" || s === "status";
  return (
    <th scope="col" className={cn(th, right && "text-right")} aria-sort={sort === s ? (asc ? "ascending" : "descending") : undefined}>
      <Link href={href(s)} className={cn("hover:text-foreground", sort === s && "text-foreground")}>
        {children}
        {sort === s && <span aria-hidden> {asc ? "↑" : "↓"}</span>}
      </Link>
    </th>
  );
}

/** Systems never deeply ingested have unknown (not zero) component/token/pattern counts. */
const NOT_INGESTED = new Set(["not_started", "queued", "metadata_only", "unsupported", "blocked"]);

function Num({ v, sub, ingested = true }: { v: number; sub?: string; ingested?: boolean }) {
  if (!v && !ingested)
    return (
      <td className={`${td} text-right text-xs text-muted-foreground`}>
        <span title="Not extracted: this system has not been deeply ingested" aria-label="not extracted">
          –
        </span>
      </td>
    );
  return (
    <td className={`${td} tabular text-right font-mono text-xs ${v ? "" : "text-muted-foreground"}`}>
      {formatCount(v)}
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </td>
  );
}
