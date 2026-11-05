/**
 * Static readers for MUI docs navigation files (never executed):
 *  - docs/data/<product>/pages.ts   -> component pages with their nav section ("inputs", "lab", ...)
 *  - docs/data/<product>/pagesApi.js -> API page slugs
 *  - docs/pages/<product>/react-*.js -> which markdown file the page renders
 */
import { findValue, objectGet, type JsValue } from "./js-literal";

export interface NavPage {
  pathname: string;
  /** Explicit nav title (else the page's own title applies). */
  title: string | null;
  /** Nav section ("inputs", "data-display", "lab", ...). */
  section: string | null;
  newFeature: boolean;
  order: number;
}

const str = (v: JsValue | null): string | null => (v && v.t === "string" ? v.v : null);

/**
 * Component docs pages in nav order, with their section: every "/<product>/react-*" page plus the
 * other product pages listed under the "Components" group (e.g. /material-ui/icons, /material-ui/transitions).
 */
export function parseNavPages(src: string, product: string): NavPage[] {
  const found = findValue(src, /const\s+pages\s*(?::[^=]+)?=\s*/);
  if (!found || found.value.t !== "array") return [];
  const out: NavPage[] = [];
  const seen = new Set<string>();
  const groupPath = `/${product}/react-`;
  const walk = (items: JsValue[], section: string | null, inComponents: boolean) => {
    for (const it of items) {
      if (it.t !== "object") continue;
      const pathname = str(objectGet(it, "pathname"));
      const subheader = str(objectGet(it, "subheader"));
      const children = objectGet(it, "children");
      const sec = subheader ?? section;
      const isComponentPage =
        !!pathname &&
        (new RegExp(`^/${product}/react-[a-z0-9-]+$`).test(pathname) ||
          (inComponents && new RegExp(`^/${product}/[a-z0-9-]+$`).test(pathname) && !/\/(all-components|about-the-lab)$/.test(pathname)));
      if (pathname && isComponentPage && !seen.has(pathname)) {
        seen.add(pathname);
        const nf = objectGet(it, "newFeature");
        out.push({ pathname, title: str(objectGet(it, "title")), section: sec, newFeature: nf?.t === "bool" && nf.v, order: out.length });
      }
      if (children && children.t === "array") walk(children.items, sec, inComponents || pathname === groupPath);
    }
  };
  walk(found.value.items, null, false);
  return out;
}

/** API slugs from pagesApi.js ("/material-ui/api/button-base" -> "button-base"), file order. */
export function parsePagesApi(src: string, product: string): string[] {
  const re = new RegExp(`pathname:\\s*'/${product}/api/([a-z0-9-]+)'`, "g");
  const out: string[] = [];
  for (let m = re.exec(src); m; m = re.exec(src)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** The markdown file a docs page module renders ("docs/data/material/components/buttons/buttons.md"). */
export function pageMarkdownPath(src: string): string | null {
  const m = /from\s+'(docs\/data\/[A-Za-z0-9/_-]+\.md)\?muiMarkdown'/.exec(src);
  return m ? m[1]! : null;
}

/** "<ul><li><a href=\"/material-ui/react-button/\">Button</a></li>…" -> [{ pathname, title }]. */
export function parseDemosHtml(html: string | null | undefined): { pathname: string; title: string }[] {
  if (!html) return [];
  const out: { pathname: string; title: string }[] = [];
  const re = /<a href="([^"]+)">([^<]+)<\/a>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const pathname = m[1]!.replace(/\/$/, "");
    if (!out.some((d) => d.pathname === pathname)) out.push({ pathname, title: m[2]!.trim() });
  }
  return out;
}
