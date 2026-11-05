/**
 * Token graph helpers used by the publish stage. These are local fallbacks implementing the
 * interfaces of src/lib/tokens/{resolve,format,validate}.ts (owned by the token workstream).
 * The engine imports token behavior ONLY from this module so switching to the shared
 * implementation is a one-file change.
 */
import { stableStringify } from "@/lib/utils";

export type AliasState = "resolved" | "unresolved" | "cycle" | "external" | "literal";

export interface GraphTokenInput {
  name: string;
  rawValue: unknown;
  references: string[];
  cssVar?: string | null;
}

export interface TokenResolution {
  resolvedValue: unknown;
  state: AliasState;
  depth: number;
  /** Direct reference targets (token names in the graph; raw ref when not found). */
  targets: string[];
  /** For pure aliases, the chain of names followed to the concrete value. */
  chain: string[];
}

const BRACE_RE = /\{([^{}]+)\}/g;
const VAR_RE = /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)/g;

/** Resolve aliases across a set of tokens. Pure; cycles and missing targets are reported, never guessed. */
export function resolveTokenGraph(tokens: GraphTokenInput[]): Map<string, TokenResolution> {
  const byName = new Map<string, GraphTokenInput>();
  const byVar = new Map<string, string>();
  for (const t of tokens) {
    if (!byName.has(t.name)) byName.set(t.name, t);
    if (t.cssVar && !byVar.has(t.cssVar)) byVar.set(t.cssVar, t.name);
  }
  const lookup = (ref: string): string | null => {
    const r = ref.trim();
    if (byName.has(r)) return r;
    if (byVar.has(r)) return byVar.get(r)!;
    const dashed = r.startsWith("--") ? r : `--${r}`;
    if (byVar.has(dashed)) return byVar.get(dashed)!;
    if (r.startsWith("--") && byName.has(r.slice(2))) return r.slice(2);
    return null;
  };

  const out = new Map<string, TokenResolution>();
  const visiting = new Set<string>();

  const resolve = (name: string): TokenResolution => {
    const done = out.get(name);
    if (done) return done;
    const t = byName.get(name)!;
    if (!t.references.length) {
      const r: TokenResolution = { resolvedValue: t.rawValue ?? null, state: "literal", depth: 0, targets: [], chain: [] };
      out.set(name, r);
      return r;
    }
    if (visiting.has(name)) return { resolvedValue: null, state: "cycle", depth: 0, targets: [], chain: [name] };
    visiting.add(name);
    const targetNames: string[] = [];
    const resolved = new Map<string, TokenResolution | null>();
    let state: AliasState = "resolved";
    let depth = 0;
    for (const ref of t.references) {
      const target = lookup(ref);
      if (!target) {
        targetNames.push(ref);
        resolved.set(ref, null);
        if (state === "resolved") state = "unresolved";
        continue;
      }
      targetNames.push(target);
      const tr = resolve(target);
      resolved.set(ref, tr);
      if (tr.state === "cycle") state = "cycle";
      else if ((tr.state === "unresolved" || tr.state === "external") && state === "resolved") state = tr.state;
      depth = Math.max(depth, tr.depth + 1);
    }
    visiting.delete(name);
    let resolvedValue: unknown = null;
    let chain: string[] = [];
    if (state === "resolved") {
      const single = singleReference(t.rawValue);
      if (single !== null) {
        const tr = resolved.get(single) ?? resolved.get(t.references[0]!) ?? null;
        resolvedValue = tr?.resolvedValue ?? null;
        const target = lookup(single) ?? targetNames[0]!;
        chain = [target, ...(tr?.chain ?? [])];
      } else {
        resolvedValue = substitute(t.rawValue, (ref) => {
          const target = lookup(ref);
          if (!target) return undefined;
          return out.get(target)?.resolvedValue;
        });
      }
    }
    const r: TokenResolution = { resolvedValue, state, depth, targets: targetNames, chain };
    out.set(name, r);
    return r;
  };

  for (const t of tokens) if (!out.has(t.name)) resolve(t.name);
  return out;
}

