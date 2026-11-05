import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRightIcon, LayersIcon, PaletteIcon, SearchXIcon } from "lucide-react";
import { EmptyState, PageContainer, PageHeader, SourceLink } from "@/components/atlas";
import { Button } from "@/components/ui/button";
import { TOKEN_CATEGORIES, type TokenCategory } from "@/lib/contracts";
import { contrastPairs } from "@/lib/tokens/compare";
import { dimensionToPx, durationToMs } from "@/lib/tokens/format";
import { formatCount, hostname } from "@/lib/utils";
import {
  findTokenIdByName,
  getColorCandidates,
  getScopeStats,
  getSetSourceFiles,
  getThemeComparison,
  getTokenIndex,
  getTokenInspector,
  getTokenSystem,
  getTokensByIds,
  listTokenSets,
  listTokenSystems,
  type ExplorerToken,
  type TokenIndexRow,
  type TokenSetInfo,
} from "@/server/queries/tokens";
import { NativeSelect, NoJsSubmit } from "./controls";
import { AliasStats, CATEGORY_LABELS, CategoryTabs, formatDate, nav, Pagination, ScopeRail, ScopeSummary, Toolbar, type ExplorerModel } from "./explorer-chrome";
import { InspectorProvider } from "./inspector/context";
import { TokenInspector } from "./inspector/panel";
import { expandForContrast, manualContrast, resolveOperand } from "./lib/contrast";
import { groupTokens, pageRowIds, paginateGroups } from "./lib/grouping";
import { naturalCompare } from "./lib/natural";
import { explorerHref, parseExplorerParams } from "./lib/params";
import { opacityOf } from "./lib/values";
import { ColorView } from "./views/color-view";
import { ContrastView, themeLabelFor } from "./views/contrast-view";
import { ElevationView, LayoutView, MotionView, OpacityView, OtherView, ShapeView, SpacingView } from "./views/measure-views";
import type { ViewProps } from "./views/shared";
import { TableView } from "./views/table-view";
import { ThemeCompareView } from "./views/theme-compare-view";
import { TypographyView } from "./views/typography-view";

/** Tokens per page by category (visual views pack whole groups up to roughly this many tokens). */
const PAGE_SIZE: Record<TokenCategory, number> = {
  color: 240,
  typography: 80,
  spacing: 150,
  shape: 120,
  elevation: 80,
  motion: 60,
  layout: 120,
  opacity: 160,
  other: 150,
};
const TABLE_PAGE = 100;
const THEME_PAGE = 80;
const CONTRAST_PAGE = 50;

const VALUE_ORDER = new Set<TokenCategory>(["spacing", "shape", "opacity", "layout", "motion"]);

function sortValueOf(category: TokenCategory, text: string | null): number | null {
  if (!text) return null;
  if (category === "motion") return durationToMs(text);
  if (category === "opacity") return opacityOf(text);
  return dimensionToPx(text, { unitless: "null" });
}

type Raw = Record<string, string | string[] | undefined>;

export async function resolveExplorerTitle(raw: Raw): Promise<string> {
  const p = parseExplorerParams(raw);
  if (!p.system) return "Token explorer";
  const s = await getTokenSystem(p.system);
  return s ? `${s.name} tokens` : "Token explorer";
}

