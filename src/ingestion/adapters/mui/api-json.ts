/**
 * MUI generated API reference data (mui/material-ui docs generator output, committed to the repo):
 *  - docs/pages/<product>/api/<slug>.json: props (type/default/required/deprecated/signature),
 *    slots, CSS classes (incl. global state classes), imports, inheritance, demos.
 *  - docs/translations/api-docs[-joy]/<slug>/<slug>.json: componentDescription + prop/slot descriptions.
 * Pure parsing; tolerant of missing fields.
 */
import { parseDemosHtml } from "./nav";
import { htmlToText, typeDescriptionToText } from "./shared";

export interface ApiProp {
  name: string;
  /** Display type, e.g. "'small' | 'medium' | 'large' | string", "bool", "function(event: …) => void". */
  type: string | null;
  typeName: string | null;
  defaultValue: string | null;
  required: boolean;
  deprecated: boolean;
  deprecationInfo: string | null;
}

export interface ApiSlot {
  name: string;
  description: string | null;
  defaultValue: string | null;
  className: string | null;
}

export interface ApiClass {
  key: string;
  className: string;
  description: string | null;
  isGlobal: boolean;
}

export interface ApiDoc {
  name: string;
  imports: string[];
  /** npm package of the first import ("@mui/material", "@mui/lab", "@mui/joy"). */
  packageName: string | null;
  props: ApiProp[];
  slots: ApiSlot[];
  classes: ApiClass[];
  muiName: string | null;
  forwardsRefTo: string | null;
  /** Repo-relative source file, e.g. "packages/mui-material/src/Button/Button.js". */
  filename: string | null;
  inheritance: { component: string; pathname: string | null } | null;
  demos: { pathname: string; title: string }[];
  spread: boolean | null;
  deprecated: boolean;
  deprecationInfo: string | null;
}

interface RawProp {
  type?: { name?: string; description?: string };
  default?: string;
  required?: boolean;
  deprecated?: boolean;
  deprecationInfo?: string;
  signature?: { type?: string };
}

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function propType(p: RawProp): string | null {
  const name = p.type?.name ?? null;
  if (p.signature?.type) return p.signature.type;
  const desc = typeDescriptionToText(p.type?.description);
  if (desc) return desc;
  return name;
}

export function parseApiJson(body: string): ApiDoc {
  const j = JSON.parse(body) as Record<string, unknown>;
  const rawProps = (j.props ?? {}) as Record<string, RawProp>;
  const props: ApiProp[] = Object.entries(rawProps).map(([name, p]) => ({
    name,
    type: propType(p),
    typeName: p.type?.name ?? null,
    defaultValue: s(p.default),
    required: p.required === true,
    deprecated: p.deprecated === true,
    deprecationInfo: htmlToText(s(p.deprecationInfo)),
  }));
  const slots: ApiSlot[] = Array.isArray(j.slots)
    ? (j.slots as Record<string, unknown>[]).filter((x) => s(x.name)).map((x) => ({ name: String(x.name), description: htmlToText(s(x.description)), defaultValue: s(x.default), className: s(x.class) }))
    : [];
  const classes: ApiClass[] = Array.isArray(j.classes)
    ? (j.classes as Record<string, unknown>[]).filter((x) => s(x.key) && s(x.className)).map((x) => ({ key: String(x.key), className: String(x.className), description: s(x.description), isGlobal: x.isGlobal === true }))
    : [];
  const imports = Array.isArray(j.imports) ? (j.imports as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const pkg = imports.map((i) => /from\s+'(@mui\/[a-z-]+)/.exec(i)?.[1]).find(Boolean) ?? null;
  const inh = j.inheritance as { component?: string; pathname?: string } | null | undefined;
  const filename = s(j.filename)?.replace(/^\//, "") ?? null;
  return {
    name: String(j.name ?? ""),
    imports,
    packageName: pkg,
    props,
    slots,
    classes,
    muiName: s(j.muiName),
    forwardsRefTo: s(j.forwardsRefTo),
    filename,
    inheritance: inh && s(inh.component) ? { component: inh.component!, pathname: s(inh.pathname) } : null,
    demos: parseDemosHtml(s(j.demos)),
    spread: typeof j.spread === "boolean" ? j.spread : null,
    deprecated: j.deprecated === true,
    deprecationInfo: htmlToText(s(j.deprecationInfo)),
  };
}

export interface ApiTranslations {
  /** Markdown (may contain "## ARIA"-style sections). */
  componentDescription: string | null;
  props: Record<string, { description: string | null; deprecated: string | null }>;
  slots: Record<string, string | null>;
}

export function parseApiTranslations(body: string): ApiTranslations {
  const j = JSON.parse(body) as Record<string, unknown>;
  const props: ApiTranslations["props"] = {};
  for (const [k, v] of Object.entries((j.propDescriptions ?? {}) as Record<string, Record<string, unknown>>)) {
    props[k] = { description: htmlToText(s(v?.description)), deprecated: htmlToText(s(v?.deprecated)) };
  }
  const slots: ApiTranslations["slots"] = {};
  for (const [k, v] of Object.entries((j.slotDescriptions ?? {}) as Record<string, unknown>)) slots[k] = htmlToText(s(v));
  return { componentDescription: s(j.componentDescription), props, slots };
}

/**
 * Split a translations componentDescription (markdown) into its lead text and "## Heading" sections
 * (e.g. CircularProgress documents "## ARIA" there).
 */
export function splitComponentDescription(md: string | null): { lead: string | null; sections: { heading: string; text: string }[] } {
  if (!md) return { lead: null, sections: [] };
  const parts = md.split(/^##+\s+/m);
  const lead = parts[0]!.trim() || null;
  const sections = parts.slice(1).map((p) => {
    const nl = p.indexOf("\n");
    return { heading: (nl < 0 ? p : p.slice(0, nl)).trim(), text: (nl < 0 ? "" : p.slice(nl + 1)).trim() };
  });
  return { lead, sections };
}

/** Markdown-ish text -> plain text (links keep their text, code ticks removed). */
export function mdInlineToText(md: string | null | undefined): string | null {
  if (!md) return null;
  const t = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}
