import { FRAMEWORKS } from "@/lib/taxonomy";

const FRAMEWORK_NAMES = new Map(FRAMEWORKS.map((f) => [f.slug, f.name]));

export function frameworkName(slug: string): string {
  return FRAMEWORK_NAMES.get(slug) ?? slug;
}

/**
 * component_property.implementation is a framework slug, optionally qualified with the
 * sub-component it documents ("react:InlineNotification"), or "default".
 */
export function implementationLabel(impl: string): { framework: string; part: string | null; label: string } {
  if (impl === "default") return { framework: "Default", part: null, label: "Default" };
  const idx = impl.indexOf(":");
  const fw = idx === -1 ? impl : impl.slice(0, idx);
  const part = idx === -1 ? null : impl.slice(idx + 1) || null;
  const framework = frameworkName(fw);
  return { framework, part, label: part ? `${framework} · ${part}` : framework };
}

/** Orders implementations: unqualified framework implementations first, then qualified ones, by label. */
export function sortImplementations(impls: string[]): string[] {
  return [...impls].sort((a, b) => {
    const qa = a.includes(":") ? 1 : 0;
    const qb = b.includes(":") ? 1 : 0;
    if (qa !== qb) return qa - qb;
    return implementationLabel(a).label.localeCompare(implementationLabel(b).label);
  });
}

const METHOD_STEPS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^alias-exact:(.+)$/, (m) => `the name matches the ATLAS alias “${m[1]}” exactly`],
  [/^alias-stripped:(.+)$/, (m) => `the name matches the alias “${m[1]}” after removing a library prefix or suffix`],
  [/^(?:alias-singular|singular\+alias-exact):(.+)$/, (m) => `the singular form of the name matches the alias “${m[1]}”`],
  [/^alias-contained:(.+)$/, (m) => `the name contains the alias “${m[1]}” (lower confidence)`],
  [/^apg-link:(.+)$/, (m) => `the official docs link the WAI-ARIA APG “${m[1]}” pattern`],
  [/^aria-role:(.+?)(?: \((.+)\))?$/, (m) => `the official docs declare the ARIA role “${m[1]}”${m[2] ? ` (${m[2]})` : ""}`],
  [/^adapter-declared$/, () => "the source declares the type explicitly"],
];

/** Plain-language explanation of a stored classification_method string. Falls back to the raw method. */
export function describeClassificationMethod(method: string | null | undefined): string | null {
  if (!method) return null;
  const raw = method.replace(/^(taxonomy|heuristic):/, "");
  const steps = raw.split("+").map((step) => {
    for (const [re, fn] of METHOD_STEPS) {
      const m = step.match(re);
      if (m) return fn(m);
    }
    return null;
  });
  if (steps.some((s) => s === null)) return `Method: ${method}`;
  const text = steps.join(", and ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

export const LIFECYCLE_META: Record<string, { label: string; tone: "neutral" | "info" | "warn" | "muted" }> = {
  stable: { label: "Stable", tone: "neutral" },
  beta: { label: "Beta", tone: "info" },
  experimental: { label: "Experimental", tone: "info" },
  deprecated: { label: "Deprecated", tone: "warn" },
};

export function formatDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${new Intl.NumberFormat("en-US").format(n)} ${n === 1 ? one : many}`;
}

/** Joins names as "A · B · C" with a "+N more" tail. */
export function joinNames(names: string[], max = 6): { shown: string[]; more: number } {
  return { shown: names.slice(0, max), more: Math.max(0, names.length - max) };
}

const GENERIC_REMAINDERS = new Set(["design system", "design", "design language", "ui", "components", "system", "design guidelines"]);

/**
 * Display-only short name for dense lists: drops a leading organization name when the system
 * name starts with it ("GitHub Primer" -> "Primer"), unless the remainder would be generic
 * ("Atlassian Design System" stays). The full name is always available alongside.
 */
export function shortSystemName(name: string, orgName: string | null | undefined): string {
  if (!orgName) return name;
  const org = orgName.trim();
  if (!org || !name.toLowerCase().startsWith(`${org.toLowerCase()} `)) return name;
  const rest = name.slice(org.length).trim();
  if (!rest || GENERIC_REMAINDERS.has(rest.toLowerCase())) return name;
  return rest;
}

/**
 * True when a prop's type string is just a union of string/number literals equal to its allowed
 * values ("'sm' | 'md' | 'lg'"), so the UI can show the values once as chips instead of twice.
 */
export function isLiteralUnionOf(type: string | null | undefined, values: string[] | null | undefined): boolean {
  if (!type || !values || values.length < 2) return false;
  const parts = type
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== values.length) return false;
  const literals = parts.map((p) => p.replace(/^(['"`])(.*)\1$/, "$2"));
  if (parts.some((p, i) => p === literals[i] && !/^-?\d+(\.\d+)?$/.test(p) && !["true", "false", "null"].includes(p))) return false;
  const set = new Set(values);
  return literals.every((l) => set.has(l));
}

export interface KeyboardGroup {
  context: string | null;
  rows: { keys: string[]; action: string }[];
}

/**
 * Display grouping for documented keyboard interactions: actions phrased "Context: action" are
 * grouped under their context, and consecutive keys with the identical action are merged into one
 * row. Purely presentational; no text is rewritten.
 */
export function groupKeyboard(rows: { keys: string; action: string }[]): KeyboardGroup[] {
  const groups: KeyboardGroup[] = [];
  for (const r of rows) {
    const m = r.action.match(/^([^:]{2,40}):\s+(.+)$/);
    const context = m ? m[1]!.trim() : null;
    const action = m ? m[2]!.trim() : r.action;
    let g = groups[groups.length - 1];
    if (!g || g.context !== context) {
      g = { context, rows: [] };
      groups.push(g);
    }
    const last = g.rows[g.rows.length - 1];
    if (last && last.action === action) last.keys.push(r.keys);
    else g.rows.push({ keys: [r.keys], action });
  }
  return groups;
}
