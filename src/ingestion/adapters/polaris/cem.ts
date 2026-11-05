/**
 * Custom Elements Manifest reader for @shopify/polaris-types (dist/custom-elements.json,
 * schemaVersion 2.x). JSON only; nothing is executed. Collects each custom element's public
 * fields (with attribute names), events and slots.
 */
import { collapse, splitUnion } from "./text";

export interface WcProperty {
  name: string;
  attribute: string | null;
  type: string | null;
  default: string | null;
  description: string | null;
}

export interface WcEvent {
  name: string;
  type: string | null;
  description: string | null;
}

export interface WcSlot {
  /** "" for the default slot. */
  name: string;
  description: string | null;
}

export interface WcElement {
  tagName: string;
  className: string;
  modulePath: string;
  description: string | null;
  properties: WcProperty[];
  events: WcEvent[];
  slots: WcSlot[];
  /** JSON pointer of the declaration inside custom-elements.json. */
  pointer: string;
}

interface Decl {
  kind?: string;
  name?: string;
  tagName?: string;
  customElement?: boolean;
  description?: string;
  members?: { kind?: string; name?: string; static?: boolean; privacy?: string; type?: { text?: string }; default?: string; description?: string }[];
  attributes?: { name?: string; fieldName?: string }[];
  events?: { name?: string; type?: { text?: string }; description?: string }[];
  slots?: { name?: string; description?: string }[];
}

interface Manifest {
  schemaVersion?: string;
  modules?: { path?: string; declarations?: Decl[] }[];
}

/** Generic manifest boilerplate ("Configure the following properties on the button component.") is not a description. */
const BOILERPLATE = /^configure the following properties\b/i;

function doc(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = collapse(s);
  return t || null;
}

export function parsePolarisCem(json: string): { schemaVersion: string | null; elements: WcElement[] } {
  const m = JSON.parse(json) as Manifest;
  const out: WcElement[] = [];
  (m.modules ?? []).forEach((mod, mi) => {
    (mod.declarations ?? []).forEach((d, di) => {
      if (!d.tagName || !d.customElement || !d.name || !mod.path) return;
      const attrByField = new Map<string, string>();
      for (const a of d.attributes ?? []) if (a.fieldName && a.name) attrByField.set(a.fieldName, a.name);
      const props = new Map<string, WcProperty>();
      for (const mem of d.members ?? []) {
        if (mem.kind !== "field" || mem.static || !mem.name) continue;
        if (mem.privacy && mem.privacy !== "public") continue;
        if (mem.name.startsWith("_") || mem.name.startsWith("#")) continue;
        if (props.has(mem.name)) continue;
        props.set(mem.name, {
          name: mem.name,
          attribute: attrByField.get(mem.name) ?? null,
          type: mem.type?.text ? collapse(mem.type.text) : null,
          default: mem.default ?? null,
          description: doc(mem.description),
        });
      }
      const events = new Map<string, WcEvent>();
      for (const e of d.events ?? []) if (e.name && !events.has(e.name)) events.set(e.name, { name: e.name, type: e.type?.text ?? null, description: doc(e.description) });
      const slots = new Map<string, WcSlot>();
      for (const s of d.slots ?? []) if (typeof s.name === "string" && !slots.has(s.name)) slots.set(s.name, { name: s.name, description: doc(s.description) });
      const desc = doc(d.description);
      out.push({
        tagName: d.tagName,
        className: d.name,
        modulePath: mod.path,
        description: desc && !BOILERPLATE.test(desc) ? desc : null,
        properties: [...props.values()],
        events: [...events.values()],
        slots: [...slots.values()],
        pointer: `/modules/${mi}/declarations/${di}`,
      });
    });
  });
  out.sort((a, b) => (a.tagName < b.tagName ? -1 : a.tagName > b.tagName ? 1 : 0));
  return { schemaVersion: m.schemaVersion ?? null, elements: out };
}

/** Bound a very long type (e.g. the 600-member icon-name union) for display; allowedValues keep every member. */
export function displayType(type: string | null, max = 240): string | null {
  if (!type) return null;
  if (type.length <= max) return type;
  const parts = splitUnion(type);
  if (parts.length > 4) {
    const head: string[] = [];
    let len = 0;
    for (const p of parts) {
      if (len + p.length + 3 > max - 30) break;
      head.push(p);
      len += p.length + 3;
    }
    return `${head.join(" | ")} | … (${parts.length} values in total)`;
  }
  return `${type.slice(0, max - 1)}…`;
}
