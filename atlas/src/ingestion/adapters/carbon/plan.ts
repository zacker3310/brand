/**
 * Discovery planning for Carbon: which components exist (carbon-website nav + component index),
 * where their docs live, and which published implementation files back them.
 * Pure functions over already-fetched data so they can be unit tested.
 */
import { slugify } from "@/lib/utils";
import { normKey } from "./constants";
import type { ComponentIndexEntry, NavData } from "./docs";

export interface ReactTarget {
  folder: string;
  /** Package-relative file, e.g. "lib/components/Button/Button.js" */
  file: string;
  exports: string[];
}

export interface PlanItem {
  slug: string;
  name: string;
  kind: "page" | "child" | "standalone";
  /** carbon-website component folder (pages only), case preserved, e.g. "UI-shell-header". */
  docSlug: string | null;
  parentSlug: string | null;
  indexName: string | null;
  indexPointer: string | null;
  docsUrl: string | null;
  specUrl: string | null;
  codeUrl: string | null;
  a11yUrl: string | null;
  order: number;
  react: ReactTarget[];
  /** Explicit web-component tags for multi-element pages; null = resolve by folder/name. */
  wcTags: string[] | null;
  /** True for family pages whose implementations are modelled on child components. */
  family: boolean;
}

export interface PatternPlan {
  slug: string;
  name: string;
  patternSlug: string;
  docsUrl: string | null;
  file: string;
  order: number;
}

/**
 * Pages documenting several implementation exports, or family pages whose implementations
 * are separate child components. Each export is verified against the published package at
 * parse time (missing => property coverage "not-extracted").
 */
const REACT_OVERRIDES: Record<string, { folder: string; exports: string[] } | "family"> = {
  notification: { folder: "Notification", exports: ["InlineNotification", "ToastNotification", "ActionableNotification", "Callout"] },
  "ui-shell-header": { folder: "UIShell", exports: ["Header"] },
  "ui-shell-left-panel": { folder: "UIShell", exports: ["SideNav"] },
  "ui-shell-right-panel": { folder: "UIShell", exports: ["HeaderPanel"] },
  "menu-buttons": "family",
  list: "family",
};

const WC_OVERRIDES: Record<string, string[]> = {
  notification: ["cds-inline-notification", "cds-toast-notification", "cds-actionable-notification", "cds-callout-notification"],
  "ui-shell-header": ["cds-header"],
  "ui-shell-left-panel": ["cds-side-nav"],
  "ui-shell-right-panel": ["cds-header-panel"],
  "data-table": ["cds-table"],
};

/** Index of @carbon/react lib files: folder -> file base names (".js" files directly in the folder). */
export function reactFileIndex(files: string[]): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  for (const f of files) {
    const m = f.match(/^lib\/components\/([A-Za-z0-9]+)\/([A-Za-z0-9.]+)\.js$/);
    if (!m) continue;
    if (!idx.has(m[1]!)) idx.set(m[1]!, new Set());
    idx.get(m[1]!)!.add(m[2]!);
  }
  return idx;
}

function fileFor(idx: Map<string, Set<string>>, folder: string, exp: string): string | null {
  const files = idx.get(folder);
  if (!files) return null;
  for (const base of [exp, folder, "index"]) if (files.has(base)) return `lib/components/${folder}/${base}.js`;
  return null;
}

/** Resolve the React folder/export for a component name by normalized identity. */
export function resolveReact(idx: Map<string, Set<string>>, name: string): ReactTarget | null {
  const key = normKey(name);
  for (const folder of [...idx.keys()].sort()) {
    if (normKey(folder) !== key) continue;
    const file = fileFor(idx, folder, folder);
    if (file) return { folder, file, exports: [folder] };
  }
  // A file named after the component inside another folder (e.g. Tooltip/DefinitionTooltip.js).
  for (const [folder, files] of [...idx.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const base of [...files].sort()) {
      if (base === "index" || base.includes(".")) continue;
      if (normKey(base) === key) return { folder, file: `lib/components/${folder}/${base}.js`, exports: [base] };
    }
  }
  return null;
}

export interface PlanInputs {
  nav: NavData;
  index: ComponentIndexEntry[];
  reactFiles: string[];
  /** Live docs URLs known from the sitemap (lowercase compare). */
  sitemap: Set<string>;
  liveUrl: (docSlug: string, tab: string) => string;
  legacyUrl: (docSlug: string, tab: string) => string;
  limit?: number;
}

