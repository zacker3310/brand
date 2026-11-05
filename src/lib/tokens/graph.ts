/**
 * Explicit alias graph for a token set (pure; never throws).
 *
 * Edge direction: A -> B means "token A references token B" (A is an alias of / depends on B).
 *  - roots:     tokens that others reference but that reference nothing (base values, e.g. palette steps).
 *  - leaves:    tokens that reference others but that nothing references (top-level aliases, e.g. component tokens).
 *  - isolated:  tokens with no in- or out-edges (standalone literals).
 *  - cycles:    strongly connected components with >1 member (or a self-reference), each as a concrete loop path.
 *  - longestChains: deepest acyclic alias paths, [leaf, ..., root].
 *  - orphanRefs: references whose target is not in the set (external or broken).
 * Edges come from the same reference analysis as resolveTokenGraph (resolve.ts), so both agree.
 */
import { analyzeTokenReferences, stronglyConnectedComponents, type ResolvableToken, type ResolveOptions, type ResolvedTokenInfo, type ResolutionState } from "./resolve";
import type { RefSyntax } from "./refs";

export interface AliasEdge {
  from: string;
  /** Target token name; null for orphan refs. */
  to: string | null;
  ref: string;
  raw: string;
  syntax: RefSyntax | "declared";
  /** Edge comes from a var() fallback used because the primary target is missing. */
  viaFallback: boolean;
}

export interface AliasGraphNode {
  name: string;
  cssVar: string | null;
  inDegree: number;
  outDegree: number;
  isAlias: boolean;
  inCycle: boolean;
  /** Longest acyclic chain length from this node to a base value (0 for literals; null when in/through a cycle). */
  depth: number | null;
}

export interface AliasGraph {
  nodes: AliasGraphNode[];
  edges: AliasEdge[];
  roots: string[];
  leaves: string[];
  isolated: string[];
  cycles: string[][];
  longestChains: string[][];
  orphanRefs: { from: string; ref: string; raw: string; syntax: RefSyntax | "declared" }[];
}

export interface AliasGraphOptions extends ResolveOptions {
  /** How many longest chains to report (default 10). */
  maxChains?: number;
}

/** Build the explicit alias graph. */
export function buildAliasGraph(tokens: readonly ResolvableToken[], opts: AliasGraphOptions = {}): AliasGraph {
  const empty: AliasGraph = { nodes: [], edges: [], roots: [], leaves: [], isolated: [], cycles: [], longestChains: [], orphanRefs: [] };
  try {
    const index = analyzeTokenReferences(tokens, opts);
    const list = index.tokens;
    const pos = new Map<string, number>();
    list.forEach((t, i) => pos.set(t.name, i));

    const edges: AliasEdge[] = [];
    const orphanRefs: AliasGraph["orphanRefs"] = [];
    const seenEdge = new Set<string>();
    for (const t of list) {
      for (const r of t.refs) {
        if (r.target) {
          const k = `${t.name}\u0000${r.target}\u0000${r.raw}`;
          if (!seenEdge.has(k)) {
            seenEdge.add(k);
            edges.push({ from: t.name, to: r.target, ref: r.ref, raw: r.raw, syntax: r.syntax, viaFallback: false });
          }
        } else {
          orphanRefs.push({ from: t.name, ref: r.ref, raw: r.raw, syntax: r.syntax });
          edges.push({ from: t.name, to: null, ref: r.ref, raw: r.raw, syntax: r.syntax, viaFallback: false });
          for (const ft of r.fallbackTargets) {
            const k = `${t.name}\u0000${ft}\u0000fallback`;
            if (!seenEdge.has(k)) {
              seenEdge.add(k);
              edges.push({ from: t.name, to: ft, ref: ft, raw: r.raw, syntax: r.syntax, viaFallback: true });
            }
          }
        }
      }
    }

    const adj = list.map((t) => t.deps.map((d) => pos.get(d)).filter((x): x is number => x !== undefined));
    const inDeg = new Array<number>(list.length).fill(0);
    adj.forEach((ds) => new Set(ds).forEach((d) => inDeg[d]!++));

    const sccs = stronglyConnectedComponents(list.length, adj);
    const inCycle = new Uint8Array(list.length);
    const cycles: string[][] = [];
    for (const comp of sccs) {
      const isCycle = comp.length > 1 || (adj[comp[0]!] ?? []).includes(comp[0]!);
      if (!isCycle) continue;
      comp.forEach((i) => (inCycle[i] = 1));
      cycles.push(loopPath(comp, adj).map((i) => list[i]!.name));
    }

    // Longest acyclic chain per node (SCC order = dependencies first).
    const depth: (number | null)[] = new Array(list.length).fill(null);
    const next: number[] = new Array(list.length).fill(-1);
    for (const comp of sccs) {
      for (const v of comp) {
        if (inCycle[v]) {
          depth[v] = null;
          continue;
        }
        let best = 0;
        let bestNext = -1;
        let blocked = false;
        for (const d of adj[v]!) {
          const dd = depth[d];
          if (dd === null || dd === undefined) {
            blocked = true;
            continue;
          }
          if (dd + 1 > best) {
            best = dd + 1;
            bestNext = d;
          }
        }
        depth[v] = blocked ? null : best;
        next[v] = bestNext;
      }
    }

    const nodes: AliasGraphNode[] = list.map((t, i) => ({
      name: t.name,
      cssVar: t.cssVar,
      inDegree: inDeg[i]!,
      outDegree: t.refs.length,
      isAlias: t.refs.length > 0,
      inCycle: !!inCycle[i],
      depth: depth[i] ?? null,
    }));
    const roots = nodes.filter((n) => n.outDegree === 0 && n.inDegree > 0).map((n) => n.name);
    const leaves = nodes.filter((n) => n.outDegree > 0 && n.inDegree === 0).map((n) => n.name);
    const isolated = nodes.filter((n) => n.outDegree === 0 && n.inDegree === 0).map((n) => n.name);

    const maxChains = Math.max(0, opts.maxChains ?? 10);
    const starts = list
      .map((_, i) => i)
      .filter((i) => inDeg[i] === 0 && (depth[i] ?? 0) > 0)
      .sort((a, b) => (depth[b] ?? 0) - (depth[a] ?? 0) || list[a]!.name.localeCompare(list[b]!.name))
      .slice(0, maxChains);
    const longestChains = starts.map((s) => {
      const path: string[] = [];
      let cur = s;
      let guard = 0;
      while (cur >= 0 && guard++ < 10_000) {
        path.push(list[cur]!.name);
        cur = next[cur]!;
      }
      return path;
    });

    return { nodes, edges, roots, leaves, isolated, cycles, longestChains, orphanRefs };
  } catch {
    return empty;
  }
}

