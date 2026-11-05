/**
 * Natural ("human") ordering for token names: "neutral.2" < "neutral.10", "blue0" < "blue10".
 * Pure; used for display order only (never for semantic claims).
 */
const CHUNK = /(\d+(?:\.\d+)?|\D+)/g;

function chunks(s: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const m of s.matchAll(CHUNK)) {
    const c = m[0];
    out.push(/^\d/.test(c) ? Number(c) : c.toLowerCase());
  }
  return out;
}

const cache = new Map<string, (string | number)[]>();
function key(s: string) {
  let k = cache.get(s);
  if (!k) {
    k = chunks(s);
    if (cache.size > 20_000) cache.clear();
    cache.set(s, k);
  }
  return k;
}

/** Compare two strings with embedded numbers compared numerically. Stable tie-break on the raw string. */
export function naturalCompare(a: string, b: string): number {
  const ka = key(a);
  const kb = key(b);
  const n = Math.min(ka.length, kb.length);
  for (let i = 0; i < n; i++) {
    const x = ka[i]!;
    const y = kb[i]!;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  if (ka.length !== kb.length) return ka.length - kb.length;
  return a < b ? -1 : a > b ? 1 : 0;
}
