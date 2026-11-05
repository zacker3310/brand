/**
 * Static alias resolution for a single token set (one theme). Pure; never throws.
 *
 * resolveTokenGraph(tokens) resolves:
 *  - DTCG whole-value aliases "{a.b}" (target's typed value is substituted, e.g. a dimension object),
 *  - embedded refs in strings "{size.1} {size.2}" / "calc(var(--space-1) * 2)" (string interpolation),
 *  - refs inside composite objects/arrays (shadow, typography, border, gradient stops...),
 *  - CSS var(--x, fallback) refs (mapped through token cssVar names, or names that are custom properties),
 *  - DTCG JSON-pointer refs { "$ref": "#/a/b" } inside values,
 *  - legacy Style Dictionary refs "{color.base.red.value}".
 * Expressions (Tokens Studio math, calc()) are NOT evaluated; the substituted string is returned.
 *
 * States (one per token):
 *  - literal:    no references.
 *  - resolved:   every reference resolved to a concrete value inside the set.
 *  - external:   at least one DIRECT reference target is not in the set and nothing else failed.
 *                resolvedValue is non-null only when CSS var() fallbacks covered every missing target
 *                (usedFallback = true); otherwise null and partialValue shows what could be substituted.
 *  - cycle:      the token is a member of a reference cycle (Tarjan SCC). resolvedValue null.
 *  - unresolved: anything else that prevents a full value: depends on an external/cycle/unresolved token,
 *                max depth exceeded, or a target value that cannot be embedded in a string.
 * Invariants: depth === chain.length; resolvedValue !== null implies state in {literal, resolved, external(usedFallback)}.
 *
 * Name lookup for a ref: opts.lookup -> exact name -> legacy ".value"/".$value" suffix stripped ->
 * separator-normalised name ("a/b/c" ~ "a.b.c", only when unambiguous). css-var refs: cssVar index -> name.
 * Duplicate names: the LAST occurrence wins (cascade / Style Dictionary override semantics); reported as an issue.
 */
import { collectValueReferences, findStringReferences, type RefSyntax, type ValueReference } from "./refs";
import { toCssColor, isDtcgColorObject } from "./color";

export interface ResolvableToken {
  name: string;
  rawValue: unknown;
  /** Declared reference targets (e.g. NormalizedToken.references). Used as dependency edges only when rawValue has no syntactic refs. */
  references?: string[];
  cssVar?: string | null;
}

export type ResolutionState = "resolved" | "unresolved" | "cycle" | "external" | "literal";

export type ResolutionIssueKind =
  | "missing-target"
  | "fallback-used"
  | "cycle"
  | "cycle-dependency"
  | "dependency-unresolved"
  | "max-depth"
  | "not-embeddable"
  | "duplicate-name"
  | "invalid-input";

export interface ResolutionIssue {
  kind: ResolutionIssueKind;
  ref?: string;
  target?: string;
  message: string;
}

export type RefState = "resolved" | "unresolved" | "cycle" | "external";

/** One reference occurrence in the token's raw value (maps 1:1 to a token_alias row). */
export interface TokenRefResolution {
  /** As authored: "{color.blue.5}", "var(--x, 4px)", "#/color/blue/5", or a declared reference. */
  raw: string;
  /** Normalised key: "color.blue.5" / "--x". */
  ref: string;
  syntax: RefSyntax | "declared";
  /** Token name in the set, or null when not found. */
  target: string | null;
  state: RefState;
  /** Chain length to a concrete value through this ref (target depth + 1); null when not resolvable. */
  depth: number | null;
  usedFallback: boolean;
}

export interface ResolvedTokenInfo {
  /** Fully substituted value; null unless fully resolved (see state docs). */
  resolvedValue: unknown;
  state: ResolutionState;
  /** Alias hops followed (=== chain.length). 0 for literals. */
  depth: number;
  /** Unique direct reference targets that exist in the set (token names). */
  targets: string[];
  /** Deepest path of token names followed from this token (excluding itself). For cycle members: the loop back to itself. */
  chain: string[];
  /** Per-reference detail. */
  refs: TokenRefResolution[];
  /** Raw refs with no target in the set (direct and transitive), unique. */
  missing: string[];
  issues: ResolutionIssue[];
  /** A CSS var() fallback was substituted for a missing target (directly or in a dependency). */
  usedFallback: boolean;
  /** Value with every resolvable reference substituted and unresolvable ones left as authored. */
  partialValue: unknown;
}

