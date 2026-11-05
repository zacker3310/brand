import { requireAdminPage } from "@/server/admin";
import { EVIDENCE_SUBJECTS, searchEvidence, systemOptions } from "@/server/queries/ops";
import { EvidenceList, VerificationBadge } from "@/components/atlas";
import { FilterForm, FilterInput, FilterSelect } from "@/components/ops/filters";
import { Mono, Pager, SectionTitle, one, pageParam, qs } from "@/components/ops/ui";
import { VERIFICATION_STATES, type VerificationState } from "@/lib/contracts";
import { formatCount } from "@/lib/utils";

export const metadata = { title: "Evidence inspector" };

export default async function EvidencePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("/ops/evidence");
  const sp = await searchParams;
  const system = one(sp.system);
  const subjectType = (EVIDENCE_SUBJECTS as readonly string[]).includes(one(sp.subject) ?? "") ? one(sp.subject) : undefined;
  const state = (VERIFICATION_STATES as readonly string[]).includes(one(sp.state) ?? "") ? one(sp.state) : undefined;
  const q = one(sp.q)?.slice(0, 100);
  const page = pageParam(sp.page);
  const pageSize = 30;
  const [res, systems] = await Promise.all([searchEvidence({ system, subjectType, state, q, page, pageSize }), systemOptions()]);
  const active = !!(system || subjectType || state || q);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Evidence inspector</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Search verification_evidence: every published claim links to rows like these, with source URL, retrieval time, content hash, extraction method and location.
        </p>
      </header>
      <FilterForm action="/ops/evidence" resetHref="/ops/evidence" active={active}>
        <FilterInput name="q" label="Subject, field, URL or method" value={q} placeholder="e.g. Button or adapter:primer" className="[&_input]:w-64" />
        <FilterSelect name="system" label="System" value={system} options={systems.map((s) => ({ value: s.slug, label: s.name }))} />
        <FilterSelect name="subject" label="Subject type" value={subjectType} options={EVIDENCE_SUBJECTS.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} />
        <FilterSelect name="state" label="State" value={state} options={VERIFICATION_STATES.map((s) => ({ value: s, label: s }))} />
      </FilterForm>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        <span className="tabular">
          {formatCount(res.total)} evidence row{res.total === 1 ? "" : "s"}
        </span>
        {Object.entries(res.byState).map(([s, n]) => (
          <span key={s} className="inline-flex items-center gap-1">
            <VerificationBadge state={s as VerificationState} /> <span className="tabular">{formatCount(n)}</span>
          </span>
        ))}
      </div>
      <section aria-labelledby="ev-title" className="space-y-3">
        <SectionTitle id="ev-title">Results</SectionTitle>
        {res.rows.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{active ? "No evidence matches these filters." : "No evidence recorded yet."}</p>
        ) : (
          <div className="space-y-5">
            {groupBySubject(res.rows).map((g) => (
              <div key={g.key} className="space-y-1.5">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{g.label ?? "Unknown subject"}</span>
                  <Mono className="text-[11px] text-muted-foreground">
                    {g.subjectType.replace(/_/g, " ")}
                    {g.system ? ` · ${g.system}` : ""}
                  </Mono>
                </p>
                <EvidenceList rows={g.rows} />
              </div>
            ))}
          </div>
        )}
        <Pager page={page} pageSize={pageSize} total={res.total} href={(p) => `/ops/evidence${qs({ q, system, subject: subjectType, state, page: p })}`} />
      </section>
    </div>
  );
}

function groupBySubject<T extends { subjectType: string; subjectId: string; subjectLabel: string | null; system: string | null }>(rows: T[]) {
  const out: { key: string; subjectType: string; label: string | null; system: string | null; rows: T[] }[] = [];
  for (const r of rows) {
    const key = `${r.subjectType}:${r.subjectId}`;
    const last = out[out.length - 1];
    if (last && last.key === key) last.rows.push(r);
    else out.push({ key, subjectType: r.subjectType, label: r.subjectLabel, system: r.system, rows: [r] });
  }
  return out;
}
