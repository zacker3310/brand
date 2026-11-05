/**
 * Fragment payloads produced by parse() and consumed by the normalizers, plus helpers shared by the
 * React and Web Components normalizers (props -> variants / sizes / states).
 */
import type { CoverageState, NormalizedComponent, NormalizedTokenSet } from "@/lib/contracts";
import { canonicalState } from "@/lib/taxonomy";
import type { F2ComponentEntry, F2NavGroup, F2Page } from "./f2-html";
import type { A11ySpec, BestPractices } from "./markdown";
import type { A11ySpecPage, ReactDocPage, SbEntry, StoriesMeta, WcDocPage } from "./storybook";
import { clip, sortBy, type Prov } from "./shared";

export interface NpmInfo {
  pkg: string;
  version: string;
  publishedAt: string | null;
  license: string | null;
  deprecated: string | null;
  url: string;
}

/** A property as extracted from a declaration file (JSON-serializable). */
export interface ExtractedProp {
  name: string;
  type: string;
  optional: boolean;
  slot: boolean;
  defaultValue: string | null;
  deprecated: boolean;
  description: string | null;
  allowedValues: string[] | null;
  /** Declaring type or class ("ButtonProps", "BaseButton"). */
  origin: string;
  /** Web components: HTML attribute name. */
  attribute?: string | null;
  readonly?: boolean;
}

export interface ReactComponentLite {
  name: string;
  summary: string | null;
  deprecated: string | null;
  propsType: string;
  props: ExtractedProp[];
  unresolved: string[];
  primarySlots: string[];
  line: number;
}

export interface WcElementLite {
  className: string;
  tagName: string;
  summary: string | null;
  /** Raw TSDoc text (links intact) of the class and its bases, for ARIA references. */
  rawDocs: string[];
  chain: string[];
  props: ExtractedProp[];
  slots: string[];
  events: string[];
  cssParts: string[];
  deprecated: string | null;
  line: number;
}

export type FluentFragment =
  | { kind: "sb-index"; prov: Prov; system: string; entries: SbEntry[] }
  | { kind: "react-index-dts"; prov: Prov; npm: NpmInfo; reexports: Record<string, string> }
  | { kind: "react-dts"; prov: Prov; pkg: string; version: string; components: ReactComponentLite[] }
  | {
      kind: "react-stories";
      prov: Prov;
      page: ReactDocPage;
      ref: string;
      meta: StoriesMeta;
      description: { prov: Prov; text: string } | null;
      bestPractices: { prov: Prov; data: BestPractices } | null;
      a11yMd: { prov: Prov; data: BestPractices } | null;
    }
  | { kind: "react-a11y-spec"; prov: Prov; page: A11ySpecPage; spec: A11ySpec }
  | { kind: "wc-dts"; prov: Prov; npm: NpmInfo; elements: WcElementLite[]; distDirs: string[] }
  | { kind: "readme"; prov: Prov; system: string; statements: Record<string, string | null> }
  | { kind: "tokens"; prov: Prov; pkg: string; version: string; sets: NormalizedTokenSet[]; warnings: string[]; themes: string[] }
  | { kind: "f2-nav"; prov: Prov; groups: F2NavGroup[] }
  | { kind: "f2-page"; prov: Prov; entry: F2ComponentEntry; page: F2Page }
  | { kind: "f2-content"; prov: Prov; role: string; navTitle: string | null; page: F2Page };

export type FragOf<K extends FluentFragment["kind"]> = Extract<FluentFragment, { kind: K }>;

export function pick<K extends FluentFragment["kind"]>(frags: FluentFragment[], kind: K): FragOf<K>[] {
  return frags.filter((f): f is FragOf<K> => f.kind === kind);
}

/* ------------------------------- props -> facets ------------------------------- */

type NormalizedVariant = NormalizedComponent["variants"][number];
type NormalizedState = NormalizedComponent["states"][number];
type NormalizedProperty = NormalizedComponent["properties"][number];