/** If the raw value is exactly one reference ("{a.b}" or "var(--x)"), return that reference. */
function singleReference(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const brace = /^\{([^{}]+)\}$/.exec(s);
  if (brace) return brace[1]!.trim();
  const v = /^var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)$/.exec(s);
  if (v) return v[1]!;
  return null;
}

function substitute(raw: unknown, valueOf: (ref: string) => unknown): unknown {
  if (typeof raw === "string") {
    const single = singleReference(raw);
    if (single !== null) return valueOf(single) ?? null;
    const fmt = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : v == null ? null : formatTokenValue(v, null));
    let failed = false;
    const rep = (m: string, ref: string) => {
      const v = fmt(valueOf(ref.trim()));
      if (v == null) {
        failed = true;
        return m;
      }
      return v;
    };
    const s = raw.replace(BRACE_RE, rep).replace(VAR_RE, rep);
    return failed ? null : s;
  }
  if (Array.isArray(raw)) return raw.map((x) => substitute(x, valueOf));
  if (raw && typeof raw === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) o[k] = substitute(v, valueOf);
    return o;
  }
  return raw;
}

/* ------------------------------- formatting ------------------------------- */

const dim = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "string") return String(v);
  if (typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    const o = v as { value: unknown; unit?: unknown };
    return `${o.value}${typeof o.unit === "string" ? o.unit : ""}`;
  }
  return null;
};

function formatColor(v: Record<string, unknown>): string | null {
  if (typeof v.hex === "string") return v.hex;
  if (typeof v.colorSpace === "string" && Array.isArray(v.components)) {
    const alpha = typeof v.alpha === "number" && v.alpha !== 1 ? ` / ${v.alpha}` : "";
    return `color(${v.colorSpace} ${(v.components as unknown[]).join(" ")}${alpha})`;
  }
  return null;
}

function formatShadow(v: Record<string, unknown>): string {
  const parts = [v.inset === true ? "inset" : null, dim(v.offsetX ?? v.x), dim(v.offsetY ?? v.y), dim(v.blur), dim(v.spread)].filter((x) => x != null);
  const color = typeof v.color === "string" ? v.color : v.color && typeof v.color === "object" ? formatColor(v.color as Record<string, unknown>) : null;
  if (color) parts.push(color);
  return parts.join(" ");
}

/** Human display string of a (resolved) token value. Returns null for null/undefined. */
export function formatTokenValue(value: unknown, type: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (type === "cubicBezier" && value.length === 4 && value.every((x) => typeof x === "number")) return `cubic-bezier(${value.join(", ")})`;
    if (type === "shadow" || value.every((x) => x && typeof x === "object" && ("offsetX" in x || "blur" in x))) {
      return value.map((x) => (x && typeof x === "object" ? formatShadow(x as Record<string, unknown>) : String(x))).join(", ");
    }
    return value.map((x) => formatTokenValue(x, null) ?? "").join(", ");
  }
  const o = value as Record<string, unknown>;
  if (type === "color" || "colorSpace" in o || ("hex" in o && Object.keys(o).length <= 4)) {
    const c = formatColor(o);
    if (c) return c;
  }
  if ("value" in o && "unit" in o) return dim(o);
  if (type === "shadow" || "offsetX" in o || "blur" in o) return formatShadow(o);
  if (type === "typography" || "fontFamily" in o || "fontSize" in o) {
    const family = Array.isArray(o.fontFamily) ? o.fontFamily.join(", ") : (o.fontFamily as string | undefined);
    const size = dim(o.fontSize);
    const lh = dim(o.lineHeight);
    return [o.fontStyle, o.fontWeight, size ? `${size}${lh ? `/${lh}` : ""}` : null, family].filter((x) => x != null && x !== "").map(String).join(" ");
  }
  if (type === "border" || ("width" in o && "style" in o)) return [dim(o.width), o.style, typeof o.color === "string" ? o.color : null].filter(Boolean).join(" ");
  if (type === "transition" || "duration" in o) {
    return [dim(o.duration), Array.isArray(o.timingFunction) ? `cubic-bezier(${o.timingFunction.join(", ")})` : o.timingFunction, dim(o.delay)].filter((x) => x != null && x !== "").map(String).join(" ");
  }
  const s = stableStringify(o);
  return s.length > 300 ? `${s.slice(0, 299)}…` : s;
}

