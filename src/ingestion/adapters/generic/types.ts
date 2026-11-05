/**
 * Generic adapter target configuration (contract between the generic adapter implementation and
 * the per-system target research files). OWNERSHIP: integrator.
 *
 * The generic adapter produces METADATA-LEVEL component records (name, docs URL, short description
 * when statically present) for systems without a dedicated adapter. Every other field is reported as
 * "not-extracted". Classification is always "inferred".
 *
 * Versioning: a target is configuration, not parser code. Parsed fragments are a pure function of the
 * fetched document (they never depend on any target), and every rule below is applied in normalize(),
 * which runs on every publish. Editing a target therefore only changes that system's normalize output;
 * it never invalidates parsed fragments of any system (see ADAPTER_VERSION in ./normalize.ts).
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
  /**
   * CSS selector scoping the links considered on navUrl. It is evaluated against the page's link
   * outline (links, their ancestors with tag/id/class/attributes, and short labels of the ancestors'
   * other children), so selectors may use ancestry, attributes, sibling labels and :has()/:contains()
   * on those labels, but not text deep inside non-link subtrees.
   */
  navSelector?: string;
  /**
   * RegExp source matched against the absolute URL (sitemap/nav) or file path (repo-listing).
   * MUST contain one capture group yielding the component path segment, e.g. "^https://primer\\.style/product/components/([a-z0-9-]+)/?$".
   */
  include: string;
  /** RegExp sources; any match excludes the URL/path (overview, getting-started, changelog...). */
  exclude?: string[];
  /**
   * RegExp source. When several documents capture the same component (tab or sub-pages of one
   * component, URL variants), the one matching this pattern is used as the docs URL; otherwise the
   * shortest (then lexicographically first) URL wins.
   */
  preferDoc?: string;
  /** For repo-listing: jsDelivr listing coordinates. */
  repo?: { kind: "gh" | "npm"; name: string; ref: string; docsUrlTemplate?: string };
  /**
   * Build the human docs URL from the captured segment when it differs from the matched URL.
   * Placeholders: {segment} (captured segment as is), {segmentLower} (lowercased segment),
   * {path} (matched file path, repo-listing), {dir} (its directory), {ref} (resolved repo ref).
   */
  docsUrlTemplate?: string;
  /**
   * Docs pages are client-rendered shells (a static fetch cannot confirm a page). Constructed docs URLs
   * are then recorded WITHOUT page confirmation: the docsUrl evidence is "unverified" with low confidence
   * and says "docs URL not confirmed by static fetch", coverage.docsUrl is "inferred" and the
   * classification confidence is lowered. Only set this when the URL pattern itself was verified against
   * the source (e.g. a Storybook index); never to paper over an unverified guess.
   */
  acceptShellDocs?: boolean;
  /** Framework slug(s) (from taxonomy FRAMEWORKS) implemented by these components, if the system has a single official implementation. */
  frameworks?: string[];
  /** Fetch each component page to read <title>/<h1>/meta description (default true; capped by maxPages). */
  fetchPages?: boolean;
  maxPages?: number;
  maxComponents?: number;
  /**
   * Site decoration stripped from page titles, headings and nav texts, e.g. " – Bootstrap v5.3".
   * RegExp source, or several applied in order (each globally, repeated until nothing changes), e.g.
   * ["\\s*\\|.*$", "^Angular\\s+", "\\s+Overview$"].
   */
  titleSuffix?: string | string[];
  /** Research notes: why this source is authoritative, robots status, caveats. */
  notes: string;
}
