/**
 * URL search-param helpers shared by discovery routes. Pure (unit-tested).
 * Next 16 hands pages a plain object (`Record<string, string | string[] | undefined>`); lists may
 * arrive repeated (`a=x&a=y`) or comma-separated (`a=x,y`). Both are accepted.
 */

export type RawSearchParams = Record<string, string | string[] | undefined>;

const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function first(sp: RawSearchParams, key: string): string | undefined {
  const v = sp[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

/** Repeated and/or comma-separated values, lowercased, de-duplicated, slug-validated, capped. */
export function slugList(sp: RawSearchParams, key: string, max = 25): string[] {
  const v = sp[key];
  const raw = (Array.isArray(v) ? v : v === undefined ? [] : [v]).flatMap((x) => x.split(","));
  const out: string[] = [];
  for (const r of raw) {
    const s = r.trim().toLowerCase();
    if (s && SLUG.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Like slugList, restricted to an allowed vocabulary. */
export function enumList<T extends string>(sp: RawSearchParams, key: string, allowed: readonly T[]): T[] {
  return slugList(sp, key).filter((s): s is T => (allowed as readonly string[]).includes(s));
}

export function enumOne<T extends string>(sp: RawSearchParams, key: string, allowed: readonly T[], fallback: T): T {
  const v = first(sp, key)?.trim().toLowerCase();
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function positiveInt(sp: RawSearchParams, key: string, fallback = 1, max = 10_000): number {
  const v = first(sp, key)?.trim();
  if (!v || !/^\d{1,6}$/.test(v)) return fallback;
  const n = Number(v);
  return n >= 1 ? Math.min(n, max) : fallback;
}

export function text(sp: RawSearchParams, key: string, maxLen = 200): string {
  return (first(sp, key) ?? "").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/** Convert Next's searchParams object to URLSearchParams (repeated keys preserved). */
export function toURLSearchParams(sp: RawSearchParams): URLSearchParams {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) u.append(k, x);
  }
  return u;
}

/** Build `path?query` from ordered entries, dropping empty values. Lists are comma-joined. */
export function buildHref(path: string, entries: [string, string | number | readonly string[] | null | undefined][]): string {
  const u = new URLSearchParams();
  for (const [k, v] of entries) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length) u.set(k, v.join(","));
    } else if (typeof v === "number") {
      u.set(k, String(v));
    } else if (typeof v === "string" && v !== "") {
      u.set(k, v);
    }
  }
  const qs = u.toString();
  return qs ? `${path}?${qs}` : path;
}

export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}
