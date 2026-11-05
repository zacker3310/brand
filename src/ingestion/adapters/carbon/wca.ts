/**
 * @carbon/web-components ships `custom-elements.json` in the web-component-analyzer (WCA)
 * format: { tags: [{ name, path, description, attributes[], properties[], events[], slots[] }] }.
 * We keep a compact view: tag name, source folder/file, short description and attributes.
 */
import { firstSentences } from "./mdx";

export interface WcAttribute {
  name: string;
  type: string | null;
  defaultValue: string | null;
  description: string | null;
  deprecated: boolean;
}

export interface WcTag {
  name: string;
  /** Source path as published, e.g. "./src/components/button/button.ts" */
  path: string;
  /** Folder under src/components (e.g. "button"). */
  folder: string | null;
  /** File base name without extension (e.g. "button"). */
  file: string | null;
  description: string | null;
  deprecated: boolean;
  attributes: WcAttribute[];
  /** JSON pointer of the tag in the manifest. */
  pointer: string;
}

interface RawAttr {
  name?: unknown;
  type?: unknown;
  default?: unknown;
  description?: unknown;
  deprecated?: unknown;
  deprecatedMessage?: unknown;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseWcaManifest(jsonText: string): { tags: WcTag[]; format: string } {
  const data = JSON.parse(jsonText) as { tags?: Record<string, unknown>[]; modules?: unknown[] };
  if (!Array.isArray(data.tags)) return { tags: [], format: Array.isArray(data.modules) ? "custom-elements-manifest" : "unknown" };
  const tags: WcTag[] = [];
  data.tags.forEach((t, i) => {
    const name = str(t.name);
    const path = str(t.path);
    if (!name || !path || !/^[a-z][a-z0-9]*-[a-z0-9-]+$/.test(name)) return;
    const m = path.match(/src\/components\/([a-z0-9-]+)\/(?:.*\/)?([a-z0-9-]+)\.ts$/);
    const attributes: WcAttribute[] = [];
    for (const a of (Array.isArray(t.attributes) ? t.attributes : []) as RawAttr[]) {
      const an = str(a.name);
      if (!an || attributes.some((x) => x.name === an)) continue;
      const depMsg = str(a.deprecatedMessage);
      const desc = str(a.description) ?? (depMsg ? depMsg.replace(/^This prop has been deprecated[^.]*\.\s*/i, "") : null);
      attributes.push({
        name: an,
        type: str(a.type),
        defaultValue: str(a.default),
        description: desc ? firstSentences(desc.replace(/\s+/g, " "), 280) : null,
        deprecated: a.deprecated === true || !!depMsg,
      });
    }
    tags.push({
      name,
      path,
      folder: m?.[1] ?? null,
      file: m?.[2] ?? null,
      description: firstSentences(str(t.description), 280),
      deprecated: t.deprecated === true || !!str(t.deprecatedMessage),
      attributes,
      pointer: `/tags/${i}`,
    });
  });
  return { tags, format: "wca" };
}
