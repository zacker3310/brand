/**
 * Display grouping for the Token Explorer (pure).
 *
 *  - Tokens are grouped by path prefix (at most 3 segments; single-segment kebab names use their first word),
 *    per token set when several sets are shown together.
 *  - Tiny groups are coarsened into their parent prefix; remaining singletons collect in "Other".
 *  - In color groups, families of numbered literal/resolved tokens ("blue.0..9", "blue0..100", "10Hover..")
 *    are detected as ramps. Theme-dependent tokens form a matrix (one column per themed set).
 *  - Pagination packs whole groups into pages of ~pageSize tokens; oversized groups are split into slices.
 *
 * This is presentation logic only: a ramp or group is a layout decision, not a claim about the source.
 */
import { naturalCompare } from "./natural";

export interface IndexRow {
  id: string;
  name: string;
  path: string[];
  setId: string;
  aliasState: string | null;
  /** Optional numeric key for value ordering (e.g. px). */
  sortValue?: number | null;
}

export interface RampStep<R extends IndexRow = IndexRow> {
  row: R;
  step: number;
  stepLabel: string;
}

export interface Ramp<R extends IndexRow = IndexRow> {
  family: string;
  label: string;
  steps: RampStep<R>[];
}

export interface TokenGroup<R extends IndexRow = IndexRow> {
  key: string;
  /** Path prefix shown as the group heading ("base.color.blue"), or "Other". */
  label: string;
  setId: string | null;
  count: number;
  ramps: Ramp<R>[];
  themed: R[];
  list: R[];
}

export interface GroupOptions {
  /** Group separately per token set (multi-set view). */
  bySet?: boolean;
  /** Detect color ramps. */
  ramps?: boolean;
  /** Order inside list sections. */
  order?: "name" | "value";
  /** Order of sets (multi-set view); unknown sets sort last. */
  setOrder?: string[];
  /** Max prefix depth (default 3). */
  maxDepth?: number;
}

const MIN_GROUP = 2;

/** Prefix used for grouping a token. */
export function groupPrefix(path: readonly string[], name: string, maxDepth = 3): string[] {
  const p = path.length ? path : name.split(".");
  if (p.length >= 2) return p.slice(0, Math.min(p.length - 1, maxDepth));
  const seg = p[0] ?? name;
  const first = seg.split(/[-_]/)[0] ?? seg;
  return first ? [first] : [];
}

/** Remainder of a token's path after its group prefix (single-segment kebab names are split on the first word). */
export function remainderAfter(prefix: readonly string[], path: readonly string[], name: string): string[] {
  const p = path.length ? path : name.split(".");
  if (p.length >= 2) return p.slice(prefix.length);
  const seg = p[0] ?? name;
  const first = prefix[0];
  if (first && seg.startsWith(first) && seg.length > first.length) return [seg.slice(first.length).replace(/^[-_]+/, "")];
  return [seg];
}

const STEP_RE = /^(.*?)(\d+(?:\.\d+)?)([A-Za-z][A-Za-z-]*)?$/;

/** "blue0" -> {family:"blue", step:0}; "100Hover" -> {family:"", step:100, suffix:"Hover"}; "5" -> {family:"", step:5}. */
export function parseStep(seg: string): { family: string; step: number; raw: string; suffix: string } | null {
  const m = STEP_RE.exec(seg);
  if (!m) return null;
  const step = Number(m[2]);
  if (!Number.isFinite(step)) return null;
  return { family: (m[1] ?? "").replace(/[-_.]+$/, ""), step, raw: m[2]!, suffix: m[3] ?? "" };
}

function byNameOrValue<R extends IndexRow>(order: "name" | "value") {
  return (a: R, b: R) => {
    if (order === "value") {
      const av = a.sortValue ?? null;
      const bv = b.sortValue ?? null;
      if (av !== null && bv !== null && av !== bv) return av - bv;
      if (av === null && bv !== null) return 1;
      if (av !== null && bv === null) return -1;
    }
    return naturalCompare(a.name, b.name);
  };
}

