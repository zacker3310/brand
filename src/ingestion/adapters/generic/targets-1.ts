import type { GenericTarget } from "./types";

/**
 * Targets researched by generic workstream 1.
 * Every source below was checked with PoliteFetcher (robots.txt allowance included) on 2026-11-05.
 */
export const TARGETS_1: GenericTarget[] = [
  {
    slug: "bootstrap",
    strategy: "nav",
    navUrl: "https://getbootstrap.com/docs/5.3/getting-started/introduction/",
    navSelector: "#bd-docs-nav",
    include: "^https://getbootstrap\\.com/docs/5\\.3/(?:components|forms)/([a-z0-9-]+)/?$",
    exclude: ["/forms/(?:overview|layout|validation)/?$"],
    frameworks: ["html-css"],
    titleSuffix: "\\s*·\\s*Bootstrap v5\\.3$",
    notes:
      "Static Hugo sidebar (#bd-docs-nav) of the v5.3 docs (the registry pins docsUrl to v5.3, the latest stable). getbootstrap.com/sitemap-0.xml only lists the 6.0 docs, so it is not used. robots.txt allows all. Components = the 'Components' section plus the form controls from 'Forms'; forms overview/layout/validation are guides and excluded.",
  },
];
