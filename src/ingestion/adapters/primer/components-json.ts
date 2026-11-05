/**
 * Parser for @primer/react's published `generated/components.json` (schemaVersion 2): the build
 * output that aggregates every `packages/react/src/**\/*.docs.json` file (id, name, status,
 * a11yReviewed, importPath, props, subcomponents, stories). Pure: JSON in, plain data out.
 */
import { shortText, stripMarkdown } from "./text";

export interface PrimerProp {
  name: string;
  type: string | null;
  defaultValue: string | null;
  required: boolean | null;
  deprecated: boolean;
  description: string | null;
  /** JSON pointer inside components.json */
  pointer: string;
}

export interface PrimerSubcomponent {
  name: string;
  props: PrimerProp[];
  pointer: string;
}

export interface PrimerStory {
  id: string;
  /** Only short story code is kept (MIT-licensed source, stored with attribution). */
  code: string | null;
}

export interface PrimerDocsComponent {
  key: string;
  id: string;
  name: string;
  status: string | null;
  a11yReviewed: string | null;
  importPath: string | null;
  source: string | null;
  docsId: string | null;
  passthrough: { element: string; url: string | null } | null;
  props: PrimerProp[];
  subcomponents: PrimerSubcomponent[];
  stories: PrimerStory[];
  pointer: string;
}

export interface ComponentsJsonData {
  schemaVersion: number | null;
  components: PrimerDocsComponent[];
  warnings: string[];
}

const MAX_STORIES = 40;
const MAX_STORY_CODE = 1200;
const MAX_STORIES_WITH_CODE = 3;

const esc = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function parseProps(raw: unknown, pointer: string): PrimerProp[] {
  if (!Array.isArray(raw)) return [];
  const out: PrimerProp[] = [];
  raw.forEach((p, idx) => {
    if (!p || typeof p !== "object") return;
    const o = p as Record<string, unknown>;
    const name = str(o.name);
    if (!name) return;
    const def = o.defaultValue ?? o.default;
    const desc = str(o.description);
    out.push({
      name,
      type: str(o.type)?.replace(/\s+/g, " ") ?? null,
      defaultValue: def === undefined || def === null || String(def).trim() === "" ? null : String(def).replace(/\s+/g, " ").trim().slice(0, 300),
      required: typeof o.required === "boolean" ? o.required : null,
      deprecated: o.deprecated === true,
      description: desc ? shortText(stripMarkdown(desc, { keepCode: true }), 280) : null,
      pointer: `${pointer}/${idx}`,
    });
  });
  return out;
}

export function parseComponentsJson(body: string): ComponentsJsonData {
  const warnings: string[] = [];
  const json = JSON.parse(body) as { schemaVersion?: number; components?: Record<string, unknown> };
  const comps = json.components && typeof json.components === "object" ? json.components : {};
  const out: PrimerDocsComponent[] = [];
  for (const [key, value] of Object.entries(comps)) {
    if (!value || typeof value !== "object") continue;
    const c = value as Record<string, unknown>;
    const name = str(c.name);
    const id = str(c.id) ?? key;
    const pointer = `/components/${esc(key)}`;
    if (!name) {
      warnings.push(`components.json entry ${key} has no name; skipped`);
      continue;
    }
    const subs: PrimerSubcomponent[] = [];
    if (Array.isArray(c.subcomponents)) {
      c.subcomponents.forEach((s, idx) => {
        const so = s as Record<string, unknown>;
        const sname = str(so?.name);
        if (!sname) return;
        subs.push({ name: sname, props: parseProps(so.props, `${pointer}/subcomponents/${idx}/props`), pointer: `${pointer}/subcomponents/${idx}` });
      });
    }
    const stories: PrimerStory[] = [];
    let withCode = 0;
    if (Array.isArray(c.stories)) {
      for (const s of c.stories.slice(0, MAX_STORIES)) {
        const so = s as Record<string, unknown>;
        const sid = str(so?.id);
        if (!sid) continue;
        const code = str(so.code);
        const keep = code && code.length <= MAX_STORY_CODE && withCode < MAX_STORIES_WITH_CODE;
        if (keep) withCode++;
        stories.push({ id: sid, code: keep ? code : null });
      }
    }
    const pt = c.passthrough as Record<string, unknown> | undefined;
    const a11y = c.a11yReviewed;
    out.push({
      key,
      id,
      name,
      status: str(c.status),
      a11yReviewed: typeof a11y === "string" && a11y.trim() ? a11y.trim() : null,
      importPath: str(c.importPath),
      source: str(c.source),
      docsId: str(c.docsId),
      passthrough: pt && str(pt.element) ? { element: str(pt.element)!, url: str(pt.url) } : null,
      props: parseProps(c.props, `${pointer}/props`),
      subcomponents: subs,
      stories,
      pointer,
    });
  }
  // Deterministic order independent of JSON key order.
  out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { schemaVersion: typeof json.schemaVersion === "number" ? json.schemaVersion : null, components: out, warnings };
}

/** "https://github.com/primer/react/tree/main/packages/react/src/deprecated/DialogV1" -> "deprecated/DialogV1" */
export function sourceDir(source: string | null): string | null {
  if (!source) return null;
  const m = /\/packages\/react\/src\/(.+?)\/?$/.exec(source);
  return m ? m[1]! : null;
}