export function groupTokens<R extends IndexRow>(rows: readonly R[], opts: GroupOptions = {}): TokenGroup<R>[] {
  const maxDepth = opts.maxDepth ?? 3;
  const order = opts.order ?? "name";
  const setRank = new Map((opts.setOrder ?? []).map((s, i) => [s, i]));

  // 1) initial prefix per row
  const keyed = rows.map((row) => ({ row, prefix: groupPrefix(row.path, row.name, maxDepth) }));
  const setPart = (r: R) => (opts.bySet ? r.setId : "");
  const k = (set: string, prefix: string[]) => `${set}::${prefix.join(".")}`;

  // 2) coarsen tiny groups into their parent prefix until stable
  for (let pass = 0; pass < maxDepth; pass++) {
    const counts = new Map<string, number>();
    for (const e of keyed) counts.set(k(setPart(e.row), e.prefix), (counts.get(k(setPart(e.row), e.prefix)) ?? 0) + 1);
    let changed = false;
    for (const e of keyed) {
      if (e.prefix.length >= 2 && (counts.get(k(setPart(e.row), e.prefix)) ?? 0) < MIN_GROUP) {
        e.prefix = e.prefix.slice(0, -1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // 3) bucket
  const buckets = new Map<string, { set: string; prefix: string[]; rows: R[] }>();
  for (const e of keyed) {
    const key = k(setPart(e.row), e.prefix);
    const b = buckets.get(key) ?? { set: setPart(e.row), prefix: e.prefix, rows: [] };
    b.rows.push(e.row);
    buckets.set(key, b);
  }
  // singletons -> "Other" (per set)
  const other = new Map<string, R[]>();
  for (const [key, b] of [...buckets]) {
    if (b.rows.length < MIN_GROUP) {
      buckets.delete(key);
      const o = other.get(b.set) ?? [];
      o.push(...b.rows);
      other.set(b.set, o);
    }
  }

  const groups: TokenGroup<R>[] = [];
  for (const [key, b] of buckets) groups.push(buildGroup(key, b.prefix.join(".") || "Other", b.set || null, b.prefix, b.rows, opts.ramps ?? false, order));
  for (const [set, rs] of other) groups.push(buildGroup(`${set}::~other`, "Other", set || null, [], rs, false, order));

  const isOther = (g: TokenGroup<R>) => g.key.endsWith("::~other");
  return groups.sort((a, b) => {
    if (opts.bySet) {
      const ra = setRank.get(a.setId ?? "") ?? Number.MAX_SAFE_INTEGER;
      const rb = setRank.get(b.setId ?? "") ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      if ((a.setId ?? "") !== (b.setId ?? "")) return (a.setId ?? "") < (b.setId ?? "") ? -1 : 1;
    }
    if (isOther(a) !== isOther(b)) return isOther(a) ? 1 : -1;
    return naturalCompare(a.label, b.label);
  });
}

function buildGroup<R extends IndexRow>(
  key: string,
  label: string,
  setId: string | null,
  prefix: string[],
  rows: R[],
  detectRamps: boolean,
  order: "name" | "value",
): TokenGroup<R> {
  const themed: R[] = [];
  const rest: R[] = [];
  for (const r of rows) (r.aliasState === "theme-dependent" ? themed : rest).push(r);
  const ramps: Ramp<R>[] = [];
  let list = rest;
  if (detectRamps && prefix.length) {
    const fam = new Map<string, RampStep<R>[]>();
    const left: R[] = [];
    for (const r of rest) {
      const ok = r.aliasState === null || r.aliasState === "literal" || r.aliasState === "resolved";
      const rem = remainderAfter(prefix, r.path, r.name);
      const last = rem[rem.length - 1];
      const ps = ok && last ? parseStep(last) : null;
      if (!ps) {
        left.push(r);
        continue;
      }
      const family = [...rem.slice(0, -1), ps.family].filter(Boolean).join(".");
      const famKey = `${family}\u0000${ps.suffix}`;
      const arr = fam.get(famKey) ?? [];
      arr.push({ row: r, step: ps.step, stepLabel: ps.raw });
      fam.set(famKey, arr);
    }
    const base = label.split(".").pop() || label;
    const order: { ramp: Ramp<R>; family: string; suffix: string }[] = [];
    for (const [famKey, steps] of fam) {
      const distinct = new Set(steps.map((s) => s.step)).size;
      if (steps.length >= 3 && distinct === steps.length) {
        const [family, suffix] = famKey.split("\u0000") as [string, string];
        const famLabel = [family || base, suffix].filter(Boolean).join(" · ");
        order.push({ ramp: { family: famKey, label: famLabel, steps: steps.sort((a, b) => a.step - b.step) }, family, suffix });
      } else {
        left.push(...steps.map((s) => s.row));
      }
    }
    order.sort((a, b) => naturalCompare(a.family, b.family) || (a.suffix ? 1 : 0) - (b.suffix ? 1 : 0) || naturalCompare(a.suffix, b.suffix));
    ramps.push(...order.map((o) => o.ramp));
    list = left;
  }
  const cmp = byNameOrValue<R>(order);
  return { key, label, setId, count: rows.length, ramps, themed: themed.sort(cmp), list: list.sort(cmp) };
}

export interface GroupSlice<R extends IndexRow = IndexRow> extends TokenGroup<R> {
  /** Slice of a larger group (index, total). */
  part: { index: number; total: number } | null;
}

/** Split rows into chunks of ~size without separating rows that share a keepTogether key (unless a run exceeds 2x size). */
export function chunkRows<R>(rows: readonly R[], size: number, keepTogether?: (r: R) => string): R[][] {
  if (!keepTogether) {
    const out: R[][] = [];
    for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
    return out;
  }
  const out: R[][] = [];
  let cur: R[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (cur.length >= size) {
      const prev = cur[cur.length - 1]!;
      if (keepTogether(prev) !== keepTogether(r) || cur.length >= size * 2) {
        out.push(cur);
        cur = [];
      }
    }
    cur.push(r);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Split oversized groups and pack groups into pages of roughly pageSize tokens. */
export function paginateGroups<R extends IndexRow>(groups: readonly TokenGroup<R>[], pageSize: number, keepTogether?: (r: R) => string): GroupSlice<R>[][] {
  const size = Math.max(1, pageSize);
  const slices: GroupSlice<R>[] = [];
  for (const g of groups) {
    if (g.count <= size) {
      slices.push({ ...g, part: null });
      continue;
    }
    // units: each ramp is atomic; themed and list rows are chunked
    type Unit = { kind: "ramp"; ramp: Ramp<R>; n: number } | { kind: "themed" | "list"; rows: R[]; n: number };
    const units: Unit[] = [];
    for (const r of g.ramps) units.push({ kind: "ramp", ramp: r, n: r.steps.length });
    for (const c of chunkRows(g.themed, size)) units.push({ kind: "themed", rows: c, n: c.length });
    for (const c of chunkRows(g.list, size, keepTogether)) units.push({ kind: "list", rows: c, n: c.length });
    const parts: GroupSlice<R>[] = [];
    let cur: GroupSlice<R> | null = null;
    for (const u of units) {
      if (!cur || (cur.count > 0 && cur.count + u.n > size)) {
        cur = { ...g, count: 0, ramps: [], themed: [], list: [], part: null };
        parts.push(cur);
      }
      if (u.kind === "ramp") cur.ramps.push(u.ramp);
      else if (u.kind === "themed") cur.themed.push(...u.rows);
      else cur.list.push(...u.rows);
      cur.count += u.n;
    }
    parts.forEach((p, i) => (p.part = { index: i + 1, total: parts.length }));
    slices.push(...parts);
  }
  const pages: GroupSlice<R>[][] = [];
  let page: GroupSlice<R>[] = [];
  let n = 0;
  for (const s of slices) {
    if (page.length && n + s.count > size) {
      pages.push(page);
      page = [];
      n = 0;
    }
    page.push(s);
    n += s.count;
  }
  if (page.length) pages.push(page);
  return pages;
}

/** Ids of all rows in a page (for fetching full records). */
export function pageRowIds<R extends IndexRow>(page: readonly GroupSlice<R>[]): string[] {
  const ids: string[] = [];
  for (const g of page) {
    for (const r of g.ramps) for (const s of r.steps) ids.push(s.row.id);
    for (const r of g.themed) ids.push(r.id);
    for (const r of g.list) ids.push(r.id);
  }
  return ids;
}
