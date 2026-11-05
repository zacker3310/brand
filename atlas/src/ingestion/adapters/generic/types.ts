/**
 * Generic adapter target configuration (contract between the generic adapter implementation and
 * the per-system target research files). OWNERSHIP: integrator.
 *
 * The generic adapter produces METADATA-LEVEL component records (name, docs URL, short description
 * when statically present) for systems without a dedicated adapter. Every other field is reported as
 * "not-extracted". Classification is always "inferred".
 */
export interface GenericTarget {
  /** Registry slug (must be a verified registry entry without a dedicated adapter). */
  slug: string;
  /**
   * sitemap:      component pages enumerated from a sitemap (explicit sitemapUrl or robots.txt Sitemap: lines)
   * nav:          component pages enumerated from links on an official index page (navUrl, optional navSelector)
   * repo-listing: component names enumerated from a public repository/package file listing via jsDelivr
   */
  strategy: "sitemap" | "nav" | "repo-listing";
  sitemapUrl?: string;
  navUrl?: string;
  /** CSS selector scoping the links considered on navUrl. */
  navSelector?: string;
  /**
   * RegExp source matched against the absolute URL (sitemap/nav) or file path (repo-listing).
   * MUST contain one capture group yielding the component path segment, e.g. "^https://primer\\.style/product/components/([a-z0-9-]+)/?$".
   */
  include: string;
  /** RegExp sources; any match excludes the URL/path (overview, getting-started, changelog...). */
  exclude?: string[];
  /** For repo-listing: jsDelivr listing coordinates. */
  repo?: { kind: "gh" | "npm"; name: string; ref: string; docsUrlTemplate?: string };
  /** Build the human docs URL from the captured segment when it differs from the matched URL. "{segment}" placeholder. */
  docsUrlTemplate?: string;
  /** Framework slug(s) (from taxonomy FRAMEWORKS) implemented by these components, if the system has a single official implementation. */
  frameworks?: string[];
  /** Fetch each component page to read <title>/<h1>/meta description (default true; capped by maxPages). */
  fetchPages?: boolean;
  maxPages?: number;
  maxComponents?: number;
  /** Strip from page titles, e.g. " – Bootstrap v5.3". RegExp source. */
  titleSuffix?: string;
  /** Research notes: why this source is authoritative, robots status, caveats. */
  notes: string;
}