/** A concrete loop through an SCC, starting from its first member. */
function loopPath(comp: number[], adj: readonly number[][]): number[] {
  const members = new Set(comp);
  const start = Math.min(...comp);
  if ((adj[start] ?? []).includes(start)) return [start];
  const prev = new Map<number, number>();
  const queue = [start];
  const seen = new Set([start]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const d of adj[cur] ?? []) {
      if (!members.has(d)) continue;
      if (d === start) {
        const path: number[] = [];
        let p: number | undefined = cur;
        while (p !== undefined && p !== start) {
          path.unshift(p);
          p = prev.get(p);
        }
        return [start, ...path];
      }
      if (!seen.has(d)) {
        seen.add(d);
        prev.set(d, cur);
        queue.push(d);
      }
    }
  }
  return comp;
}

export interface TokenGraphStats {
  tokens: number;
  literals: number;
  aliases: number;
  edges: number;
  uniqueTargets: number;
  roots: number;
  leaves: number;
  isolated: number;
  cycles: number;
  tokensInCycles: number;
  orphanRefs: number;
  /** Longest acyclic alias chain (edges). */
  maxDepth: number;
  /** Mean chain depth over alias tokens with a known depth (2 decimals). */
  meanAliasDepth: number;
  /** aliases / tokens (0..1, 3 decimals). */
  aliasRatio: number;
  /** Top referenced tokens (most aliased base values), up to 10. */
  mostReferenced: { name: string; inDegree: number }[];
  /** Resolution state counts when a resolution map is supplied. */
  states: Record<ResolutionState, number> | null;
}

/**
 * Summary statistics. Pass a prebuilt graph or the token list (graph is built internally), and
 * optionally the resolveTokenGraph() output for state counts.
 */
export function tokenGraphStats(input: AliasGraph | readonly ResolvableToken[], resolved?: Map<string, ResolvedTokenInfo>, opts: AliasGraphOptions = {}): TokenGraphStats {
  const g: AliasGraph = Array.isArray(input) ? buildAliasGraph(input as readonly ResolvableToken[], opts) : (input as AliasGraph);
  const nodes = g?.nodes ?? [];
  const aliases = nodes.filter((n) => n.isAlias);
  const depths = aliases.map((n) => n.depth).filter((d): d is number => typeof d === "number");
  const real = (g?.edges ?? []).filter((e) => e.to !== null && !e.viaFallback);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  let states: TokenGraphStats["states"] = null;
  if (resolved) {
    states = { literal: 0, resolved: 0, external: 0, cycle: 0, unresolved: 0 };
    for (const v of resolved.values()) states[v.state]++;
  }
  return {
    tokens: nodes.length,
    literals: nodes.length - aliases.length,
    aliases: aliases.length,
    edges: real.length,
    uniqueTargets: new Set(real.map((e) => e.to)).size,
    roots: g?.roots.length ?? 0,
    leaves: g?.leaves.length ?? 0,
    isolated: g?.isolated.length ?? 0,
    cycles: g?.cycles.length ?? 0,
    tokensInCycles: nodes.filter((n) => n.inCycle).length,
    orphanRefs: g?.orphanRefs.length ?? 0,
    maxDepth: nodes.reduce((m, n) => Math.max(m, n.depth ?? 0), 0),
    meanAliasDepth: depths.length ? Math.round((depths.reduce((a, b) => a + b, 0) / depths.length) * 100) / 100 : 0,
    aliasRatio: nodes.length ? r3(aliases.length / nodes.length) : 0,
    mostReferenced: [...nodes]
      .filter((n) => n.inDegree > 0)
      .sort((a, b) => b.inDegree - a.inDegree || a.name.localeCompare(b.name))
      .slice(0, 10)
      .map((n) => ({ name: n.name, inDegree: n.inDegree })),
    states,
  };
}
