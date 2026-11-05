/** JSON-serializable fragment payloads produced by parse() and merged by normalize(). */
import type { NavEntry, ParsedDocsPage } from "./html";
import type { LlmsComponentEntry } from "./llms";
import type { NpmManifestInfo } from "./npm";
import type { RawAtlToken } from "./tokens";

export interface SourceStamp {
  /** URL actually fetched. */
  url: string;
  /** Human-facing URL for evidence. */
  evidenceUrl: string;
  retrievedAt: string;
  hash: string | null;
}

export interface PinnedPackage {
  packageName: string;
  version: string;
}

export type AtlFragmentData =
  | { type: "index"; stamp: SourceStamp; entries: NavEntry[]; navPaths: string[] }
  | { type: "component-page"; stamp: SourceStamp; componentPath: string; tab: string; page: ParsedDocsPage }
  | { type: "npm"; stamp: SourceStamp; packageName: string; packument: boolean; info: NpmManifestInfo | null }
  | { type: "llms"; stamp: SourceStamp; entries: LlmsComponentEntry[] }
  | { type: "tokens"; stamp: SourceStamp; setSlug: string; file: string; npm: PinnedPackage; tokens: RawAtlToken[] }
  | { type: "token-names"; stamp: SourceStamp; file: string; npm: PinnedPackage; map: Record<string, string> }
  | { type: "guidance-page"; stamp: SourceStamp; page: ParsedDocsPage }
  | { type: "system-page"; stamp: SourceStamp; key: string; page: ParsedDocsPage };

/** Metadata attached to DiscoveredDocument.meta (JSON-serializable). */
export interface AtlDocMeta {
  componentPath?: string;
  tab?: string;
  packageName?: string;
  setSlug?: string;
  file?: string;
  npm?: PinnedPackage;
  key?: string;
  [k: string]: unknown;
}
