/**
 * Cross-system alignment heuristics for the component comparison. Everything here is an ATLAS
 * inference and is labelled as such in the UI ("aligned by name (inferred)"). Pure; unit-tested.
 */
import type { ComponentCandidate } from "./types";

/** "dangerDescription", "danger-description", "danger_description" -> "dangerdescription". */
export function normalizePropName(name: string): string {
  return name
    .trim()
    .replace(/^[@.:]+/, "") // Vue/Lit binding prefixes: @click, .value, :prop
    .replace(/\?$/, "")
    .toLowerCase()
    .replace(/[-_\s]+/g, "");
}

export interface AlignableProp {
  system: string;
  implementation: string;
  name: string;
}

export interface PropAlignment<T extends AlignableProp> {
  key: string;
  /** Display label: the most common original spelling (ties: alphabetical). */
  label: string;
  method: "exact" | "normalized";
  names: string[];
  bySystem: Record<string, T[]>;
  systemCount: number;
}

/**
 * Groups props from several systems by normalized name. Rows are sorted by how many systems share
 * them (desc), then label, so shared API surface comes first.
 */
export function alignProps<T extends AlignableProp>(props: readonly T[]): PropAlignment<T>[] {
  const groups = new Map<string, T[]>();
  for (const p of props) {
    const k = normalizePropName(p.name);
    if (!k) continue;
    const g = groups.get(k);
    if (g) g.push(p);
    else groups.set(k, [p]);
  }
  const rows: PropAlignment<T>[] = [];
  for (const [key, list] of groups) {
    const freq = new Map<string, number>();
    for (const p of list) freq.set(p.name, (freq.get(p.name) ?? 0) + 1);
    const names = [...freq.keys()].sort();
    const label = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
    const bySystem: Record<string, T[]> = {};
    for (const p of list) (bySystem[p.system] ??= []).push(p);
    rows.push({ key, label, method: names.length === 1 ? "exact" : "normalized", names, bySystem, systemCount: Object.keys(bySystem).length });
  }
  return rows.sort((a, b) => b.systemCount - a.systemCount || a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
}

/* -------------------------------------------------------------------------- */
/* Keyboard                                                                    */
/* -------------------------------------------------------------------------- */

const KEY_ALIASES: [RegExp, string][] = [
  [/^(arrow ?keys?|arrows?|arrow(up|down|left|right)|(up|down|left|right)( arrow)?|↑|↓|←|→)$/i, "Arrow keys"],
  [/^(enter|return)$/i, "Enter"],
  [/^(space|spacebar|space bar)$/i, "Space"],
  [/^(esc|escape)$/i, "Escape"],
  [/^shift ?\+ ?tab$/i, "Shift+Tab"],
  [/^tab$/i, "Tab"],
  [/^home$/i, "Home"],
  [/^end$/i, "End"],
  [/^(page ?up|page ?down|pageup|pagedown)$/i, "Page Up / Page Down"],
  [/^(delete|backspace|del)$/i, "Delete / Backspace"],
];

/** Canonical key label used to align documented keyboard interactions, or null if unrecognized. */
export function canonicalKey(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  for (const [re, label] of KEY_ALIASES) if (re.test(s)) return label;
  if (/^[a-z]$/i.test(s) || /^(type|typing|printable characters?|character keys?)/i.test(s)) return "Type-ahead";
  return null;
}

/** "Tab / Space / Enter", "ArrowUp or ArrowDown", "Enter, Space" -> ["Tab", "Space", "Enter"]. */
export function splitKeys(keys: string): string[] {
  const out: string[] = [];
  for (const part of keys.split(/\s*(?:\/|,|\bor\b|\band\b|\|)\s*/i)) {
    if (!part) continue;
    const k = canonicalKey(part);
    const label = k ?? part.trim();
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

export const KEY_ORDER = ["Tab", "Shift+Tab", "Enter", "Space", "Escape", "Arrow keys", "Home", "End", "Page Up / Page Down", "Delete / Backspace", "Type-ahead"];

export function compareKeys(a: string, b: string): number {
  const ia = KEY_ORDER.indexOf(a);
  const ib = KEY_ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return a.localeCompare(b);
}

/* -------------------------------------------------------------------------- */
/* Default component pick                                                      */
/* -------------------------------------------------------------------------- */

function methodRank(method: string | null): number {
  if (!method) return 5;
  if (method.includes("adapter-declared") || method.includes("source-declared")) return 0;
  if (method.includes("alias-exact")) return 1;
  if (method.includes("alias-stripped")) return 2;
  if (method.includes("alias-singular") || method.includes("singular")) return 3;
  if (method.includes("contained")) return 4;
  return 5;
}

const plain = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/(?<!s)s$/, "");

/**
 * Orders a system's candidates for a canonical type so the most representative one is first:
 * non-deprecated, verified classification, strongest match method, exact slug/name, confidence.
 */
export function rankCandidates<T extends ComponentCandidate>(cands: readonly T[], type: { slug: string; name: string }): T[] {
  const typeName = plain(type.name);
  const score = (c: T) => [
    c.lifecycle === "deprecated" ? 1 : 0,
    c.classificationState === "verified" ? 0 : 1,
    methodRank(c.classificationMethod),
    c.slug === type.slug || plain(c.name) === typeName ? 0 : 1,
    -c.confidence,
  ];
  return [...cands].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i]! - sb[i]!;
    return a.name.localeCompare(b.name);
  });
}

/** Canonical state display order (mirrors taxonomy CANONICAL_STATES order). */
export const STATE_ORDER = [
  "default",
  "hover",
  "focus",
  "active",
  "disabled",
  "loading",
  "selected",
  "indeterminate",
  "error",
  "warning",
  "success",
  "readonly",
  "expanded",
  "collapsed",
  "dragged",
  "skeleton",
  "inactive",
];
