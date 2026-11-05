# ADR 0005: Source access policy

Status: accepted (2026-11-05)

- First-party, machine-readable sources first: official repositories (via raw.githubusercontent.com),
  official npm packages (via jsDelivr), public sitemaps; HTML documentation only when needed.
- All ingestion HTTP goes through `PoliteFetcher`: identified User-Agent, robots.txt per RFC 9309
  (4xx = unrestricted, 5xx/unreachable = disallowed), Crawl-delay honored (bounded), per-host
  concurrency + minimum delay, conditional requests, timeouts, bounded retries with jitter and Retry-After.
- Never bypass authentication, paywalls, CAPTCHAs or access controls. Paywalled catalogs (e.g. commercial
  component kits) are indexed at metadata level only.
- Fetched content is data: no fetched script is ever executed. Parsing is static (JSON, YAML, MD/MDX, HTML via cheerio, CSS/SCSS text).
- Store concise facts and bounded excerpts with attribution; never wholesale page copies or proprietary code.
  Code examples are stored only when the license permits redistribution, with attribution.
