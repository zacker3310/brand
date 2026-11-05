import Link from "next/link";
import { requireAdminPage } from "@/server/admin";
import { NEAR_DUPLICATE_THRESHOLD, duplicateCandidates } from "@/server/queries/ops";
import { EmptyRow, Mono, SectionTitle, StatusPill, TableFrame, td, th } from "@/components/ops/ui";

export const metadata = { title: "Duplicate candidates" };

export default async function DuplicatesPage() {
  await requireAdminPage("/ops/duplicates");
  const d = await duplicateCandidates();
  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Duplicate candidates</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Registry entries resolved as duplicates, and pairs of published components within one system whose names are near-identical (pg_trgm similarity &gt; {NEAR_DUPLICATE_THRESHOLD}).
          Name similarity is a heuristic: review before merging; distinct components can share most of a name.
        </p>
      </header>

      <section aria-labelledby="reg-dup">
        <SectionTitle id="reg-dup" count={d.registry.length} description="Decided during registry research; the canonical entry is the one published.">
          Registry duplicates
        </SectionTitle>
        <ul className="divide-y rounded-xl border bg-card">
          {d.registry.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No registry duplicates recorded.</li>}
          {d.registry.map((e) => (
            <li key={e.slug} className="grid gap-1.5 px-4 py-3 md:grid-cols-[18rem_minmax(0,1fr)]">
              <div className="space-y-1">
                <p className="text-sm">
                  <span className="font-medium">{e.name}</span>
                  {e.duplicateOf && (
                    <>
                      {" "}
                      <span className="text-muted-foreground">→</span>{" "}
                      <Link href={`/systems/${e.duplicateOf.slug}`} className="font-medium hover:underline">
                        {e.duplicateOf.name ?? e.duplicateOf.slug}
                      </Link>
                    </>
                  )}
                </p>
                <StatusPill status={e.status} />
              </div>
              <p className="text-[13px] text-muted-foreground">{e.notes}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="comp-dup">
        <SectionTitle id="comp-dup" count={d.components.length} description="Same system, similar names. Computed live from published components.">
          Near-duplicate component names
        </SectionTitle>
        <TableFrame label="Near-duplicate component pairs">
          <table className="w-full min-w-[640px] border-collapse">
            <thead className="border-b bg-surface-1">
              <tr>
                {["System", "Component A", "Component B", "Similarity"].map((h) => (
                  <th key={h} scope="col" className={`${th} ${h === "Similarity" ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {d.components.length === 0 ? (
                <EmptyRow colSpan={4}>No pair of components in the same system has a name similarity above {NEAR_DUPLICATE_THRESHOLD}.</EmptyRow>
              ) : (
                d.components.map((c) => (
                  <tr key={`${c.system}-${c.a.slug}-${c.b.slug}`}>
                    <td className={td}>{c.systemName}</td>
                    <td className={td}>
                      <Link href={`/systems/${c.system}/components/${c.a.slug}`} className="hover:underline">
                        {c.a.name}
                      </Link>
                    </td>
                    <td className={td}>
                      <Link href={`/systems/${c.system}/components/${c.b.slug}`} className="hover:underline">
                        {c.b.name}
                      </Link>
                    </td>
                    <td className={`${td} text-right`}>
                      <Mono>{c.similarity.toFixed(2)}</Mono>
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
