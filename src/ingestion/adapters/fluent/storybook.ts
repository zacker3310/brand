/**
 * Storybook 8 story index (index.json) and story-file readers for the Fluent UI Storybooks.
 * index.json is data; story files (TypeScript) are only scanned with regular expressions for the
 * default-export meta (`title`, `component`, `subcomponents`) and `.md` imports. Nothing is executed.
 */
import { SB_REACT, SB_WC, storybookDocsUrl } from "./shared";

export interface SbEntry {
  id: string;
  title: string;
  name: string;
  importPath: string;
  type: "docs" | "story";
  tags: string[];
}

export function parseStoryIndex(json: string): SbEntry[] {
  const d = JSON.parse(json) as { v?: number; entries?: Record<string, Partial<SbEntry>> };
  const out: SbEntry[] = [];
  for (const e of Object.values(d.entries ?? {})) {
    if (!e || typeof e.id !== "string" || typeof e.title !== "string" || typeof e.importPath !== "string") continue;
    out.push({ id: e.id, title: e.title, name: e.name ?? "", importPath: e.importPath, type: e.type === "docs" ? "docs" : "story", tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string") : [] });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export type ReactSection = "Components" | "Preview Components" | "Compat Components";
const REACT_SECTIONS: ReactSection[] = ["Components", "Preview Components", "Compat Components"];

export interface ReactDocPage {
  id: string;
  title: string;
  section: ReactSection;
  /** Last title segment ("Button", "Counter Badge"). */
  leaf: string;
  /** Package directory under packages/react-components ("react-button"). */
  pkgDir: string;
  /** npm package name ("@fluentui/react-button"). */
  pkg: string;
  /** Repo-relative story index file. */
  storiesFile: string;
  docsUrl: string;
}

const REACT_STORIES = /^\.\.\/\.\.\/packages\/react-components\/([a-z0-9-]+)\/stories\/src\/([^]+?)\/index\.stories\.tsx?$/;

/** Component documentation pages of the React Storybook (one per documented component). */
export function reactComponentPages(entries: SbEntry[]): ReactDocPage[] {
  const out: ReactDocPage[] = [];
  for (const e of entries) {
    if (e.type !== "docs") continue;
    const section = REACT_SECTIONS.find((s) => e.title.startsWith(`${s}/`));
    if (!section) continue;
    const m = REACT_STORIES.exec(e.importPath);
    if (!m) continue;
    const leaf = e.title.split("/").pop()!.trim();
    if (!/^[A-Z]/.test(leaf)) continue; // utilities such as "toMountNodeProps"
    out.push({
      id: e.id,
      title: e.title,
      section,
      leaf,
      pkgDir: m[1]!,
      pkg: `@fluentui/${m[1]!}`,
      storiesFile: e.importPath.replace(/^\.\.\/\.\.\//, ""),
      docsUrl: storybookDocsUrl(SB_REACT, e.id),
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export interface A11ySpecPage {
  id: string;
  /** Component the spec covers ("Button", "MenuButton"). */
  component: string;
  file: string;
  docsUrl: string;
}

export function reactA11ySpecPages(entries: SbEntry[]): A11ySpecPage[] {
  const out: A11ySpecPage[] = [];
  for (const e of entries) {
    const m = /^Concepts\/Developer\/Accessibility\/Components\/([A-Za-z0-9]+)$/.exec(e.title);
    if (!m || e.type !== "docs" || !/\.mdx$/.test(e.importPath) || !e.importPath.startsWith("../../packages/")) continue;
    out.push({ id: e.id, component: m[1]!, file: e.importPath.replace(/^\.\.\/\.\.\//, ""), docsUrl: storybookDocsUrl(SB_REACT, e.id) });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export interface WcDocPage {
  id: string;
  title: string;
  leaf: string;
  /** Source directory under packages/web-components/src ("text-input"). */
  dir: string;
  docsUrl: string;
}

export function wcComponentPages(entries: SbEntry[]): WcDocPage[] {
  const out: WcDocPage[] = [];
  for (const e of entries) {
    if (e.type !== "docs" || !e.title.startsWith("Components/")) continue;
    const m = /^\.\/src\/([a-z0-9-]+)\/[a-z0-9-]+\.stories\.ts$/.exec(e.importPath);
    if (!m) continue;
    out.push({ id: e.id, title: e.title, leaf: e.title.split("/").pop()!.trim(), dir: m[1]!, docsUrl: storybookDocsUrl(SB_WC, e.id) });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Parse a Storybook id from a docs URL (`?path=/docs/<id>`). */
export function storybookIdFromUrl(url: string): string | null {
  const m = /[?&]path=\/docs\/([a-z0-9-]+--[a-z0-9-]+)/.exec(url);
  return m ? m[1]! : null;
}

export interface StoriesMeta {
  title: string | null;
  component: string | null;
  subcomponents: string[];
  /** `import x from './XDescription.md'` -> { local: "x", file: "XDescription.md" } */
  mdImports: { local: string; file: string }[];
  /** Locals listed in parameters.docs.description.component (order preserved). */
  descriptionLocals: string[];
  /** Named story exports (`export { Default } from './ButtonDefault.stories'`). */
  stories: string[];
}

export function parseStoriesFile(text: string): StoriesMeta {
  const mdImports: StoriesMeta["mdImports"] = [];
  for (const m of text.matchAll(/^import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]\.\/([^'"]+\.mdx?)['"]/gm)) mdImports.push({ local: m[1]!, file: m[2]! });
  const def = text.slice(Math.max(0, text.search(/export\s+default\s*\{/)));
  const title = /\btitle\s*:\s*['"]([^'"]+)['"]/.exec(def)?.[1] ?? null;
  const component = /\bcomponent\s*:\s*([A-Za-z_$][\w$]*)/.exec(def)?.[1] ?? null;
  const subcomponents: string[] = [];
  const sub = /\bsubcomponents\s*:\s*\{([^}]*)\}/.exec(def);
  if (sub) {
    for (const part of sub[1]!.split(",")) {
      const m = /^\s*([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?\s*$/.exec(part);
      if (m) subcomponents.push(m[2] ?? m[1]!);
    }
  }
  const descriptionLocals: string[] = [];
  const desc = /description\s*:\s*\{\s*component\s*:\s*([^}]*?)\s*,?\s*\}/.exec(def);
  if (desc) {
    for (const id of desc[1]!.matchAll(/[A-Za-z_$][\w$]*/g)) if (mdImports.some((x) => x.local === id[0])) descriptionLocals.push(id[0]);
  }
  const stories: string[] = [];
  for (const m of text.matchAll(/^export\s*\{\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*\}\s*from/gm)) stories.push(m[2] ?? m[1]!);
  return { title, component, subcomponents: [...new Set(subcomponents)], mdImports, descriptionLocals, stories };
}
