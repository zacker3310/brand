/**
 * Custom Elements Manifest (custom-elements.json, schemaVersion 1.x) reader for @material/web.
 * JSON only; resolves superclass chains inside the package to collect public fields,
 * attributes and events. Placeholder descriptions ("TODO ... add docs", "b/123 - add docs")
 * are discarded rather than stored.
 */

export interface CemProperty {
  name: string;
  attribute: string | null;
  type: string | null;
  default: string | null;
  description: string | null;
}

export interface CemEvent {
  name: string;
  type: string | null;
  description: string | null;
}

export interface CemElement {
  tagName: string;
  className: string;
  modulePath: string;
  summary: string | null;
  description: string | null;
  properties: CemProperty[];
  events: CemEvent[];
  /** JSON pointer of the declaration inside custom-elements.json. */
  pointer: string;
  /** Pointer of the declaration the summary/description text came from (a superclass when the element's own doc is empty or a placeholder). */
  docPointer: string;
}

interface Decl {
  kind?: string;
  name?: string;
  tagName?: string;
  customElement?: boolean;
  summary?: string;
  description?: string;
  superclass?: { name?: string; package?: string; module?: string };
  members?: { kind?: string; name?: string; static?: boolean; privacy?: string; type?: { text?: string }; default?: string; attribute?: string; description?: string }[];
  attributes?: { name?: string; fieldName?: string; type?: { text?: string }; description?: string }[];
  events?: { name?: string; type?: { text?: string }; description?: string }[];
}

interface Manifest {
  modules?: { path?: string; declarations?: Decl[] }[];
}

const PLACEHOLDER = /(^|\b)(todo\b|add docs|b\/\d+)/i;
/** Lit/custom-element plumbing that manifests list as fields but are not component API. */
const PLUMBING = new Set(["shadowRootOptions", "styles", "elementStyles", "formAssociated", "properties", "observedAttributes"]);

export function cleanDoc(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  if (!t || PLACEHOLDER.test(t)) return null;
  return t;
}

export function parseCem(json: string): CemElement[] {
  const m = JSON.parse(json) as Manifest;
  const modules = m.modules ?? [];
  const byModule = new Map<string, Decl[]>();
  for (const mod of modules) if (mod.path) byModule.set(mod.path, mod.declarations ?? []);
  const pointerOf = new Map<Decl, string>();
  modules.forEach((mod, mi) => (mod.declarations ?? []).forEach((d, di) => pointerOf.set(d, `/modules/${mi}/declarations/${di}`)));
  const find = (module: string | undefined, name: string | undefined): Decl | undefined =>
    module && name ? byModule.get(module)?.find((d) => d.name === name && d.kind === "class") : undefined;

  const out: CemElement[] = [];
  modules.forEach((mod, mi) => {
    (mod.declarations ?? []).forEach((d, di) => {
      if (!d.tagName || !d.customElement || !d.name || !mod.path) return;
      const props = new Map<string, CemProperty>();
      const events = new Map<string, CemEvent>();
      let summary = cleanDoc(d.summary);
      let description = cleanDoc(d.description);
      let docPointer = `/modules/${mi}/declarations/${di}`;
      const seen = new Set<Decl>();
      let cur: Decl | undefined = d;
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const hadDoc = !!(summary ?? description);
        if (!summary) summary = cleanDoc(cur.summary);
        if (!description) description = cleanDoc(cur.description);
        if (!hadDoc && (summary ?? description)) docPointer = pointerOf.get(cur) ?? docPointer;
        const attrByField = new Map<string, string>();
        for (const a of cur.attributes ?? []) if (a.fieldName && a.name) attrByField.set(a.fieldName, a.name);
        for (const mem of cur.members ?? []) {
          if (mem.kind !== "field" || mem.static || !mem.name) continue;
          if (mem.privacy && mem.privacy !== "public") continue;
          if (mem.name.startsWith("_") || mem.name.startsWith("#") || PLUMBING.has(mem.name)) continue;
          if (props.has(mem.name)) continue;
          props.set(mem.name, {
            name: mem.name,
            attribute: mem.attribute ?? attrByField.get(mem.name) ?? null,
            type: mem.type?.text ?? null,
            default: mem.default ?? null,
            description: cleanDoc(mem.description),
          });
        }
        for (const e of cur.events ?? []) {
          if (!e.name || events.has(e.name)) continue;
          events.set(e.name, { name: e.name, type: e.type?.text ?? null, description: cleanDoc(e.description?.replace(/--(bubbles|composed)\b/g, "")) });
        }
        const sc: Decl["superclass"] = cur.superclass;
        cur = sc?.package === "@material/web" ? find(sc.module, sc.name) : undefined;
      }
      out.push({
        tagName: d.tagName,
        className: d.name,
        modulePath: mod.path,
        summary,
        description,
        properties: [...props.values()],
        events: [...events.values()],
        pointer: `/modules/${mi}/declarations/${di}`,
        docPointer,
      });
    });
  });
  return out.sort((a, b) => (a.tagName < b.tagName ? -1 : 1));
}