/** Props whose literal values are presentation variants (axis = prop name). */
export const VARIANT_PROPS = new Set(["appearance", "shape", "color", "intent", "modalType", "layout", "orientation", "density", "variant"]);

/** Boolean props that switch a documented interactive state. */
const STATE_PROPS: Record<string, string> = {
  disabled: "disabled",
  disabledFocusable: "disabled",
  checked: "selected",
  selected: "selected",
  indeterminate: "indeterminate",
  open: "expanded",
  expanded: "expanded",
  readOnly: "readonly",
  readonly: "readonly",
  invalid: "error",
};

export function variantsFromProps(props: ExtractedProp[], sourceUrl: string | null, location: string): NormalizedVariant[] {
  const out: NormalizedVariant[] = [];
  for (const p of sortBy(props, (x) => x.name)) {
    if (!VARIANT_PROPS.has(p.name) || !p.allowedValues || p.allowedValues.length < 2) continue;
    for (const v of p.allowedValues) {
      out.push({
        axis: p.name,
        name: v,
        description: clip(`Value of the \`${p.name}\` ${p.attribute ? `attribute (\`${p.attribute}\`)` : "prop"}${p.defaultValue === v ? " (default)" : ""}.`, 400),
        sourceUrl,
        location: `${location}#${p.origin}.${p.name}`,
      });
    }
  }
  return out;
}

export function sizesFromProps(props: ExtractedProp[]): string[] | null {
  const p = props.find((x) => x.name === "size" && x.allowedValues && x.allowedValues.length >= 2);
  return p ? [...p.allowedValues!] : null;
}

export function statesFromProps(props: ExtractedProp[], sourceUrl: string | null): NormalizedState[] {
  const out: NormalizedState[] = [];
  for (const p of props) {
    const canon = STATE_PROPS[p.name];
    if (canon && /\bboolean\b/.test(p.type)) {
      const label = p.attribute ?? p.name;
      out.push({ name: label, canonical: canon, description: `Boolean ${p.attribute ? "attribute" : "prop"} \`${label}\` declared in ${p.origin}.`, sourceUrl });
    }
    if (p.name === "validationState" && p.allowedValues) {
      for (const v of p.allowedValues) {
        const c = canonicalState(v);
        if (c && c !== "default") out.push({ name: `validationState=${v}`, canonical: c, description: `Value of the \`validationState\` prop declared in ${p.origin}.`, sourceUrl });
      }
    }
  }
  const seen = new Set<string>();
  return sortBy(
    out.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true))),
    (s) => s.name,
  );
}

export function toProperty(p: ExtractedProp, implementation: string, sourceUrl: string | null): NormalizedProperty {
  const lead = p.slot ? "Slot." : p.attribute ? `Attribute \`${p.attribute}\`.` : implementation === "web-components" ? "Property only (no attribute)." : null;
  const ro = p.readonly ? "Read-only." : null;
  return {
    implementation,
    name: p.name,
    type: p.type ? clip(p.type, 300) : null,
    defaultValue: p.defaultValue,
    required: implementation === "react" ? !p.optional : null,
    deprecated: p.deprecated,
    description: clip([lead, ro, p.description].filter(Boolean).join(" "), 600),
    allowedValues: p.allowedValues,
    sourceUrl,
  };
}

export function baseCoverage(state: CoverageState = "not-extracted"): Record<string, CoverageState> {
  return {
    description: state,
    variants: state,
    states: state,
    sizes: state,
    properties: state,
    accessibility: state,
    keyboard: state,
    responsive: state,
    tokens: state,
    examples: state,
    frameworks: state,
    relationships: state,
  };
}

/** Prefer the strongest classification among a name and its humanized form. */
export function strongest<T extends { confidence: number }>(cands: (T | null)[]): T | null {
  let best: T | null = null;
  for (const c of cands) if (c && (!best || c.confidence > best.confidence)) best = c;
  return best;
}
