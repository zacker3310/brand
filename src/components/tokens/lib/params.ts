/**
 * URL state for the Token Explorer. Search params are the source of truth: every view is a shareable URL
 * and works without JavaScript (links and GET forms). Pure.
 */
import { TOKEN_CATEGORIES, type TokenCategory } from "@/lib/contracts";

export const EXPLORER_VIEWS = ["visual", "table", "themes", "contrast"] as const;
export type ExplorerView = (typeof EXPLORER_VIEWS)[number];

/** alias_state filter values; "literal" matches rows with a null/'literal' alias_state. */
export const ALIAS_STATES = ["literal", "resolved", "theme-dependent", "external", "unresolved", "cycle"] as const;
export type AliasStateFilter = (typeof ALIAS_STATES)[number];

export interface ExplorerParams {
  system?: string;
  set?: string;
  category?: TokenCategory;
  q: string;
  theme?: string;
  view: ExplorerView;
  page: number;
  token?: string;
  state?: AliasStateFilter;
  /** Theme comparison: two themed set slugs. */
  a?: string;
  b?: string;
  /** Contrast checker manual pair (token name or CSS color) and options. */
  fg?: string;
  bg?: string;
  failing?: boolean;
}

type Raw = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : undefined;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseExplorerParams(sp: Raw): ExplorerParams {
  const system = first(sp.system);
  const set = first(sp.set);
  const cat = first(sp.category);
  const view = first(sp.view);
  const page = Number(first(sp.page) ?? "1");
  const token = first(sp.token);
  const state = first(sp.state);
  const theme = first(sp.theme);
  const a = first(sp.a);
  const b = first(sp.b);
  return {
    system: system && SLUG.test(system) ? system : undefined,
    set: set && SLUG.test(set) ? set : undefined,
    category: cat && (TOKEN_CATEGORIES as readonly string[]).includes(cat) ? (cat as TokenCategory) : undefined,
    q: (first(sp.q) ?? "").slice(0, 200),
    theme: theme && theme.length <= 64 ? theme : undefined,
    view: view && (EXPLORER_VIEWS as readonly string[]).includes(view) ? (view as ExplorerView) : "visual",
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
    token: token && UUID.test(token) ? token.toLowerCase() : undefined,
    state: state && (ALIAS_STATES as readonly string[]).includes(state) ? (state as AliasStateFilter) : undefined,
    a: a && SLUG.test(a) ? a : undefined,
    b: b && SLUG.test(b) ? b : undefined,
    fg: first(sp.fg)?.slice(0, 200),
    bg: first(sp.bg)?.slice(0, 200),
    failing: first(sp.failing) === "1",
  };
}

const ORDER: (keyof ExplorerParams)[] = ["system", "set", "theme", "category", "view", "q", "state", "a", "b", "fg", "bg", "failing", "page", "token"];

/** Keys that reset pagination (and the selected token) when changed. */
const RESETS_PAGE = new Set<keyof ExplorerParams>(["system", "set", "theme", "category", "view", "q", "state", "a", "b", "failing"]);

/**
 * Build an explorer URL from the current params plus a patch. Changing a filter resets the page; changing
 * the system resets everything system-specific. `undefined` in the patch removes a key.
 */
export function explorerHref(current: ExplorerParams, patch: Partial<ExplorerParams>, base = "/tokens"): string {
  const next: Partial<ExplorerParams> = { ...current };
  const keys = Object.keys(patch) as (keyof ExplorerParams)[];
  if (keys.some((k) => RESETS_PAGE.has(k) && patch[k] !== current[k]) && !("page" in patch)) next.page = 1;
  if ("system" in patch && patch.system !== current.system) {
    for (const k of ["set", "theme", "token", "state", "a", "b", "fg", "bg", "q"] as const) delete next[k];
  }
  if ("set" in patch && patch.set !== current.set) {
    delete next.token;
    delete next.a;
    delete next.b;
  }
  Object.assign(next, patch);
  const usp = new URLSearchParams();
  for (const k of ORDER) {
    const v = next[k];
    if (v === undefined || v === null || v === "" || v === false) continue;
    if (k === "view" && v === "visual") continue;
    if (k === "page" && v === 1) continue;
    usp.set(k, v === true ? "1" : String(v));
  }
  const s = usp.toString();
  return s ? `${base}?${s}` : base;
}

export function isUuid(s: string | undefined | null): s is string {
  return !!s && UUID.test(s);
}

/** Escape LIKE wildcards in user input. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}