export function planComponents(inp: PlanInputs): PlanItem[] {
  const idx = reactFileIndex(inp.reactFiles);
  const pages = inp.limit ? inp.nav.components.slice(0, inp.limit) : inp.nav.components;
  const docUrl = (docSlug: string, tab: string) => {
    const live = inp.liveUrl(docSlug, tab);
    return inp.sitemap.size === 0 || inp.sitemap.has(live.toLowerCase()) ? live : inp.legacyUrl(docSlug, tab);
  };
  const items: PlanItem[] = [];
  const bySlug = new Map<string, PlanItem>();
  const indexByKey = new Map(inp.index.map((e) => [normKey(e.name), e]));
  pages.forEach((p, i) => {
    const slug = slugify(p.title);
    const override = REACT_OVERRIDES[slug];
    let react: ReactTarget[] = [];
    if (override && override !== "family") {
      const byFile = new Map<string, ReactTarget>();
      for (const exp of override.exports) {
        const file = fileFor(idx, override.folder, exp);
        if (!file) continue;
        const t = byFile.get(file) ?? { folder: override.folder, file, exports: [] };
        t.exports.push(exp);
        byFile.set(file, t);
      }
      react = [...byFile.values()];
    } else if (!override) {
      const r = resolveReact(idx, p.title);
      if (r) react = [r];
    }
    const ie = indexByKey.get(normKey(p.title));
    const item: PlanItem = {
      slug,
      name: p.title,
      kind: "page",
      docSlug: p.slug,
      parentSlug: null,
      indexName: ie?.name ?? null,
      indexPointer: ie?.pointer ?? null,
      docsUrl: docUrl(p.slug, "usage"),
      specUrl: docUrl(p.slug, "style"),
      codeUrl: docUrl(p.slug, "code"),
      a11yUrl: docUrl(p.slug, "accessibility"),
      order: i,
      react,
      wcTags: WC_OVERRIDES[slug] ?? null,
      family: override === "family",
    };
    items.push(item);
    bySlug.set(slug, item);
  });
  // Child components named in components.json with a parent page in scope.
  const pageByKey = new Map(items.map((it) => [normKey(it.name), it]));
  let order = items.length;
  for (const e of inp.index) {
    if (pageByKey.has(normKey(e.name))) continue;
    const parent = e.parent ? pageByKey.get(normKey(e.parent)) : undefined;
    const standalone = !e.parent && !e.overview;
    if (!parent && !(standalone && !inp.limit)) continue;
    const slug = slugify(e.name);
    if (!slug || bySlug.has(slug)) continue;
    const r = resolveReact(idx, e.name);
    const item: PlanItem = {
      slug,
      name: e.name,
      kind: parent ? "child" : "standalone",
      docSlug: null,
      parentSlug: parent?.slug ?? null,
      indexName: e.name,
      indexPointer: e.pointer,
      docsUrl: parent?.docsUrl ?? null,
      specUrl: parent?.specUrl ?? null,
      codeUrl: parent?.codeUrl ?? null,
      a11yUrl: parent?.a11yUrl ?? null,
      order: order++,
      react: r ? [r] : [],
      wcTags: null,
      family: false,
    };
    items.push(item);
    bySlug.set(slug, item);
  }
  return items;
}

/** Map nav pattern pages to live docs URLs via the sitemap (exact URL membership), else legacy URL. */
export function planPatterns(nav: NavData, sitemap: Set<string>, origin: string, legacyOrigin: string, limit?: number): PatternPlan[] {
  const pages = limit ? nav.patterns.slice(0, limit) : nav.patterns;
  return pages.map((p, i) => {
    const base = p.slug.replace(/-pattern$/, "");
    const candidates = [p.slug, base, `${base}s`].map((c) => `${origin}/building-blocks/core/patterns/${c}`);
    const live = candidates.find((c) => sitemap.has(c.toLowerCase())) ?? null;
    return {
      slug: slugify(p.title),
      name: p.title,
      patternSlug: p.slug,
      docsUrl: live ?? `${legacyOrigin}${p.path}`,
      file: `src/pages/patterns/${p.slug}/index.mdx`,
      order: i,
    };
  });
}