export async function TokenExplorer({ raw }: { raw: Raw }) {
  const params = parseExplorerParams(raw);
  const systems = await listTokenSystems();
  if (!systems.length) {
    return (
      <PageContainer>
        <PageHeader eyebrow="Token explorer" title="Design tokens" display />
        <EmptyState
          className="mt-8"
          icon={PaletteIcon}
          title="No token sets indexed yet"
          description="ATLAS shows tokens only after an adapter has extracted them from an official token package. Nothing is shown in their place."
        />
      </PageContainer>
    );
  }
  const slug = params.system ?? systems[0]!.slug;
  const system = await getTokenSystem(slug);
  if (!system) notFound();
  const sets = await listTokenSets(system.id);

  if (!sets.length) {
    return (
      <PageContainer>
        <PageHeader eyebrow="Token explorer" title={system.name} display description="No token sets have been extracted for this system." />
        <div className="mt-8 grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <Form action="/tokens" className="flex items-end gap-2">
            <NativeSelect name="system" label="Design system" defaultValue="" options={[{ value: "", label: "Choose a system…" }, ...systems.map((s) => ({ value: s.slug, label: `${s.name} · ${formatCount(s.tokenCount)}` }))]} className="flex-1" />
            <NoJsSubmit />
          </Form>
          <EmptyState
            icon={LayersIcon}
            title={`Tokens not extracted for ${system.name}`}
            description="ATLAS has not ingested a token package for this system. That is unknown, not empty: the system may well publish tokens."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href={`/systems/${encodeURIComponent(system.slug)}`}>System overview</Link>
              </Button>
            }
          />
        </div>
      </PageContainer>
    );
  }

  let selectedSet: TokenSetInfo | null = null;
  if (params.set) {
    selectedSet = sets.find((s) => s.slug === params.set) ?? null;
    if (!selectedSet) notFound();
  }
  const themes = [...new Set(sets.map((s) => s.theme).filter((t): t is string => !!t))];
  const theme = !selectedSet && params.theme && themes.includes(params.theme) ? params.theme : undefined;
  const scopeSets = selectedSet ? [selectedSet] : sets.filter((s) => !theme || !s.theme || s.theme === theme);
  const scope = { systemId: system.id, setIds: scopeSets.map((s) => s.id) };
  const stats = await getScopeStats(scope, { q: params.q || undefined, state: params.state });
  const category: TokenCategory =
    params.category ?? (stats.categories.color > 0 ? "color" : (TOKEN_CATEGORIES.find((c) => stats.categories[c] > 0) ?? "color"));
  const themedSets = sets.filter((s) => s.theme);
  let view = params.view;
  if (view === "themes" && (category !== "color" || themedSets.length < 2)) view = "visual";
  if (view === "contrast" && category !== "color") view = "visual";

  const effective = { ...params, system: system.slug, theme, category, view, set: selectedSet?.slug };
  const m: ExplorerModel = { params: effective, system, systems, sets, scopeSets, selectedSet, themes, themedSets, category, stats };
  const hrefFor = (id: string) => explorerHref(effective, { token: id });
  const setById = new Map(sets.map((s) => [s.id, s]));
  const setOrder = sets.map((s) => s.slug);
  const multiSet = !selectedSet && scopeSets.length > 1;

  const autoToken = !params.token && params.q ? await findTokenIdByName(scope, params.q) : null;
  const inspectId = params.token ?? autoToken;
  const initial = inspectId ? await getTokenInspector(inspectId) : null;
  const contrastHref = explorerHref({ ...effective, token: undefined, fg: undefined, bg: undefined }, { category: "color", view: "contrast" });

  const count = stats.categories[category];
  let content: React.ReactNode;
  let resultLabel = `${formatCount(count)} ${CATEGORY_LABELS[category].toLowerCase()} token${count === 1 ? "" : "s"}`;
  let pagination: React.ReactNode = null;

  if (view === "themes") {
    const light = themedSets.find((s) => s.theme === "light") ?? themedSets[0]!;
    const dark = themedSets.find((s) => s.theme === "dark" && s.id !== light.id) ?? themedSets.find((s) => s.id !== light.id)!;
    const a = themedSets.find((s) => s.slug === params.a) ?? light;
    const b = themedSets.find((s) => s.slug === params.b) ?? dark;
    const cmp = await getThemeComparison(system.id, a, b, { q: params.q || undefined, page: params.page, pageSize: THEME_PAGE });
    const pages = Math.max(1, Math.ceil(cmp.total / THEME_PAGE));
    resultLabel = `${formatCount(cmp.total)} comparable tokens`;
    content = <ThemeCompareView m={m} a={a} b={b} rows={cmp.rows} total={cmp.total} differing={cmp.differing} hrefFor={hrefFor} />;
    pagination = <Pagination m={m} page={Math.min(params.page, pages)} pages={pages} label={`${formatCount(cmp.total)} rows`} />;
  } else if (view === "contrast") {
    const cands = await getColorCandidates(scope);
    const entries = expandForContrast(cands);
    let pairs = contrastPairs(entries, { maxPairs: 5000 }).sort((x, y) => x.ratio - y.ratio || naturalCompare(x.fg, y.fg));
    const failingCount = pairs.filter((p) => !p.aa.normal).length;
    const total = pairs.length;
    if (params.failing) pairs = pairs.filter((p) => !p.aa.normal);
    const pages = Math.max(1, Math.ceil(pairs.length / CONTRAST_PAGE));
    const page = Math.min(params.page, pages);
    const fg = params.fg ? resolveOperand(params.fg, cands) : null;
    const bg = params.bg ? resolveOperand(params.bg, cands) : null;
    const manual = fg && bg ? manualContrast(fg, bg) : null;
    const setThemes = new Map(sets.map((s) => [s.slug, { name: s.name, theme: s.theme }]));
    resultLabel = `${formatCount(total)} pairs found`;
    content = (
      <ContrastView
        m={m}
        setLabel={themeLabelFor(setThemes)}
        pairs={pairs}
        totalPairs={total}
        failing={failingCount}
        page={page}
        pageSize={CONTRAST_PAGE}
        manual={manual}
        fg={fg}
        bg={bg}
        candidateCount={entries.length}
      />
    );
    pagination = <Pagination m={m} page={page} pages={pages} label={`${formatCount(pairs.length)} pairs`} />;
  } else {
    const index: TokenIndexRow[] = await getTokenIndex(scope, category, { q: params.q || undefined, state: params.state });
    const setRank = new Map(scopeSets.map((s, i) => [s.id, i]));
    if (view === "table") {
      index.sort((a, b) => (setRank.get(a.setId) ?? 0) - (setRank.get(b.setId) ?? 0) || naturalCompare(a.name, b.name));
      const pages = Math.max(1, Math.ceil(index.length / TABLE_PAGE));
      const page = Math.min(params.page, pages);
      const slice = index.slice((page - 1) * TABLE_PAGE, page * TABLE_PAGE);
      const [{ tokens }, files] = await Promise.all([getTokensByIds(slice.map((r) => r.id)), getSetSourceFiles([...new Set(slice.map((r) => r.setId))])]);
      const sourceFor = (t: ExplorerToken) => files.get(t.setId)?.get(t.location?.split("#")[0] ?? "") ?? setById.get(t.setId)?.sourceUrl ?? "#";
      resultLabel = index.length ? `${formatCount((page - 1) * TABLE_PAGE + 1)}–${formatCount((page - 1) * TABLE_PAGE + slice.length)} of ${formatCount(index.length)}` : "0 tokens";
      content = tokens.length ? <TableView tokens={tokens} hrefFor={hrefFor} setById={setById} sourceFor={sourceFor} /> : null;
      pagination = <Pagination m={m} page={page} pages={pages} label={`${formatCount(index.length)} tokens`} />;
    } else {
      if (VALUE_ORDER.has(category)) for (const r of index) r.sortValue = sortValueOf(category, r.valueText);
      const groups = groupTokens(index, {
        bySet: multiSet,
        ramps: category === "color",
        order: VALUE_ORDER.has(category) ? "value" : "name",
        setOrder: scopeSets.map((s) => s.id),
        maxDepth: category === "typography" ? 4 : 3,
      });
      const pages = paginateGroups(groups, PAGE_SIZE[category]);
      const page = Math.min(params.page, Math.max(1, pages.length));
      const slice = pages[page - 1] ?? [];
      const { tokens, edges } = await getTokensByIds(pageRowIds(slice));
      const vp: ViewProps = {
        groups: slice,
        tokens: new Map(tokens.map((t) => [t.id, t])),
        edges,
        hrefFor,
        setById,
        multiSet,
        setOrder,
        theme,
        singleSet: selectedSet ?? (scopeSets.length === 1 ? scopeSets[0] : undefined),
      };
      const shown = slice.reduce((a, g) => a + g.count, 0);
      if (pages.length > 1) resultLabel = `${formatCount(shown)} of ${formatCount(index.length)} on this page`;
      const View = { color: ColorView, typography: TypographyView, spacing: SpacingView, shape: ShapeView, elevation: ElevationView, motion: MotionView, layout: LayoutView, opacity: OpacityView, other: OtherView }[category];
      content = slice.length ? <View {...vp} /> : null;
      pagination = <Pagination m={m} page={page} pages={pages.length} label={`${formatCount(groups.length)} groups`} />;
    }
  }

  if (!content) content = <NoResults m={m} />;
  const retrieved = formatDate(sets.map((s) => s.retrievedAt).filter((x): x is string => !!x).sort().pop());

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Token explorer"
        title={system.name}
        display
        description={
          <>
            <span className="tabular">
              {formatCount(system.tokenCount)} tokens in {formatCount(sets.length)} set{sets.length === 1 ? "" : "s"}.
            </span>{" "}
            {system.docsUrl && (
              <>
                Data from{" "}
                <SourceLink href={system.docsUrl} className="text-[15px]">
                  {hostname(system.docsUrl)}
                </SourceLink>{" "}
                and its token packages{retrieved ? ` · retrieved ${retrieved}` : ""}.
              </>
            )}
          </>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/tokens/compare?systems=${encodeURIComponent(system.slug)}&category=spacing`}>Compare scales</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/systems/${encodeURIComponent(system.slug)}`}>
                System overview <ArrowUpRightIcon aria-hidden />
              </Link>
            </Button>
          </>
        }
      />
      <InspectorProvider defaultId={autoToken} className="mt-8 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] xl:data-[inspecting=true]:grid-cols-[15rem_minmax(0,1fr)_21rem]">
        <div className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          <ScopeRail m={m} />
        </div>
        <div className="min-w-0 space-y-6">
          <ScopeSummary m={m} />
          <CategoryTabs m={m} />
          <AliasStats m={m} />
          <Toolbar m={m} resultLabel={resultLabel} />
          <div id="token-results">{content}</div>
          {pagination}
        </div>
        <TokenInspector initial={initial} contrastHref={contrastHref} />
      </InspectorProvider>
    </PageContainer>
  );
}

function NoResults({ m }: { m: ExplorerModel }) {
  const label = CATEGORY_LABELS[m.category].toLowerCase();
  if (m.params.q || m.params.state) {
    return (
      <EmptyState
        icon={SearchXIcon}
        title={m.params.q ? `No ${label} tokens match “${m.params.q}”` : `No ${label} tokens in this alias state`}
        description="Search covers token names, CSS variables and resolved values in the current scope."
        action={
          <Button asChild size="sm" variant="outline">
            <Link href={nav(m, { q: "", state: undefined })}>Clear filters</Link>
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={LayersIcon}
      title={`No ${label} tokens in this scope`}
      description={`No ${label} tokens were extracted from ${m.selectedSet ? "this set" : "the sets in scope"}. Absence here is not evidence that ${m.system.name} has none; it may define them elsewhere.`}
    />
  );
}
