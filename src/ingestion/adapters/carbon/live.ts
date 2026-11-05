/**
 * Live docs page metadata (www.carbondesignsystem.com). The server-rendered page embeds the
 * component header props as JSON inside React Server Component payload strings
 * (`self.__next_f.push([1,"..."])`). We decode those string literals with JSON.parse (data only,
 * never evaluated) and read the object that carries `statusLabel`.
 */
import { REACT_SRC_RE, STORYBOOK_RE, WC_SRC_RE } from "./constants";

export interface LiveMeta {
  title: string | null;
  slug: string | null;
  statusLabel: string | null;
  webComponentsStatusLabel: string | null;
  lastUpdated: string | null;
  reactSourceUrl: string | null;
  reactFolder: string | null;
  reactStorybookUrl: string | null;
  wcSourceUrl: string | null;
  wcFolder: string | null;
  wcStorybookUrl: string | null;
  /** Fields present in the page but rejected by validation (malformed URLs etc.). */
  rejected: string[];
}

function rscText(html: string): string {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      out += JSON.parse(m[1]!) as string;
    } catch {
      /* skip malformed chunk */
    }
  }
  return out;
}

/** Balanced-brace JSON object that contains index `at`, scanning back from it. */
function objectAround(text: string, at: number): Record<string, unknown> | null {
  for (let start = text.lastIndexOf("{", at); start >= 0 && at - start < 4000; start = text.lastIndexOf("{", start - 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = start; j < text.length; j++) {
      const ch = text[j]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          if (j < at) break; // object closed before reaching `at`; try an earlier "{"
          try {
            return JSON.parse(text.slice(start, j + 1)) as Record<string, unknown>;
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

const s = (v: unknown) => (typeof v === "string" && v.trim() && !v.startsWith("$") ? v.trim() : null);

export function parseLiveMeta(html: string): LiveMeta | null {
  const text = rscText(html);
  const at = text.indexOf('"statusLabel"');
  if (at < 0) return null;
  const o = objectAround(text, at);
  if (!o) return null;
  const rejected: string[] = [];
  const res = (o.resources ?? {}) as Record<string, unknown>;
  const wres = (o.webComponentsResources ?? {}) as Record<string, unknown>;
  const pick = (v: unknown, re: RegExp, field: string): RegExpMatchArray | null => {
    const val = s(v);
    if (!val) return null;
    const m = val.match(re);
    if (!m) rejected.push(field);
    return m;
  };
  const r = pick(res.githubUrl, REACT_SRC_RE, "resources.githubUrl");
  const w = pick(wres.githubUrl, WC_SRC_RE, "webComponentsResources.githubUrl");
  const rs = pick(res.storybookUrl, STORYBOOK_RE, "resources.storybookUrl");
  const ws = pick(wres.storybookUrl, STORYBOOK_RE, "webComponentsResources.storybookUrl");
  return {
    title: s(o.title),
    slug: s(o.slug),
    statusLabel: s(o.statusLabel),
    webComponentsStatusLabel: s(o.webComponentsStatusLabel),
    lastUpdated: s(o.lastUpdated),
    reactSourceUrl: r?.[0] ?? null,
    reactFolder: r?.[1] ?? null,
    reactStorybookUrl: rs && rs[1] === "react" ? rs[0] : null,
    wcSourceUrl: w?.[0] ?? null,
    wcFolder: w?.[1] ?? null,
    wcStorybookUrl: ws && ws[1] === "web-components" ? ws[0] : null,
    rejected,
  };
}

/** Map a documented status label to the contract lifecycle enum. */
export function lifecycleFromLabel(label: string | null): "stable" | "beta" | "experimental" | "deprecated" | "unknown" {
  const l = (label ?? "").toLowerCase();
  if (l === "stable") return "stable";
  if (l === "deprecated") return "deprecated";
  if (l === "beta") return "beta";
  if (l === "experimental" || l === "preview" || l === "unstable") return "experimental";
  return "unknown";
}
