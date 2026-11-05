/** JSON-serializable fragment payloads produced by parse() and merged by normalize(). */
import type { NormalizedToken } from "@/lib/contracts";
import type { ComponentsJsonData } from "./components-json";
import type { CssVarUsage } from "./css-usage";
import type { ParsedComponentPage, ParsedSimplePage } from "./docs-pages";

export interface SourceStamp {
  /** URL actually fetched. */
  url: string;
  /** Human-facing URL for evidence. */
  evidenceUrl: string;
  retrievedAt: string;
  hash: string | null;
}

export interface NpmInfo {
  packageName: string;
  version: string;
  publishedAt: string | null;
  license: string | null;
}

export type PrimerFragmentData =
  | { type: "sitemap"; stamp: SourceStamp; urls: string[] }
  | { type: "components-json"; stamp: SourceStamp; npm: NpmInfo; file: string; data: ComponentsJsonData }
  | { type: "license"; stamp: SourceStamp; npm: NpmInfo; copyright: string | null }
  | { type: "css"; stamp: SourceStamp; npm: NpmInfo; file: string; dir: string; usages: CssVarUsage[] }
  | { type: "tokens"; stamp: SourceStamp; npm: NpmInfo; setSlug: string; file: string; tokens: NormalizedToken[]; warnings: string[] }
  | { type: "component-page"; stamp: SourceStamp; page: ParsedComponentPage }
  | { type: "pattern-page"; stamp: SourceStamp; section: string; sectionLabel: string; page: ParsedSimplePage }
  | { type: "system-page"; stamp: SourceStamp; key: string; page: ParsedSimplePage };

/** Metadata attached to DiscoveredDocument.meta (JSON-serializable). */
export interface PrimerDocMeta {
  npm?: NpmInfo;
  file?: string;
  dir?: string;
  setSlug?: string;
  theme?: string | null;
  pageType?: "overview" | "guidelines" | "accessibility" | "other";
  section?: string;
  sectionLabel?: string;
  key?: string;
  [k: string]: unknown;
}
