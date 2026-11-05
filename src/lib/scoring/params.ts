/**
 * URL state for comparison pages. URL search params are the source of truth so every view is
 * shareable and works without JavaScript (GET forms submit repeated `systems=a&systems=b`; the
 * enhanced UI writes `systems=a,b`). Pure; unit-tested.
 */
import { CRITERIA, type CriterionId } from "./types";

export const MIN_SYSTEMS = 2;
export const MAX_SYSTEMS = 5;

type Raw = string | string[] | undefined | null;
export type SearchParamsRecord = Record<string, string | string[] | undefined>;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isSlug = (s: string) => s.length <= 100 && SLUG_RE.test(s);

/** Comma- or repeat-separated list -> unique lowercase slugs, in first-seen order. */
export function parseSlugList(raw: Raw): string[] {
  const parts = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((v) => v.split(","));
  const out: string[] = [];
  for (const p of parts) {
    const s = p.trim().toLowerCase();
    if (s && isSlug(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

const first = (raw: Raw): string | null => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === undefined || v === null ? null : v;
};

/** `pick=carbon:button,github-primer:button` (or repeated) -> { carbon: "button", ... }. */
export function parsePicks(raw: Raw, allowedSystems?: readonly string[]): Record<string, string> {
  const parts = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((v) => v.split(","));
  const out: Record<string, string> = {};
  for (const p of parts) {
    const [sys, comp] = p.split(":").map((x) => x?.trim().toLowerCase() ?? "");
    if (!sys || !comp || !isSlug(sys) || !isSlug(comp)) continue;
    if (allowedSystems && !allowedSystems.includes(sys)) continue;
    if (!(sys in out)) out[sys] = comp;
  }
  return out;
}

const truthy = (raw: Raw) => {
  const v = first(raw);
  return v === "1" || v === "true" || v === "on" || v === "yes";
};

export interface ComponentCompareParams {
  type: string | null;
  systems: string[];
  /** Systems dropped because more than MAX_SYSTEMS were requested. */
  dropped: string[];
  picks: Record<string, string>;
  diffOnly: boolean;
  allProps: boolean;
  saved: string | null;
}

export function parseComponentCompareParams(sp: SearchParamsRecord): ComponentCompareParams {
  const typeRaw = first(sp.type)?.trim().toLowerCase() ?? "";
  const all = parseSlugList(sp.systems);
  const systems = all.slice(0, MAX_SYSTEMS);
  const savedRaw = first(sp.saved)?.trim() ?? "";
  return {
    type: typeRaw && isSlug(typeRaw) ? typeRaw : null,
    systems,
    dropped: all.slice(MAX_SYSTEMS),
    picks: parsePicks(sp.pick, systems),
    diffOnly: truthy(sp.diff),
    allProps: truthy(sp.props) || first(sp.props) === "all",
    saved: /^[A-Za-z0-9]{6,16}$/.test(savedRaw) ? savedRaw : null,
  };
}

export function parseCriteria(raw: Raw): CriterionId[] {
  const list = parseSlugList(raw).filter((c): c is CriterionId => (CRITERIA as readonly string[]).includes(c));
  // Preserve canonical rubric order regardless of URL order.
  return list.length ? CRITERIA.filter((c) => list.includes(c)) : [...CRITERIA];
}

export interface SystemCompareParams {
  systems: string[];
  dropped: string[];
  criteria: CriterionId[];
  saved: string | null;
}

export function parseSystemCompareParams(sp: SearchParamsRecord): SystemCompareParams {
  const all = parseSlugList(sp.systems);
  const savedRaw = first(sp.saved)?.trim() ?? "";
  return {
    systems: all.slice(0, MAX_SYSTEMS),
    dropped: all.slice(MAX_SYSTEMS),
    criteria: parseCriteria(sp.criteria),
    saved: /^[A-Za-z0-9]{6,16}$/.test(savedRaw) ? savedRaw : null,
  };
}

/** Canonical URL for a component comparison. Commas are kept readable in the query string. */
export function componentCompareHref(p: {
  type: string;
  systems: readonly string[];
  picks?: Record<string, string>;
  diffOnly?: boolean;
  allProps?: boolean;
  saved?: string | null;
}): string {
  const parts = [`type=${encodeURIComponent(p.type)}`, `systems=${p.systems.map(encodeURIComponent).join(",")}`];
  const picks = Object.entries(p.picks ?? {}).filter(([s]) => p.systems.includes(s));
  if (picks.length) parts.push(`pick=${picks.map(([s, c]) => `${encodeURIComponent(s)}:${encodeURIComponent(c)}`).join(",")}`);
  if (p.diffOnly) parts.push("diff=1");
  if (p.allProps) parts.push("props=all");
  if (p.saved) parts.push(`saved=${encodeURIComponent(p.saved)}`);
  return `/compare?${parts.join("&")}`;
}

export function systemCompareHref(p: { systems: readonly string[]; criteria?: readonly CriterionId[]; saved?: string | null }): string {
  const parts: string[] = [];
  if (p.systems.length) parts.push(`systems=${p.systems.map(encodeURIComponent).join(",")}`);
  const crit = p.criteria ?? [];
  if (crit.length && crit.length < CRITERIA.length) parts.push(`criteria=${crit.join(",")}`);
  if (p.saved) parts.push(`saved=${encodeURIComponent(p.saved)}`);
  return `/compare/systems${parts.length ? `?${parts.join("&")}` : ""}`;
}

/** Saved picks are stored in comparison.criteria as "pick:<system>=<component>" entries. */
export function encodeSavedPicks(picks: Record<string, string>): string[] {
  return Object.entries(picks).map(([s, c]) => `pick:${s}=${c}`);
}

export function decodeSavedCriteria(criteria: readonly string[] | null | undefined): { criteria: CriterionId[]; picks: Record<string, string> } {
  const picks: Record<string, string> = {};
  const crit: CriterionId[] = [];
  for (const c of criteria ?? []) {
    const m = /^pick:([a-z0-9-]+)=([a-z0-9-]+)$/.exec(c);
    if (m) picks[m[1]!] = m[2]!;
    else if ((CRITERIA as readonly string[]).includes(c)) crit.push(c as CriterionId);
  }
  return { criteria: crit, picks };
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Short URL-safe slug from random bytes (pass crypto.getRandomValues output). */
export function shortSlugFromBytes(bytes: Uint8Array, length = 8): string {
  let out = "";
  for (let i = 0; i < length; i++) out += BASE62[(bytes[i % bytes.length] ?? 0) % 62];
  return out;
}

export function defaultComparisonTitle(typeName: string | null, systemNames: readonly string[]): string {
  const names = systemNames.length > 3 ? `${systemNames.slice(0, 3).join(", ")} +${systemNames.length - 3}` : systemNames.join(" vs ");
  return (typeName ? `${typeName}: ${names}` : `Systems: ${names}`).slice(0, 140);
}
