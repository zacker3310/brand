/**
 * API tables (Property | Description | Type | Default | Version) -> component properties, plus the
 * variants / sizes / states that those documented props imply. Pure.
 */
import { canonicalState } from "@/lib/taxonomy";
import type { CellInfo, MdTable } from "./markdown";
import { collapse } from "./markdown";

export interface DocProp {
  /** Owner of the table: null = the documented component itself, otherwise a sub-component / config object / type name. */
  owner: string | null;
  name: string;
  type: string | null;
  defaultValue: string | null;
  description: string | null;
  version: string | null;
  deprecated: boolean;
  /** String-literal members of the type union (only literal segments). */
  literals: string[];
  /** True when every union member is a string literal. */
  allLiteral: boolean;
  line: number;
  /** Repository file of the table (embedded includes), else the page itself. */
  file: string | null;
}

const NAME_HEADERS = /^(property|properties|prop|props|name|param|params|parameter|attribute)$/i;
const TYPE_HEADERS = /^type$/i;
const SKIP_HEADING = /^(ref|refs|methods?|.*\bmethods?\b|.*\(\)$|events?|css variables|hooks?|semantic dom|design token|faq|imperative.*|static method.*)$/i;
const TS_TYPE_WORDS = new Set(["string", "number", "boolean", "reactnode", "object", "function", "null", "undefined", "any", "void", "never", "unknown", "true", "false"]);

/**
 * Normalize a heading into an owner name: "Select props" -> "Select", "DatePicker\[picker=week]" ->
 * "DatePicker[picker=week]", "Avatar.Group 4.5.0+" -> "Avatar.Group", "Statistic.Countdown Deprecated" -> "Statistic.Countdown".
 */
