/**
 * Fragment shapes persisted between parse() and normalize() for the "mui" adapter.
 * Everything is JSON-serializable.
 */
import type { ApiDoc, ApiTranslations } from "./api-json";
import type { BaseIndexEntry, BasePage, BasePart, BaseTextPage } from "./baseui";
import type { MuiSystem } from "./constants";
import type { MuiMdDoc } from "./markdown";
import type { NavPage } from "./nav";
import type { Prov } from "./shared";
import type { TokenFileData, TokenRole } from "./tokens";

/** npm version pin resolved during discover() and carried on every document. */
export interface NpmPin {
  pkg: string;
  version: string;
  publishedAt: string | null;
  license: string | null;
  deprecated: string | null;
  /** Git tag in the source repository that published this version. */
  tag: string;
  /** How the tag was derived (evidence). */
  tagMethod: string;
  npmUrl: string;
}

export interface DocMeta extends Record<string, unknown> {
  system: MuiSystem;
  file: string;
  pin: NpmPin;
  /** Text documents: overview | lab | css-vars | about | styling | forms | accessibility */
  role?: string;
  slug?: string;
  pathname?: string;
  pageUrl?: string;
  tokenRole?: TokenRole;
  hue?: string;
}

export type MuiFragment =
  | { kind: "nav"; prov: Prov; meta: DocMeta; pages: NavPage[] }
  | { kind: "pages-api"; prov: Prov; meta: DocMeta; slugs: string[] }
  | { kind: "md"; prov: Prov; meta: DocMeta; pathname: string; pageUrl: string; doc: MuiMdDoc }
  | { kind: "text"; prov: Prov; meta: DocMeta; role: string; pageUrl: string | null; doc: MuiMdDoc; statements: Record<string, string | null> }
  | { kind: "api"; prov: Prov; meta: DocMeta; slug: string; api: ApiDoc }
  | { kind: "api-tr"; prov: Prov; meta: DocMeta; slug: string; tr: ApiTranslations }
  | { kind: "pkg"; prov: Prov; meta: DocMeta; name: string | null; version: string | null; peerReact: string | null }
  | { kind: "license"; prov: Prov; meta: DocMeta; copyright: string | null }
  | { kind: "tokens"; prov: Prov; meta: DocMeta; npmUrl: string; data: TokenFileData }
  | { kind: "base-index"; prov: Prov; meta: DocMeta; entries: BaseIndexEntry[] }
  | { kind: "base-page"; prov: Prov; meta: DocMeta; slug: string; pageUrl: string; page: BasePage }
  | { kind: "base-types"; prov: Prov; meta: DocMeta; slug: string; parts: BasePart[] }
  | { kind: "base-text"; prov: Prov; meta: DocMeta; role: string; pageUrl: string; page: BaseTextPage; statements: Record<string, string | null> };

export type FragOf<K extends MuiFragment["kind"]> = Extract<MuiFragment, { kind: K }>;

export function byKind<K extends MuiFragment["kind"]>(frags: MuiFragment[], kind: K): FragOf<K>[] {
  return frags.filter((f): f is FragOf<K> => f.kind === kind);
}
