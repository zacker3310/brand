/**
 * Contrast inputs for the explorer (pure). Theme-dependent tokens are expanded into one entry per themed set
 * so that pairs are only ever measured within the same theme. Pairing heuristics live in
 * src/lib/tokens/compare.ts (contrastPairs) and are always labelled "inferred".
 */
import { isThemeDependentValue } from "@/lib/contracts";
import { checkContrast, parseColor, type ContrastResult } from "@/lib/tokens/color";
import type { ScaleInputToken } from "@/lib/tokens/compare";
import { previewValue } from "./values";

export interface ContrastCandidate {
  name: string;
  setSlug: string;
  rawValue: unknown;
  resolvedValue: unknown;
  aliasState: string | null;
}

/** Candidate tokens -> contrastPairs input, theme = themed set slug (or the token's own set). */
export function expandForContrast(cands: readonly ContrastCandidate[]): ScaleInputToken[] {
  const out: ScaleInputToken[] = [];
  for (const c of cands) {
    if (isThemeDependentValue(c.resolvedValue)) {
      for (const [k, v] of Object.entries(c.resolvedValue.$themes)) if (parseColor(v)) out.push({ name: c.name, value: v, type: "color", category: "color", theme: k });
      continue;
    }
    const v = previewValue(c);
    if (v !== null && v !== undefined && parseColor(v)) out.push({ name: c.name, value: v, type: "color", category: "color", theme: c.setSlug });
  }
  return out;
}

export type Operand =
  | { kind: "color"; input: string; value: unknown }
  | { kind: "token"; input: string; byTheme: Map<string, unknown> }
  | { kind: "invalid"; input: string; reason: string };

/** A manual contrast operand: an exact token name in scope, or a literal CSS color. */
export function resolveOperand(input: string, cands: readonly ContrastCandidate[]): Operand {
  const s = input.trim();
  const matches = cands.filter((c) => c.name === s);
  if (matches.length) {
    const byTheme = new Map<string, unknown>();
    for (const e of expandForContrast(matches)) byTheme.set(e.theme ?? "", e.value);
    if (!byTheme.size) return { kind: "invalid", input: s, reason: "This token has no statically known color value (unresolved, external or not a color)." };
    return { kind: "token", input: s, byTheme };
  }
  if (parseColor(s)) return { kind: "color", input: s, value: s };
  return { kind: "invalid", input: s, reason: "Not a token name in this scope or a CSS color." };
}

export interface ManualResult {
  theme: string | null;
  fg: unknown;
  bg: unknown;
  result: ContrastResult;
}

/** Contrast per theme for two operands; literal colors apply to every theme of the other operand. */
export function manualContrast(fg: Operand, bg: Operand): ManualResult[] {
  if (fg.kind === "invalid" || bg.kind === "invalid") return [];
  const pairs: { theme: string | null; f: unknown; b: unknown }[] = [];
  if (fg.kind === "color" && bg.kind === "color") pairs.push({ theme: null, f: fg.value, b: bg.value });
  else if (fg.kind === "token" && bg.kind === "color") for (const [k, v] of fg.byTheme) pairs.push({ theme: k, f: v, b: bg.value });
  else if (fg.kind === "color" && bg.kind === "token") for (const [k, v] of bg.byTheme) pairs.push({ theme: k, f: fg.value, b: v });
  else if (fg.kind === "token" && bg.kind === "token") {
    for (const [k, v] of fg.byTheme) if (bg.byTheme.has(k)) pairs.push({ theme: k, f: v, b: bg.byTheme.get(k) });
  }
  const out: ManualResult[] = [];
  for (const p of pairs) {
    const r = checkContrast(p.f, p.b);
    if (r) out.push({ theme: p.theme, fg: p.f, bg: p.b, result: r });
  }
  return out;
}
