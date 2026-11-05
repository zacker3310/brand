/** JSON-serializable fragment payloads produced by parse() and merged by normalize(). */
import type { WcElement } from "./cem";
import type { IndexPage, PatternPage, SystemPage, WcPage } from "./devdocs";
import type { DtsMember } from "./dts";
import type { ReactMdxDoc, Redirect } from "./mdx";
import type { Stamp } from "./text";
import type { ThemeBlock } from "./tokens";

export interface NpmInfo {
  packageName: string;
  version: string;
  publishedAt: string | null;
  license: string | null;
  deprecated: string | null;
}

export interface ReactProp extends DtsMember {
  from: string;
  file: string;
  allowedValues: string[] | null;
}

export interface StoryRef {
  title: string;
  id: string;
  name: string;
  importPath: string;
}

export type PolarisFragmentData =
  | { type: "cem"; stamp: Stamp; npm: NpmInfo; file: string; schemaVersion: string | null; elements: WcElement[] }
  | { type: "wc-index"; stamp: Stamp; page: IndexPage }
  | { type: "wc-page"; stamp: Stamp; slug: string; section: string | null; summary: string | null; page: WcPage }
  | { type: "patterns-index"; stamp: Stamp; page: IndexPage }
  | { type: "pattern-page"; stamp: Stamp; slug: string; group: string | null; summary: string | null; page: PatternPage }
  | { type: "system-page"; stamp: Stamp; key: string; page: SystemPage }
  | { type: "redirects"; stamp: Stamp; redirects: Redirect[] }
  | { type: "react-mdx"; stamp: Stamp; file: string; doc: ReactMdxDoc }
  | { type: "react-index"; stamp: Stamp; npm: NpmInfo; file: string; exports: string[] }
  | { type: "react-dts"; stamp: Stamp; npm: NpmInfo; docPath: string | null; dir: string; file: string; propsName: string; found: boolean; props: ReactProp[]; unresolved: string[]; files: string[] }
  | { type: "storybook"; stamp: Stamp; stories: StoryRef[] }
  | { type: "tokens-css"; stamp: Stamp; npm: NpmInfo; file: string; blocks: ThemeBlock[] }
  | { type: "tokens-meta"; stamp: Stamp; npm: NpmInfo; file: string; descriptions: Record<string, string> }
  | { type: "license"; stamp: Stamp; key: string; copyright: string | null; fieldOfUse: boolean }
  | { type: "archive-readme"; stamp: Stamp; archived: boolean; statement: string | null };

/** Metadata attached to DiscoveredDocument.meta (JSON-serializable). */
export interface PolarisDocMeta {
  npm?: NpmInfo;
  file?: string;
  slug?: string;
  section?: string | null;
  summary?: string | null;
  group?: string | null;
  key?: string;
  docPath?: string;
  dir?: string;
  propsName?: string;
  [k: string]: unknown;
}