export function ownerName(h: string): string {
  return collapse(
    h
      .replace(/\\/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+(?:v?\d+\.\d+(?:\.\d+)?\+?|deprecated|experimental)\s*$/gi, "")
      .replace(/\s+(?:v?\d+\.\d+(?:\.\d+)?\+?|deprecated|experimental)\s*$/gi, "")
      .replace(/\s+props?$/i, ""),
  ).trim();
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function parseLiterals(type: CellInfo): { literals: string[]; allLiteral: boolean } {
  const literals: string[] = [];
  let nonLiteral = 0;
  const pushQuoted = (s: string) => {
    for (const part of s.split("|")) {
      const p = part.trim();
      const q = /^(['"])(.*)\1$/.exec(p);
      if (q) literals.push(q[2]!);
      else if (p) nonLiteral++;
    }
  };
  if (!type.segments.length) return { literals, allLiteral: false };
  for (const seg of type.segments) {
    if (seg.code !== null) {
      const c = seg.code.trim();
      if (/['"]/.test(c)) pushQuoted(c);
      else if (/^[A-Za-z0-9_-]+$/.test(c) && !TS_TYPE_WORDS.has(c.toLowerCase())) literals.push(c);
      else nonLiteral++;
    } else {
      const t = seg.text.trim();
      if (/^(['"]).*\1$/.test(t)) pushQuoted(t);
      else nonLiteral++;
    }
  }
  const uniq = [...new Set(literals)];
  return { literals: uniq, allLiteral: uniq.length > 0 && nonLiteral === 0 };
}

const cleanCell = (c: CellInfo | undefined): string | null => {
  if (!c) return null;
  const t = collapse(c.text);
  return !t || t === "-" || t === "—" ? null : t;
};

/**
 * Extract props from API tables. `mainNames` are owner names that mean "the component itself"
 * (e.g. the page title, "API", "Props", "Common API").
 */
export function extractProps(tables: MdTable[], opts: { mainNames: string[]; scope: (t: MdTable) => boolean; ownerOf: (t: MdTable) => string | null }): DocProp[] {
  const main = new Set(opts.mainNames.map(norm));
  const out: DocProp[] = [];
  for (const t of tables) {
    if (!opts.scope(t)) continue;
    const nameIdx = t.headers.findIndex((h) => NAME_HEADERS.test(h));
    const typeIdx = t.headers.findIndex((h) => TYPE_HEADERS.test(h));
    if (nameIdx < 0 || typeIdx < 0) continue;
    const descIdx = t.headers.findIndex((h) => /^description$/i.test(h));
    const defIdx = t.headers.findIndex((h) => /^default( value)?$/i.test(h));
    const verIdx = t.headers.findIndex((h) => /^version$/i.test(h));
    const nearestRaw = t.headings[t.headings.length - 1]?.text ?? "";
    if (SKIP_HEADING.test(ownerName(nearestRaw))) continue;
    const ownerRaw = opts.ownerOf(t);
    const ownerClean = ownerRaw ? ownerName(ownerRaw) : null;
    // "Radio/Radio.Button" documents the component itself (and an alias); treat as main.
    const isMain = !ownerClean || main.has(norm(ownerClean)) || ownerClean.split("/").some((x) => main.has(norm(x)));
    const owner = isMain ? null : ownerClean;
    const ownerDeprecated = !!ownerRaw && /\bdeprecated\b/i.test(ownerRaw);
    for (const row of t.rows) {
      const nameCell = row[nameIdx];
      if (!nameCell) continue;
      let name = collapse(nameCell.text).replace(/\\/g, "");
      if (!name || name === "-") continue;
      // Some cells list aliases "open | visible"; keep the first identifier.
      name = name.split(/\s*\|\s*/)[0]!.trim();
      if (!/^[A-Za-z_$@][\w$.\-[\]=()@:]*$/.test(name) || name.length > 80) continue;
      const typeCell = row[typeIdx];
      const { literals, allLiteral } = typeCell ? parseLiterals(typeCell) : { literals: [], allLiteral: false };
      const description = cleanCell(row[descIdx]);
      const deprecated = ownerDeprecated || nameCell.struck || /^(deprecated|废弃)\b|\bdeprecated\b|please use .* instead/i.test(description ?? "");
      out.push({
        owner,
        name,
        type: cleanCell(typeCell)?.slice(0, 400) ?? null,
        defaultValue: cleanCell(row[defIdx])?.slice(0, 200) ?? null,
        description: description ? description.slice(0, 600) : null,
        version: verIdx >= 0 ? cleanCell(row[verIdx]) : null,
        deprecated,
        literals,
        allLiteral,
        line: t.line,
        file: t.file ?? null,
      });
    }
  }
  return out;
}

/* --------------------------- variants / sizes / states --------------------------- */

/** Prop names whose string-literal values are documented visual variants (axis = prop name). */
export const VARIANT_AXES: Record<string, string> = {
  variant: "variant",
  type: "type",
  color: "color",
  shape: "shape",
  fill: "fill",
  mode: "mode",
  theme: "theme",
  appearance: "appearance",
  status: "status",
};

/** Boolean props mapped to canonical states. */
export const STATE_PROPS: Record<string, string> = {
  disabled: "disabled",
  loading: "loading",
  readonly: "readonly",
  checked: "selected",
  indeterminate: "indeterminate",
  open: "expanded",
  expanded: "expanded",
  selected: "selected",
};

const HTML_TYPE_VALUES = new Set(["submit", "reset", "button", "text", "password", "number", "email", "tel", "url", "search", "date", "file", "hidden"]);

export interface Derived {
  variants: { axis: string; name: string; prop: DocProp }[];
  sizes: { values: string[]; prop: DocProp } | null;
  states: { name: string; canonical: string | null; prop: DocProp; how: string }[];
}

/**
 * Props that document state but are not turned into states (a `status` typed as plain `string` whose
 * values are listed in the description, or state props of sub-parts such as `items[].disabled`). When
 * nothing is derived, such props mean "documented but not extracted", not "not documented".
 */
export function unextractedStateProps(props: DocProp[]): DocProp[] {
  return props.filter((p) => !p.deprecated && (p.name === "status" || !!STATE_PROPS[p.name.toLowerCase()]));
}

/** Derive variants, sizes and states from the component's own (owner = null), non-deprecated props. */
export function deriveFromProps(props: DocProp[]): Derived {
  const own = props.filter((p) => p.owner === null && !p.deprecated);
  const variants: Derived["variants"] = [];
  const states: Derived["states"] = [];
  let sizes: Derived["sizes"] = null;
  const seenState = new Set<string>();
  for (const p of own) {
    const key = p.name;
    if (key === "size" && p.literals.length >= 2 && !sizes) sizes = { values: p.literals, prop: p };
    const axis = VARIANT_AXES[key];
    if (axis && p.literals.length >= 2) {
      const stateLike = p.literals.filter((v) => canonicalState(v)).length;
      if (key === "status" && stateLike * 2 >= p.literals.length && !p.literals.some((v) => /^\d+$/.test(v))) {
        // Validation status values are states, not visual variants.
        for (const v of p.literals) {
          const c = canonicalState(v);
          if (!seenState.has(v)) {
            seenState.add(v);
            states.push({ name: v, canonical: c, prop: p, how: `status value '${v}'` });
          }
        }
      } else if (!(key === "type" && (p.literals.every((v) => HTML_TYPE_VALUES.has(v)) || /\bnative\b|\bhtml\b/i.test(p.description ?? "")))) {
        for (const v of p.literals) variants.push({ axis, name: v, prop: p });
      }
    }
    const sk = STATE_PROPS[key.toLowerCase()];
    if (sk && /\bboolean\b/i.test(p.type ?? "") && !seenState.has(key)) {
      seenState.add(key);
      states.push({ name: key, canonical: canonicalState(sk) ?? sk, prop: p, how: `boolean prop \`${key}\`` });
    }
  }
  return { variants, sizes, states };
}
