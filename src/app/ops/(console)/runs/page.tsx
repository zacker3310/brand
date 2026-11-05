import { requireAdminPage } from "@/server/admin";
import { listRuns, systemOptions } from "@/server/queries/ops";
import { RunsTable } from "@/components/ops/runs-table";
import { FilterForm, FilterSelect } from "@/components/ops/filters";
import { Pager, one, pageParam, qs } from "@/components/ops/ui";

export const metadata = { title: "Runs" };

const RUN_STATUSES = ["pending", "running", "succeeded", "partial", "failed", "cancelled"];

export default async function RunsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("/ops/runs");
  const sp = await searchParams;
  const status = RUN_STATUSES.includes(one(sp.status) ?? "") ? one(sp.status) : undefined;
  const system = one(sp.system);
  const page = pageParam(sp.page);
  const pageSize = 25;
  const [runs, systems] = await Promise.all([listRuns({ status, system, page, pageSize }), systemOptions()]);
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Crawl progress</h1>
        <p className="text-sm text-muted-foreground">Every ingestion run with its current stage, headline stats and duration. Open a run for stage-level detail, errors and extractions.</p>
      </header>
      <FilterForm action="/ops/runs" resetHref="/ops/runs" active={!!(status || system)}>
        <FilterSelect name="status" label="Status" value={status} options={RUN_STATUSES.map((s) => ({ value: s, label: s }))} />
        <FilterSelect name="system" label="System" value={system} options={systems.map((s) => ({ value: s.slug, label: s.name }))} />
      </FilterForm>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {runs.total} run{runs.total === 1 ? "" : "s"}
        {status || system ? " match these filters" : ""}
      </p>
      <RunsTable rows={runs.rows} emptyText={status || system ? "No runs match these filters." : undefined} />
      <Pager page={page} pageSize={pageSize} total={runs.total} href={(p) => `/ops/runs${qs({ status, system, page: p })}`} />
    </div>
  );
}
