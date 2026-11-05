/**
 * Registry verification helper (used by researchers and `npm run registry:verify`).
 *
 *   npx tsx scripts/registry/check.ts https://primer.style https://github.com/primer/react
 *   npx tsx scripts/registry/check.ts --npm @primer/react --npm @primer/primitives
 *   npx tsx scripts/registry/check.ts --raw https://raw.githubusercontent.com/primer/react/main/LICENSE
 *
 * Prints JSON lines: HTTP status, final URL after redirects, <title>, meta description,
 * robots allowance, and for --npm: latest version, publish date, license, deprecation, repo.
 * Uses the polite fetcher (robots-aware, rate-limited, identified User-Agent).
 */
import * as cheerio from "cheerio";
import { excerpt, npmLatest, PoliteFetcher } from "../../src/ingestion/http";

async function main() {
  const args = process.argv.slice(2);
  const http = new PoliteFetcher({ hostDelayMs: 300, cacheDir: null });
  const npm: string[] = [];
  const urls: string[] = [];
  let raw = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--npm") npm.push(args[++i]!);
    else if (a === "--raw") raw = true;
    else urls.push(a);
  }
  await Promise.all(
    urls.map(async (url) => {
      const robotsAllowed = await http.isAllowed(url).catch(() => null);
      const res = await http.get(url, { skipRobots: true, timeoutMs: 20_000, maxRetries: 1 });
      let title: string | null = null;
      let description: string | null = null;
      let bodyExcerpt: string | null = null;
      if (res.body && /html/.test(res.contentType ?? "")) {
        const $ = cheerio.load(res.body);
        title = excerpt($("title").first().text(), 200);
        description = excerpt($('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? null, 300);
      } else if (res.body && raw) {
        bodyExcerpt = excerpt(res.body, 600);
      }
      console.log(
        JSON.stringify({
          url,
          status: res.status,
          ok: res.ok,
          finalUrl: res.finalUrl,
          robotsAllowed,
          contentType: res.contentType,
          title,
          description,
          bodyExcerpt,
          error: res.error,
          checkedAt: res.fetchedAt,
        }),
      );
    }),
  );
  for (const p of npm) {
    const info = await npmLatest(http, p);
    console.log(JSON.stringify({ npm: p, ...info, checkedAt: new Date().toISOString() }));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
