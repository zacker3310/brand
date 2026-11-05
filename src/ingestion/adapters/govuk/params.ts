/**
 * Nunjucks macro option parsing for govuk-frontend components.
 *
 * Source: packages/govuk-frontend/src/govuk/components/<name>/<name>.yaml at the release tag
 * (`params` + `examples`), or the equivalent dist/govuk/components/<name>/macro-options.json in the
 * npm package (same `params` list, generated from the YAML). Static parsing only.
 */
import YAML from "yaml";
import { clip, collapse } from "./markdown";

export interface MacroParam {
  /** Dotted path; array children use "[]": "items[].text", "fieldset.legend.text". */
  name: string;
  type: string | null;
  required: boolean | null;
  description: string | null;
  defaultValue: string | null;
  deprecated: boolean;
  /** Option is the options object of another component macro (`isComponent: true`). */
  isComponent: boolean;
  depth: number;
}

export interface MacroExample {
  name: string;
  hidden: boolean;
  /** Option keys used by the example (top level). */
  optionKeys: string[];
}

export interface ParsedParams {
  params: MacroParam[];
  examples: MacroExample[];
  /** Number of params dropped by the depth/size bounds. */
  truncated: number;
  format: "yaml" | "macro-options-json" | "invalid";
}

const MAX_DEPTH = 4;
const MAX_PARAMS = 150;

interface RawParam {
  name?: unknown;
  type?: unknown;
  required?: unknown;
  description?: unknown;
  isComponent?: unknown;
  params?: unknown;
  deprecated?: unknown;
}

/** "Defaults to `"submit"`." -> "submit"; "Defaults to `false`" -> "false". */
export function defaultFromDescription(desc: string | null): string | null {
  if (!desc) return null;
  const m = /\bDefaults? to `([^`]+)`/i.exec(desc);
  if (!m) return null;
  return m[1]!.replace(/^["']|["']$/g, "");
}

function flatten(list: unknown, prefix: string, depth: number, out: MacroParam[], counter: { dropped: number }, parentIsArray: boolean) {
  if (!Array.isArray(list)) return;
  for (const raw of list as RawParam[]) {
    if (!raw || typeof raw !== "object" || typeof raw.name !== "string" || !raw.name.trim()) continue;
    const seg = raw.name.trim();
    const name = prefix ? `${prefix}${parentIsArray ? "[]" : ""}.${seg}` : seg;
    const description = typeof raw.description === "string" ? clip(raw.description, 600) : null;
    const type = typeof raw.type === "string" ? raw.type : null;
    if (out.length >= MAX_PARAMS || depth > MAX_DEPTH) {
      counter.dropped++;
    } else {
      out.push({
        name,
        type,
        required: typeof raw.required === "boolean" ? raw.required : null,
        description,
        defaultValue: defaultFromDescription(description),
        deprecated: raw.deprecated === true || (!!description && /\bdeprecated\b/i.test(description)),
        isComponent: raw.isComponent === true,
        depth,
      });
    }
    if (raw.params) flatten(raw.params, name, depth + 1, out, counter, type === "array");
  }
}

function fromDoc(doc: unknown, format: ParsedParams["format"]): ParsedParams {
  const params: MacroParam[] = [];
  const counter = { dropped: 0 };
  const root = Array.isArray(doc) ? doc : doc && typeof doc === "object" ? (doc as { params?: unknown }).params : null;
  flatten(root, "", 0, params, counter, false);
  const examples: MacroExample[] = [];
  const exList = doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as { examples?: unknown }).examples : null;
  if (Array.isArray(exList)) {
    for (const e of exList as { name?: unknown; hidden?: unknown; options?: unknown }[]) {
      if (!e || typeof e.name !== "string") continue;
      examples.push({
        name: collapse(e.name),
        hidden: e.hidden === true,
        optionKeys: e.options && typeof e.options === "object" && !Array.isArray(e.options) ? Object.keys(e.options as object).sort() : [],
      });
    }
  }
  return { params, examples, truncated: counter.dropped, format };
}

/** Parse <name>.yaml (params + examples). */
export function parseParamsYaml(text: string): ParsedParams {
  try {
    const doc = YAML.parse(text, { maxAliasCount: 50 }) as unknown;
    return fromDoc(doc, "yaml");
  } catch {
    return { params: [], examples: [], truncated: 0, format: "invalid" };
  }
}

/** Parse macro-options.json (params only). */
export function parseMacroOptionsJson(text: string): ParsedParams {
  try {
    return fromDoc(JSON.parse(text) as unknown, "macro-options-json");
  } catch {
    return { params: [], examples: [], truncated: 0, format: "invalid" };
  }
}

/** camelCase option name -> kebab-case component folder ("errorMessage" -> "error-message"). */
export const optionToComponent = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();

/* -------------------------------- states ---------------------------------- */

export interface ParamState {
  name: string;
  canonicalHint: string;
  /** Param or example that documents the state. */
  via: string;
  description: string | null;
}

const PARAM_STATES: { re: RegExp; name: string; canonical: string }[] = [
  { re: /^(?:.*\.)?disabled$/, name: "Disabled", canonical: "disabled" },
  { re: /^errorMessage$/, name: "Error", canonical: "error" },
  { re: /^(?:items\[\]\.)?checked$/, name: "Checked", canonical: "selected" },
  { re: /^(?:items\[\]\.)?expanded$/, name: "Expanded", canonical: "expanded" },
  { re: /^open$/, name: "Open", canonical: "expanded" },
  { re: /^(?:items\[\]\.)?current$/, name: "Current", canonical: "selected" },
];

/** States implied by documented macro options (disabled, errorMessage, items[].checked, open...). */
export function statesFromParams(params: MacroParam[]): ParamState[] {
  const out: ParamState[] = [];
  for (const p of params) {
    for (const s of PARAM_STATES) {
      if (!s.re.test(p.name) || out.some((x) => x.name === s.name)) continue;
      if (p.type && p.type !== "boolean" && s.canonical !== "error") continue;
      out.push({ name: s.name, canonicalHint: s.canonical, via: `params.${p.name}`, description: p.description ? clip(p.description, 280) : null });
    }
  }
  return out;
}

/** Interaction states covered by named examples ("default hover state" -> Hover). */
export function statesFromExamples(examples: MacroExample[]): ParamState[] {
  const out: ParamState[] = [];
  for (const e of examples) {
    const m = /\b(hover|focus|active)\s+state\b/i.exec(e.name);
    if (!m) continue;
    const name = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase();
    if (out.some((x) => x.name === name)) continue;
    out.push({ name, canonicalHint: m[1]!.toLowerCase(), via: `examples["${e.name}"]`, description: null });
  }
  return out;
}
