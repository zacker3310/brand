/** JSON-serializable fragment payloads produced by parse() and merged by normalize(). */
import type { ParsedDoc } from "./markdown";
import type { AliasDerivation, DistCssVars, Literal, MobileThemeCss, TokenJsonEntry, TokenMeta } from "./tokens";

export interface Stamp {
  /** URL actually fetched. */
  url: string;
  /** Human-facing URL for evidence. */
  evidenceUrl: string;
  retrievedAt: string;
  hash: string | null;
  /** Repository / package path of the file. */
  file: string;
}

export interface PkgInfo {
  name: string;
  version: string;
  publishedAt: string | null;
  license: string | null;
  gitHead: string | null;
  /** Git ref used for repository files (tag or commit). */
  ref: string;
}

export type AntdFragment =
  | { t: "pkg"; stamp: Stamp; pkg: PkgInfo; /** peerDependencies names from the version manifest. */ peers: string[] }
  | { t: "license"; stamp: Stamp; copyright: string | null; spdx: string | null }
  | { t: "sitemap"; stamp: Stamp; components: string[]; spec: string[]; trailingSlash: boolean }
  | { t: "component-doc"; stamp: Stamp; slug: string; dir: string; docsUrl: string | null; order: number; doc: ParsedDoc; embedded?: Stamp[] }
  | { t: "spec-doc"; stamp: Stamp; slug: string; docsUrl: string; doc: ParsedDoc }
  | { t: "demo"; stamp: Stamp; slug: string; demo: string; title: string | null; code: string | null; anchor: string | null }
  | { t: "token-meta"; stamp: Stamp; meta: TokenMeta }
  | { t: "token-json"; stamp: Stamp; entries: Record<string, TokenJsonEntry> }
  | { t: "dist-css"; stamp: Stamp; css: DistCssVars }
  | { t: "seed-js"; stamp: Stamp; values: Record<string, Literal>; presetColors: Record<string, string> }
  | { t: "alias-js"; stamp: Stamp; consts: Record<string, number>; entries: Record<string, AliasDerivation> }
  | { t: "preset-dts"; stamp: Stamp; presets: string[]; palettes: boolean }
  | { t: "index-dts"; stamp: Stamp; exports: Record<string, string[]> }
  | { t: "style-refs"; stamp: Stamp; component: string; refs: Record<string, string> }
  // Ant Design Mobile
  | { t: "m-nav"; stamp: Stamp; groups: { group: string; routes: string[] }[] }
  | { t: "m-component-doc"; stamp: Stamp; slug: string; route: string; docsUrl: string; group: string | null; order: number; doc: ParsedDoc }
  | { t: "m-theme-css"; stamp: Stamp; part: "default" | "dark"; theme: MobileThemeCss }
  | { t: "m-guide"; stamp: Stamp; key: string; docsUrl: string; doc: ParsedDoc; deprecatedVars: { name: string; since: string | null; replacement: string | null }[] };

export interface AntdDocMeta {
  systemSlug: string;
  file: string;
  pkg?: PkgInfo;
  slug?: string;
  dir?: string;
  route?: string;
  group?: string | null;
  docsUrl?: string | null;
  order?: number;
  demo?: string;
  demoTitle?: string | null;
  anchor?: string | null;
  component?: string;
  part?: "default" | "dark";
  key?: string;
  trailingSlash?: boolean;
  fallbackUrl?: string;
  [k: string]: unknown;
}
