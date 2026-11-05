/**
 * @adobe/spectrum-design-data component schemas (components/<name>.json, Apache-2.0): Adobe's
 * machine-readable component definitions (options, states, implementations, accessibility,
 * token bindings). Read as JSON data only.
 */
import { collapse } from "./shared";

export interface SchemaOption {
  name: string;
  type: string | null;
  values: string[];
  defaultValue: string | null;
  description: string | null;
}

export interface ComponentSchema {
  name: string; // kebab id, e.g. "action-button"
  displayName: string | null;
  description: string | null;
  category: string | null;
  options: SchemaOption[];
  states: string[];
  implementations: { platform: string | null; componentName: string | null; packageName: string | null; importPath: string | null }[];
  role: string | null;
  wcag: string[];
  tokenBindings: string[];
  slots: string[];
  lifecycle: { introduced: string | null; deprecated: string | null };
}

const s = (v: unknown) => (typeof v === "string" && v.trim() ? collapse(v) : null);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const scalar = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null);

/** "@adobe/spectrum-wc/components/button" -> "@adobe/spectrum-wc" (scoped) or "pkg" (unscoped). */
export function packageOfImportPath(p: string | null): string | null {
  if (!p) return null;
  const parts = p.split("/");
  if (p.startsWith("@")) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] || null;
}

export function parseComponentSchema(text: string): ComponentSchema | null {
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(d) || typeof d.name !== "string") return null;
  const options: SchemaOption[] = [];
  if (isObj(d.options)) {
    for (const [name, o] of Object.entries(d.options)) {
      if (!isObj(o)) continue;
      const values = Array.isArray(o.values)
        ? o.values.map((v) => (isObj(v) ? scalar(v.value) : scalar(v))).filter((v): v is string => v !== null)
        : Array.isArray(o.enum)
          ? o.enum.map(scalar).filter((v): v is string => v !== null)
          : [];
      options.push({ name, type: s(o.type), values, defaultValue: scalar(o.default), description: s(o.description) });
    }
  }
  const states = Array.isArray(d.states) ? d.states.map((x) => (isObj(x) ? s(x.name) : s(x))).filter((x): x is string => !!x) : [];
  const implementations = Array.isArray(d.implementations)
    ? d.implementations.filter(isObj).map((i) => ({
        platform: s(i.platform),
        componentName: s(i.componentName),
        packageName: s(i.package) ?? packageOfImportPath(s(i.importPath)),
        importPath: s(i.importPath),
      }))
    : [];
  const a11y = isObj(d.accessibility) ? d.accessibility : {};
  const wcag = Array.isArray(a11y.wcag) ? a11y.wcag.map((w) => (isObj(w) ? s(w.criterion) : s(w))).filter((x): x is string => !!x && /^\d\.\d{1,2}\.\d{1,2}$/.test(x)) : [];
  const tokenBindings = Array.isArray(d.tokenBindings) ? d.tokenBindings.map((b) => (isObj(b) ? s(b.token) : s(b))).filter((x): x is string => !!x) : [];
  const slots = Array.isArray(d.slots) ? d.slots.map((x) => (isObj(x) ? s(x.name) : s(x))).filter((x): x is string => !!x) : [];
  const meta = isObj(d.meta) ? d.meta : {};
  const lc = isObj(d.lifecycle) ? d.lifecycle : {};
  return {
    name: d.name,
    displayName: s(d.displayName),
    description: s(d.description),
    category: s(meta.category),
    options,
    states,
    implementations,
    role: s(a11y.role),
    wcag: [...new Set(wcag)],
    tokenBindings: [...new Set(tokenBindings)],
    slots,
    lifecycle: { introduced: s(lc.introduced), deprecated: s(lc.deprecated) },
  };
}