/* ------------------------------- validation ------------------------------- */

const CSS_COLOR = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(.+\)|transparent|currentcolor|inherit|initial|unset|[a-z]{3,30})$/i;
const LENGTH = /^-?(\d+\.?\d*|\.\d+)(px|rem|em|%|vh|vw|vmin|vmax|pt|dp|sp|ch|ex|lh|cqw|cqh)?$/i;
const DURATION = /^-?(\d+\.?\d*|\.\d+)(ms|s)$/i;
const FUNC = /^(calc|var|clamp|min|max|env)\(.+\)$/i;
const FONT_WEIGHT_WORDS = /^(normal|bold|bolder|lighter|thin|hairline|extra-light|ultra-light|extralight|light|regular|book|medium|semi-bold|demi-bold|semibold|demibold|extra-bold|ultra-bold|extrabold|black|heavy|extra-black|ultra-black)$/i;

export interface TokenValueCheck {
  valid: boolean;
  message?: string;
}

/**
 * Validates a literal (non-alias) token value against its declared DTCG type. Unknown types are
 * accepted; references are not validated here (resolution reports unresolved aliases).
 */
export function validateTokenValue(value: unknown, type: string | null | undefined): TokenValueCheck {
  if (value === undefined || value === null || value === "") return { valid: false, message: "missing value" };
  if (typeof value === "string" && (/\{[^{}]+\}/.test(value) || FUNC.test(value.trim()))) return { valid: true };
  const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const isDimObj = (v: unknown) => !!v && typeof v === "object" && isNum((v as Record<string, unknown>).value) && typeof (v as Record<string, unknown>).unit === "string";
  switch (type) {
    case "color":
      if (typeof value === "string") return CSS_COLOR.test(value.trim()) ? { valid: true } : { valid: false, message: `not a color: ${value.slice(0, 60)}` };
      if (value && typeof value === "object" && (formatColor(value as Record<string, unknown>) !== null)) return { valid: true };
      return { valid: false, message: "color must be a CSS color string or DTCG color object" };
    case "dimension":
      if (isNum(value) || isDimObj(value)) return { valid: true };
      if (typeof value === "string" && (LENGTH.test(value.trim()) || value.trim().split(/\s+/).every((p) => LENGTH.test(p)))) return { valid: true };
      return { valid: false, message: `not a dimension: ${String(value).slice(0, 60)}` };
    case "duration":
      if (isNum(value) || isDimObj(value) || (typeof value === "string" && DURATION.test(value.trim()))) return { valid: true };
      return { valid: false, message: `not a duration: ${String(value).slice(0, 60)}` };
    case "cubicBezier":
      if (Array.isArray(value) && value.length === 4 && value.every(isNum)) return { valid: true };
      if (typeof value === "string" && /^(cubic-bezier\(.+\)|linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|steps\(.+\))$/i.test(value.trim())) return { valid: true };
      return { valid: false, message: "cubicBezier must be 4 numbers" };
    case "fontWeight":
      if (isNum(value) && (value as number) >= 1 && (value as number) <= 1000) return { valid: true };
      if (typeof value === "string" && (FONT_WEIGHT_WORDS.test(value.trim()) || /^\d{3}$/.test(value.trim()))) return { valid: true };
      return { valid: false, message: `not a font weight: ${String(value).slice(0, 60)}` };
    case "fontFamily":
      if (typeof value === "string" || (Array.isArray(value) && value.every((x) => typeof x === "string"))) return { valid: true };
      return { valid: false, message: "fontFamily must be a string or string[]" };
    case "number":
      if (isNum(value) || (typeof value === "string" && /^-?(\d+\.?\d*|\.\d+)$/.test(value.trim()))) return { valid: true };
      return { valid: false, message: `not a number: ${String(value).slice(0, 60)}` };
    case "shadow":
    case "typography":
    case "border":
    case "transition":
    case "gradient":
    case "strokeStyle":
      if (typeof value === "object" || typeof value === "string") return { valid: true };
      return { valid: false, message: `${type} must be a composite value` };
    default:
      return { valid: true };
  }
}
