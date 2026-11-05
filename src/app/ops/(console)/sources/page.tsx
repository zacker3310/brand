import { requireAdminPage } from "@/server/admin";
import { brokenLinks, sourceFreshness } from "@/server/queries/ops";
import { SourceLink } from "@/components/atlas";
import { EmptyRow, Meter, Mono, SectionTitle, StatusPill, TableFrame, Time, stickyCell, td, th } from "@/components/ops/ui";
import { formatCount } from "@/lib/utils";

export const metadata = { title: "Sources" };

export default async function SourcesPage() {
  await requireAdminPage("/ops/sources");
  const [fresh, broken] = await Promise.all([sourceFreshness(), brokenLinks()]);
  const docs = fresh.buckets.reduce((a, b) => a + b.n, 0);
  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Sources</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Freshness of fetched documents (source_document.last_fetched_at) and the health of registered source links (source.last_status). Documents are fetched only through
          PoliteFetcher, with conditional requests, so a recent fetch can be a 304.
        </p>
      </header>

      <section aria-labelledby="fresh-title" className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div>
          <SectionTitle id="fresh-title" count={docs} description="Documents by time since last fetch.">
            Freshness
          </SectionTitle>
          <ul className="space-y-2.5 rounded-xl border bg-card p-4">
            {fresh.buckets.map((b, i) => (
              <li key={b.label} className="grid grid-cols-[7rem_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
                <span className="text-muted-foreground">{b.label}</span>
                <Meter value={b.n} max={docs} tone={i === 0 ? "ok" : i >= 3 ? "warn" : "neutral"} label={`${b.label}: ${b.n}`} />
                <span className="tabular text-right font-mono text-xs">{formatCount(b.n)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            By status:{" "}
            {Object.entries(fresh.byStatus)
              .map(([s, n]) => `${s} ${formatCount(n)}`)
              .join(" · ") || "no documents"}
          </p>
        </div>
        <div>
          <SectionTitle description="Per system: oldest and newest fetch, documents not active.">By system</SectionTitle>
          <TableFrame label="Freshness by system">
            <table className="w-full min-w-[560px] border-collapse">
              <thead className="border-b bg-surface-1">
                <tr>
                  {["System", "Documents", "Oldest fetch", "Newest fetch", "Not active"].map((h, i) => (
                    <th key={h} scope="col" className={`${th} ${i === 0 ? `${stickyCell} bg-surface-1` : ""} ${i === 1 || i === 4 ? "text-right" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {fresh.bySystem.length === 0 ? (
                  <EmptyRow colSpan={5}>No documents have been discovered yet.</EmptyRow>
                ) : (
                  fresh.bySystem.map((s) => (
                    <tr key={s.system}>
                      <td className={`${td} ${stickyCell}`}>{s.systemName}</td>
                      <td className={`${td} tabular text-right font-mono text-xs`}>{formatCount(s.documents)}</td>
                      <td className={`${td} text-xs`}>
                        <Time at={s.oldest} />
                      </td>
                      <td className={`${td} text-xs`}>
                        <Time at={s.newest} />
                      </td>
                      <td className={`${td} tabular text-right font-mono text-xs ${s.notActive ? "text-inferred" : "text-muted-foreground"}`}>{s.notActive}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableFrame>
        </div>
      </section>

      <section aria-labelledby="docs-problems-title">
        <SectionTitle id="docs-problems-title" count={fresh.problemDocs.length} description="Documents marked gone, blocked (robots.txt or access control) or error, or last fetched with HTTP ≥ 400.">
          Gone, blocked and failing documents
        </SectionTitle>
        <TableFrame label="Problem documents">
          <table className="w-full min-w-[760px] border-collapse">
            <thead className="border-b bg-surface-1">
              <tr>
                {["Document", "System", "Kind", "Status", "HTTP", "Last fetched"].map((h, i) => (
                  <th key={h} scope="col" className={`${th} ${i === 0 ? `${stickyCell} bg-surface-1` : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {fresh.problemDocs.length === 0 ? (
                <EmptyRow colSpan={6}>Every discovered document is active and its last fetch succeeded.</EmptyRow>
              ) : (
                fresh.problemDocs.map((d) => (
                  <tr key={`${d.system}-${d.url}`}>
                    <td className={`${td} ${stickyCell} max-w-md`}>
                      <SourceLink href={d.url} className="max-w-full truncate text-xs">
                        {d.url.replace(/^https?:\/\//, "")}
                      </SourceLink>
                    </td>
                    <td className={td}>
                      <Mono>{d.system}</Mono>
                    </td>
                    <td className={td}>
                      <Mono className="text-muted-foreground">{d.docKind}</Mono>
                    </td>
                    <td className={td}>
                      <StatusPill status={d.status === "error" ? "failed" : d.status} label={d.status} />
                    </td>
                    <td className={`${td} tabular font-mono text-xs`}>{d.lastStatus ?? "—"}</td>
                    <td className={`${td} text-xs`}>
                      <Time at={d.lastFetchedAt} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableFrame>
      </section>

      <section aria-labelledby="broken">
        <SectionTitle
          id="broken"
          count={broken.rows.length}
          description={`Registered source links whose last check returned HTTP ≥ 400 or a network error. ${formatCount(broken.checked)} links checked, ${formatCount(broken.neverChecked)} never checked.`}
        >
          Broken links
        </SectionTitle>
        <TableFrame label="Broken source links">
          <table className="w-full min-w-[860px] border-collapse">
            <thead className="border-b bg-surface-1">
              <tr>
                {["Link", "System", "Kind", "HTTP", "Error", "Checked"].map((h, i) => (
                  <th key={h} scope="col" className={`${th} ${i === 0 ? `${stickyCell} bg-surface-1` : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {broken.rows.length === 0 ? (
                <EmptyRow colSpan={6}>No broken links at the last check.</EmptyRow>
              ) : (
                broken.rows.map((b) => (
                  <tr key={`${b.system}-${b.url}`} className="align-top">
                    <td className={`${td} ${stickyCell} max-w-sm`}>
                      <SourceLink href={b.url} className="max-w-full truncate text-xs">
                        {b.label ?? b.url.replace(/^https?:\/\//, "")}
                      </SourceLink>
                      <div className="text-[11px] text-muted-foreground">via {b.discoveredBy}</div>
                    </td>
                    <td className={td}>{b.systemName}</td>
                    <td className={td}>
                      <Mono className="text-muted-foreground">{b.kind}</Mono>
                    </td>
                    <td className={`${td} tabular font-mono text-xs ${b.lastStatus && b.lastStatus >= 400 ? "text-conflicting" : ""}`}>{b.lastStatus ?? "—"}</td>
                    <td className={`${td} max-w-xs text-xs text-muted-foreground`}>{b.lastError ?? "—"}</td>
                    <td className={`${td} text-xs`}>
                      <Time at={b.lastCheckedAt} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableFrame>
      </section>
    </div>
  );
}
