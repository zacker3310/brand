/** Parse-fragment payloads of the Spectrum adapter (JSON-serializable; persisted between stages). */
import type { LlmsEntry, MdPage, MdxMeta } from "./docs-md";
import type { ComponentSchema } from "./schema";
import type { Ev } from "./shared";
import type { A11yFragment, Principles, SiteImpl, SitePage, SiteProp, SiteRow, StateSupport } from "./site";
import type { RawToken } from "./tokens";

export type ReactSystem = "react-spectrum" | "react-aria";

export type SpectrumFragment =
  | { t: "pkg"; name: string; version: string; publishedAt: string | null; license: string | null; ev: Ev }
  | { t: "tokens"; file: string; tokens: RawToken[]; ev: Ev }
  | { t: "cssvars"; names: string[]; pkg: string; version: string; ev: Ev }
  | { t: "schema"; name: string; schema: ComponentSchema; ev: Ev }
  | { t: "site-index"; rows: SiteRow[]; ev: Ev }
  | {
      t: "site-page";
      slug: string;
      impl: SiteImpl;
      path: string;
      page: SitePage;
      data: { props: SiteProp[]; status: string | null } | null;
      dataEv: Ev | null;
      ev: Ev;
    }
  | { t: "site-fragment"; slug: string; section: string; states: StateSupport[] | null; a11y: A11yFragment | null; links: string[]; ev: Ev }
  | { t: "principles"; data: Principles; url: string; ev: Ev }
  | { t: "llms"; entries: LlmsEntry[]; ev: Ev }
  | { t: "listing"; pkg: string; version: string; exports: string[]; srcFiles: string[]; ev: Ev }
  | { t: "md"; page: string; md: MdPage; docsUrl: string; ev: Ev }
  | { t: "mdx"; page: string; meta: MdxMeta; ref: string; ev: Ev }
  | { t: "src"; page: string; url: string; ev: Ev }
  | { t: "hook"; component: string; hook: string; md: MdPage; docsUrl: string; ev: Ev }
  | { t: "guide"; page: string; md: MdPage; docsUrl: string; ev: Ev }
  | { t: "quality"; md: MdPage; docsUrl: string; ev: Ev };

export type Frag<T extends SpectrumFragment["t"]> = Extract<SpectrumFragment, { t: T }>;

export function fragsOf(fragments: { data: unknown }[]): SpectrumFragment[] {
  return fragments.map((f) => f.data as SpectrumFragment).filter((f) => !!f && typeof f === "object" && typeof (f as { t?: unknown }).t === "string");
}

export function pick<T extends SpectrumFragment["t"]>(frs: SpectrumFragment[], t: T): Frag<T>[] {
  return frs.filter((f): f is Frag<T> => f.t === t);
}