export interface ResolveOptions {
  /** Max alias chain depth before giving up (default 32). */
  maxDepth?: number;
  /** Substitute var() fallbacks when the var target is not in the set (default true). */
  useCssVarFallbacks?: boolean;
  /** Custom ref -> token name mapping, consulted first. Return null/undefined to fall back to defaults. */
  lookup?: (ref: string, syntax: RefSyntax | "declared") => string | null | undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/* -------------------------------------------------------------------------- */
/* Shared reference analysis (also used by graph.ts)                           */
/* -------------------------------------------------------------------------- */

export interface AnalyzedRef {
  ref: string;
  raw: string;
  syntax: RefSyntax | "declared";
  target: string | null;
  fallback: string | null;
  whole: boolean;
  path: (string | number)[];
  /** Targets referenced from inside this ref's fallback (only populated when target is missing). */
  fallbackTargets: string[];
  /** Refs in the fallback that are themselves missing. */
  fallbackMissing: string[];
}

export interface AnalyzedToken {
  name: string;
  rawValue: unknown;
  cssVar: string | null;
  refs: AnalyzedRef[];
  /** Unique dependency edges (token names), including fallback targets used for missing vars. */
  deps: string[];
  declaredOnly: boolean;
  duplicates: number;
}

export interface TokenIndex {
  lookup: (ref: string, syntax: RefSyntax | "declared") => string | null;
  tokens: AnalyzedToken[];
  byName: Map<string, AnalyzedToken>;
}

const sepNormalize = (s: string) => s.replace(/[/\\]/g, ".").replace(/\s+/g, "");

/** Build the lookup index and parse every token's references. Never throws. */
export function analyzeTokenReferences(input: readonly ResolvableToken[], opts: ResolveOptions = {}): TokenIndex {
  const list = Array.isArray(input) ? input : [];
  // Dedupe: last occurrence wins.
  const lastIdx = new Map<string, number>();
  const dupCount = new Map<string, number>();
  list.forEach((t, i) => {
    if (!t || typeof t !== "object" || typeof t.name !== "string" || !t.name) return;
    if (lastIdx.has(t.name)) dupCount.set(t.name, (dupCount.get(t.name) ?? 0) + 1);
    lastIdx.set(t.name, i);
  });
  const kept = [...lastIdx.values()].sort((a, b) => a - b).map((i) => list[i]!);

  const names = new Set<string>(kept.map((t) => t.name));
  const byCssVar = new Map<string, string>();
  const normIndex = new Map<string, string | null>(); // null = ambiguous
  for (const t of kept) {
    const cv = typeof t.cssVar === "string" && t.cssVar.startsWith("--") ? t.cssVar : null;
    if (cv) byCssVar.set(cv, t.name);
    if (t.name.startsWith("--") && !byCssVar.has(t.name)) byCssVar.set(t.name, t.name);
    const n = sepNormalize(t.name);
    if (n !== t.name || !names.has(n)) normIndex.set(n, normIndex.has(n) && normIndex.get(n) !== t.name ? null : t.name);
  }

  const lookup = (ref: string, syntax: RefSyntax | "declared"): string | null => {
    if (typeof ref !== "string" || !ref) return null;
    if (opts.lookup) {
      try {
        const r = opts.lookup(ref, syntax);
        if (typeof r === "string" && names.has(r)) return r;
      } catch {
        /* ignore custom lookup failures */
      }
    }
    if (syntax === "css-var") {
      return byCssVar.get(ref) ?? (names.has(ref) ? ref : null);
    }
    if (names.has(ref)) return ref;
    for (const suffix of [".value", ".$value"]) {
      if (ref.endsWith(suffix)) {
        const base = ref.slice(0, -suffix.length);
        if (names.has(base)) return base;
      }
    }
    if (syntax === "declared" && ref.startsWith("--")) {
      const v = byCssVar.get(ref);
      if (v) return v;
    }
    const n = sepNormalize(ref.replace(/\.(\$?value)$/, ""));
    const hit = normIndex.get(n);
    return hit ?? null;
  };

  const tokens: AnalyzedToken[] = [];
  const byName = new Map<string, AnalyzedToken>();
  for (const t of kept) {
    let parsed: ValueReference[] = [];
    try {
      parsed = collectValueReferences(t.rawValue);
    } catch {
      parsed = [];
    }
    const refs: AnalyzedRef[] = parsed.map((r) => {
      const target = lookup(r.ref, r.syntax);
      const fallbackTargets: string[] = [];
      const fallbackMissing: string[] = [];
      if (!target && r.syntax === "css-var" && r.fallback) collectFallbackRefs(r.fallback, lookup, fallbackTargets, fallbackMissing, 0);
      return { ref: r.ref, raw: r.raw, syntax: r.syntax, target, fallback: r.fallback, whole: r.whole, path: r.path, fallbackTargets, fallbackMissing };
    });
    let declaredOnly = false;
    if (refs.length === 0 && Array.isArray(t.references) && t.references.length) {
      declaredOnly = true;
      for (const d of new Set(t.references.filter((x): x is string => typeof x === "string" && x.length > 0))) {
        refs.push({ ref: d, raw: d, syntax: "declared", target: lookup(d, "declared"), fallback: null, whole: false, path: [], fallbackTargets: [], fallbackMissing: [] });
      }
    }
    const deps = new Set<string>();
    for (const r of refs) {
      if (r.target) deps.add(r.target);
      else r.fallbackTargets.forEach((x) => deps.add(x));
    }
    const a: AnalyzedToken = {
      name: t.name,
      rawValue: t.rawValue,
      cssVar: typeof t.cssVar === "string" ? t.cssVar : null,
      refs,
      deps: [...deps],
      declaredOnly,
      duplicates: dupCount.get(t.name) ?? 0,
    };
    tokens.push(a);
    byName.set(a.name, a);
  }
  return { lookup, tokens, byName };
}

function collectFallbackRefs(
  text: string,
  lookup: (ref: string, syntax: RefSyntax | "declared") => string | null,
  targets: string[],
  missing: string[],
  depth: number,
) {
  if (depth > 16) return;
  for (const r of findStringReferences(text)) {
    const t = lookup(r.ref, r.syntax);
    if (t) targets.push(t);
    else {
      missing.push(r.ref);
      if (r.syntax === "css-var" && r.fallback) collectFallbackRefs(r.fallback, lookup, targets, missing, depth + 1);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Strongly connected components (iterative Tarjan)                            */
/* -------------------------------------------------------------------------- */

/** SCCs in reverse topological order (dependencies before dependants). */
export function stronglyConnectedComponents(n: number, adj: readonly (readonly number[])[]): number[][] {
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const out: number[][] = [];
  let idx = 0;
  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    const frames: { v: number; i: number }[] = [{ v: s, i: 0 }];
    index[s] = low[s] = idx++;
    stack.push(s);
    onStack[s] = 1;
    while (frames.length) {
      const fr = frames[frames.length - 1]!;
      const edges = adj[fr.v] ?? [];
      if (fr.i < edges.length) {
        const w = edges[fr.i++]!;
        if (index[w] === -1) {
          index[w] = low[w] = idx++;
          stack.push(w);
          onStack[w] = 1;
          frames.push({ v: w, i: 0 });
        } else if (onStack[w]) {
          low[fr.v] = Math.min(low[fr.v]!, index[w]!);
        }
      } else {
        frames.pop();
        const parent = frames[frames.length - 1];
        if (parent) low[parent.v] = Math.min(low[parent.v]!, low[fr.v]!);
        if (low[fr.v] === index[fr.v]) {
          const comp: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = 0;
            comp.push(w);
          } while (w !== fr.v);
          out.push(comp);
        }
      }
    }
  }
  return out;
}

/** Shortest path from `start` back to itself inside `members` (names), excluding the start node at the head. */
function cyclePath(start: string, members: Set<string>, byName: Map<string, AnalyzedToken>): string[] {
  const prev = new Map<string, string>();
  const queue: string[] = [];
  for (const d of byName.get(start)?.deps ?? []) {
    if (!members.has(d)) continue;
    if (d === start) return [start];
    if (!prev.has(d)) {
      prev.set(d, start);
      queue.push(d);
    }
  }
  while (queue.length) {
    const cur = queue.shift()!;
    for (const d of byName.get(cur)?.deps ?? []) {
      if (!members.has(d)) continue;
      if (d === start) {
        const path = [start];
        let p: string | undefined = cur;
        while (p && p !== start) {
          path.unshift(p);
          p = prev.get(p);
        }
        return path;
      }
      if (!prev.has(d)) {
        prev.set(d, cur);
        queue.push(d);
      }
    }
  }
  return [start];
}

/* -------------------------------------------------------------------------- */
/* Substitution                                                                */
/* -------------------------------------------------------------------------- */

/** Stringify a resolved value for embedding in a larger string; null if it has no unambiguous CSS text. */
export function embedValue(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => typeof x === "string")) return (v as string[]).map((f) => (/[\s,]/.test(f) && !/^["']/.test(f) ? `"${f}"` : f)).join(", ");
    if (v.length && v.every((x) => typeof x === "number")) return (v as number[]).join(" ");
    return null;
  }
  if (isObj(v)) {
    if ((typeof v.value === "number" || typeof v.value === "string") && typeof v.unit === "string" && Object.keys(v).length <= 2) return `${v.value}${v.unit}`;
    if (isDtcgColorObject(v)) return typeof v.hex === "string" ? v.hex : toCssColor(v);
  }
  return null;
}

interface RefOutcome {
  ok: boolean;
  value: unknown;
  depth: number;
  chain: string[];
  usedFallback: boolean;
  missing: string[];
  failKinds: ResolutionIssueKind[];
}

interface Ctx {
  results: Map<string, ResolvedTokenInfo>;
  lookup: TokenIndex["lookup"];
  useFallbacks: boolean;
  cycleMembers: Set<string>;
  self: string;
  selfScc: Set<string> | null;
}

const MAX_VALUE_DEPTH = 24;

function resolveTargetOutcome(target: string, ctx: Ctx): RefOutcome {
  if (ctx.selfScc && ctx.selfScc.has(target)) {
    return { ok: false, value: null, depth: 0, chain: [target], usedFallback: false, missing: [], failKinds: ["cycle"] };
  }
  const info = ctx.results.get(target);
  if (!info) {
    // Should not happen (deps are processed first); be defensive.
    return { ok: false, value: null, depth: 0, chain: [target], usedFallback: false, missing: [], failKinds: ["dependency-unresolved"] };
  }
  const chain = [target, ...info.chain];
  if (info.resolvedValue !== null && info.resolvedValue !== undefined && (info.state === "resolved" || info.state === "literal" || info.state === "external")) {
    return { ok: true, value: info.resolvedValue, depth: info.depth + 1, chain, usedFallback: info.usedFallback, missing: info.missing, failKinds: [] };
  }
  const kind: ResolutionIssueKind = info.state === "cycle" ? "cycle-dependency" : info.state === "unresolved" && info.issues.some((i) => i.kind === "cycle" || i.kind === "cycle-dependency") ? "cycle-dependency" : "dependency-unresolved";
  return { ok: false, value: null, depth: info.depth + 1, chain, usedFallback: info.usedFallback, missing: info.missing, failKinds: [kind] };
}

/** Resolve a fallback string (may contain nested var()/refs). */
function resolveFallbackText(text: string, ctx: Ctx, nest: number): RefOutcome {
  const sub = substituteString(text, ctx, nest + 1, null);
  return {
    ok: sub.ok,
    value: sub.ok ? sub.value : null,
    depth: sub.depth,
    chain: sub.chain,
    usedFallback: true,
    missing: sub.missing,
    failKinds: sub.failKinds,
  };
}

interface SubResult {
  ok: boolean;
  value: unknown;
  partial: unknown;
  depth: number;
  chain: string[];
  usedFallback: boolean;
  missing: string[];
  failKinds: ResolutionIssueKind[];
  refOutcomes: { ref: string; raw: string; syntax: RefSyntax; target: string | null; outcome: RefOutcome; fallbackUsed: boolean }[];
}

function emptySub(value: unknown): SubResult {
  return { ok: true, value, partial: value, depth: 0, chain: [], usedFallback: false, missing: [], failKinds: [], refOutcomes: [] };
}

function merge(into: SubResult, o: { depth: number; chain: string[]; usedFallback: boolean; missing: string[]; failKinds: ResolutionIssueKind[]; ok: boolean }) {
  if (o.depth > into.depth || (o.depth === into.depth && into.chain.length === 0 && o.chain.length)) {
    into.depth = o.depth;
    into.chain = o.chain;
  }
  into.usedFallback ||= o.usedFallback;
  for (const m of o.missing) if (!into.missing.includes(m)) into.missing.push(m);
  for (const k of o.failKinds) into.failKinds.push(k);
  if (!o.ok) into.ok = false;
}

function substituteString(s: string, ctx: Ctx, nest: number, topLevel: SubResult["refOutcomes"] | null): SubResult {
  const res = emptySub(s);
  if (nest > 16) {
    res.ok = false;
    res.failKinds.push("max-depth");
    return res;
  }
  const refs = findStringReferences(s);
  if (!refs.length) return res;
  const trimmed = s.trim();
  const whole = refs.length === 1 && refs[0]!.raw === trimmed;

  const outcomes: { r: (typeof refs)[number]; o: RefOutcome; fallbackUsed: boolean; target: string | null }[] = [];
  for (const r of refs) {
    const target = ctx.lookup(r.ref, r.syntax);
    let o: RefOutcome;
    let fallbackUsed = false;
    if (target) o = resolveTargetOutcome(target, ctx);
    else if (r.syntax === "css-var" && r.fallback !== null && ctx.useFallbacks) {
      const fb = resolveFallbackText(r.fallback, ctx, nest);
      fallbackUsed = true;
      o = { ...fb, missing: [r.ref, ...fb.missing], failKinds: fb.failKinds };
    } else {
      o = { ok: false, value: null, depth: 0, chain: [], usedFallback: false, missing: [r.ref], failKinds: ["missing-target"] };
    }
    outcomes.push({ r, o, fallbackUsed, target });
    topLevel?.push({ ref: r.ref, raw: r.raw, syntax: r.syntax, target, outcome: o, fallbackUsed });
    merge(res, o);
  }

  if (whole) {
    const o = outcomes[0]!.o;
    res.value = o.ok ? o.value : null;
    res.partial = o.ok ? o.value : s;
    return res;
  }
  // Embedded: string interpolation, right-to-left so offsets stay valid.
  let out = s;
  let partial = s;
  for (let i = outcomes.length - 1; i >= 0; i--) {
    const { r, o } = outcomes[i]!;
    let text: string | null = null;
    if (o.ok) {
      text = embedValue(o.value);
      if (text === null) {
        res.ok = false;
        res.failKinds.push("not-embeddable");
      }
    }
    if (text !== null) {
      out = out.slice(0, r.start) + text + out.slice(r.end);
      partial = partial.slice(0, r.start) + text + partial.slice(r.end);
    }
  }
  res.value = res.ok ? out : null;
  res.partial = partial;
  return res;
}

function substituteValue(v: unknown, ctx: Ctx, depth: number, top: SubResult["refOutcomes"]): SubResult {
  if (depth > MAX_VALUE_DEPTH) {
    const r = emptySub(v);
    r.ok = false;
    r.failKinds.push("invalid-input");
    return r;
  }
  if (typeof v === "string") return substituteString(v, ctx, 0, top);
  if (Array.isArray(v)) {
    const res = emptySub(null);
    const vals: unknown[] = [];
    const parts: unknown[] = [];
    for (const x of v) {
      const s = substituteValue(x, ctx, depth + 1, top);
      merge(res, s);
      vals.push(s.value);
      parts.push(s.partial);
    }
    res.value = res.ok ? vals : null;
    res.partial = parts;
    return res;
  }
  if (isObj(v)) {
    if (typeof v.$ref === "string" && Object.keys(v).length === 1) {
      const refs = collectValueReferences(v);
      const r = refs[0];
      if (r && r.syntax === "json-pointer") {
        const target = ctx.lookup(r.ref, "json-pointer");
        const o: RefOutcome = target
          ? resolveTargetOutcome(target, ctx)
          : { ok: false, value: null, depth: 0, chain: [], usedFallback: false, missing: [r.ref], failKinds: ["missing-target"] };
        top.push({ ref: r.ref, raw: r.raw, syntax: "json-pointer", target, outcome: o, fallbackUsed: false });
        const res = emptySub(null);
        merge(res, o);
        res.value = o.ok ? o.value : null;
        res.partial = o.ok ? o.value : v;
        return res;
      }
    }
    const res = emptySub(null);
    const out: Record<string, unknown> = {};
    const partial: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const s = substituteValue(x, ctx, depth + 1, top);
      merge(res, s);
      out[k] = s.value;
      partial[k] = s.partial;
    }
    res.value = res.ok ? out : null;
    res.partial = partial;
    return res;
  }
  return emptySub(v);
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

const ISSUE_MESSAGES: Record<ResolutionIssueKind, string> = {
  "missing-target": "Reference target is not in this token set",
  "fallback-used": "Target not in this set; the authored var() fallback was used",
  cycle: "Token is part of a reference cycle",
  "cycle-dependency": "Token depends on a reference cycle",
  "dependency-unresolved": "A referenced token could not be resolved",
  "max-depth": "Alias chain exceeds the maximum depth",
  "not-embeddable": "Referenced value cannot be embedded in a string",
  "duplicate-name": "Token name defined more than once; the last definition was used",
  "invalid-input": "Value could not be processed",
};

/**
 * Resolve every token's references within the given set. Returns a Map keyed by token name.
 * Never throws: invalid entries (missing/non-string names) are skipped.
 */
export function resolveTokenGraph(tokens: readonly ResolvableToken[], opts: ResolveOptions = {}): Map<string, ResolvedTokenInfo> {
  const results = new Map<string, ResolvedTokenInfo>();
  let index: TokenIndex;
  try {
    index = analyzeTokenReferences(tokens, opts);
  } catch {
    return results;
  }
  const maxDepth = Math.max(1, Math.min(10_000, opts.maxDepth ?? 32));
  const useFallbacks = opts.useCssVarFallbacks !== false;
  const list = index.tokens;
  const pos = new Map<string, number>();
  list.forEach((t, i) => pos.set(t.name, i));
  const adj = list.map((t) => t.deps.map((d) => pos.get(d)).filter((x): x is number => x !== undefined));
  const sccs = stronglyConnectedComponents(list.length, adj);
  const cycleMembers = new Set<string>();
  const sccOf = new Map<string, Set<string>>();
  for (const comp of sccs) {
    const names = comp.map((i) => list[i]!.name);
    const isCycle = names.length > 1 || (adj[comp[0]!] ?? []).includes(comp[0]!);
    if (isCycle) {
      const set = new Set(names);
      for (const n of names) {
        cycleMembers.add(n);
        sccOf.set(n, set);
      }
    }
  }

  for (const comp of sccs) {
    // Within an SCC, process every member; cycle members never consume each other's values.
    for (const i of comp) {
      const t = list[i]!;
      try {
        results.set(t.name, resolveOne(t, index, results, cycleMembers, sccOf.get(t.name) ?? null, maxDepth, useFallbacks));
      } catch {
        results.set(t.name, {
          resolvedValue: null,
          state: "unresolved",
          depth: 0,
          targets: [],
          chain: [],
          refs: [],
          missing: [],
          issues: [{ kind: "invalid-input", message: ISSUE_MESSAGES["invalid-input"] }],
          usedFallback: false,
          partialValue: t.rawValue,
        });
      }
    }
  }
  return results;
}

function resolveOne(
  t: AnalyzedToken,
  index: TokenIndex,
  results: Map<string, ResolvedTokenInfo>,
  cycleMembers: Set<string>,
  scc: Set<string> | null,
  maxDepth: number,
  useFallbacks: boolean,
): ResolvedTokenInfo {
  const issues: ResolutionIssue[] = [];
  if (t.duplicates > 0) issues.push({ kind: "duplicate-name", message: `${ISSUE_MESSAGES["duplicate-name"]} (${t.duplicates + 1} definitions)` });
  const targets = [...new Set(t.refs.map((r) => r.target).filter((x): x is string => !!x))];

  if (t.refs.length === 0) {
    return { resolvedValue: t.rawValue ?? null, state: "literal", depth: 0, targets: [], chain: [], refs: [], missing: [], issues, usedFallback: false, partialValue: t.rawValue ?? null };
  }

  const ctx: Ctx = { results, lookup: index.lookup, useFallbacks, cycleMembers, self: t.name, selfScc: scc };

  if (scc) {
    const chain = cyclePath(t.name, scc, index.byName);
    const refs: TokenRefResolution[] = t.refs.map((r) => {
      if (r.target && scc.has(r.target)) return { raw: r.raw, ref: r.ref, syntax: r.syntax, target: r.target, state: "cycle", depth: null, usedFallback: false };
      if (r.target) {
        const o = resolveTargetOutcome(r.target, ctx);
        return { raw: r.raw, ref: r.ref, syntax: r.syntax, target: r.target, state: o.ok ? "resolved" : "unresolved", depth: o.ok ? o.depth : null, usedFallback: o.usedFallback };
      }
      return { raw: r.raw, ref: r.ref, syntax: r.syntax, target: null, state: "external", depth: null, usedFallback: false };
    });
    issues.push({ kind: "cycle", message: `${ISSUE_MESSAGES.cycle}: ${[t.name, ...chain].join(" -> ")}` });
    const missing = [...new Set(t.refs.filter((r) => !r.target).map((r) => r.ref))];
    return { resolvedValue: null, state: "cycle", depth: chain.length, targets, chain, refs, missing, issues, usedFallback: false, partialValue: t.rawValue ?? null };
  }

  // Declared-only references: the raw value is already concrete; edges come from `references`.
  if (t.declaredOnly) {
    const res = emptySub(t.rawValue);
    const refs: TokenRefResolution[] = [];
    for (const r of t.refs) {
      if (!r.target) {
        merge(res, { ok: false, depth: 0, chain: [], usedFallback: false, missing: [r.ref], failKinds: ["missing-target"] });
        refs.push({ raw: r.raw, ref: r.ref, syntax: "declared", target: null, state: "external", depth: null, usedFallback: false });
        continue;
      }
      const o = resolveTargetOutcome(r.target, ctx);
      merge(res, o);
      refs.push({ raw: r.raw, ref: r.ref, syntax: "declared", target: r.target, state: o.ok ? "resolved" : o.failKinds.includes("cycle-dependency") ? "cycle" : "unresolved", depth: o.ok ? o.depth : null, usedFallback: o.usedFallback });
    }
    return finalize(t, res, refs, targets, issues, maxDepth, t.rawValue);
  }

  const top: SubResult["refOutcomes"] = [];
  const sub = substituteValue(t.rawValue, ctx, 0, top);
  const refs: TokenRefResolution[] = top.map((x) => ({
    raw: x.raw,
    ref: x.ref,
    syntax: x.syntax,
    target: x.target,
    state: x.outcome.ok ? (x.fallbackUsed ? "external" : "resolved") : !x.target ? "external" : x.outcome.failKinds.includes("cycle-dependency") || x.outcome.failKinds.includes("cycle") ? "cycle" : "unresolved",
    depth: x.outcome.ok ? x.outcome.depth : null,
    usedFallback: x.outcome.usedFallback || x.fallbackUsed,
  }));
  for (const x of top) if (x.fallbackUsed) issues.push({ kind: "fallback-used", ref: x.ref, message: `${ISSUE_MESSAGES["fallback-used"]}: ${x.ref}` });
  return finalize(t, sub, refs, targets, issues, maxDepth, sub.value);
}

function finalize(
  t: AnalyzedToken,
  sub: SubResult,
  refs: TokenRefResolution[],
  targets: string[],
  issues: ResolutionIssue[],
  maxDepth: number,
  value: unknown,
): ResolvedTokenInfo {
  const kinds = new Set(sub.failKinds);
  if (sub.depth > maxDepth) kinds.add("max-depth");
  const directMissing = refs.some((r) => r.target === null);
  for (const k of kinds) {
    if (k === "missing-target") {
      for (const r of refs.filter((x) => x.target === null && !x.usedFallback)) issues.push({ kind: k, ref: r.ref, message: `${ISSUE_MESSAGES[k]}: ${r.ref}` });
      if (!refs.some((x) => x.target === null && !x.usedFallback)) issues.push({ kind: k, message: ISSUE_MESSAGES[k] });
    } else issues.push({ kind: k, message: ISSUE_MESSAGES[k] });
  }
  let state: ResolutionState;
  const onlyMissing = [...kinds].every((k) => k === "missing-target");
  if (kinds.size === 0) state = directMissing && sub.usedFallback ? "external" : "resolved";
  else if (onlyMissing && directMissing) state = "external";
  else state = "unresolved";
  const resolved = kinds.size === 0 && value !== undefined ? value : null;
  return {
    resolvedValue: resolved,
    state,
    depth: sub.chain.length,
    targets,
    chain: sub.chain,
    refs,
    missing: sub.missing,
    issues,
    usedFallback: sub.usedFallback || refs.some((r) => r.usedFallback),
    partialValue: sub.partial,
  };
}

/** Counts per state (handy for run stats). */
export function countResolutionStates(map: Map<string, ResolvedTokenInfo>): Record<ResolutionState, number> {
  const out: Record<ResolutionState, number> = { literal: 0, resolved: 0, external: 0, cycle: 0, unresolved: 0 };
  for (const v of map.values()) out[v.state]++;
  return out;
}
