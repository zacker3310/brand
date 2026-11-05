/**
 * Routing & streaming correctness.
 *
 * Route-level loading.tsx makes Next flush a 200 shell before the page runs, which turns notFound()
 * into a soft 404 (200 + noindex), redirect() into a client/meta redirect, and leaves clients without
 * JavaScript looking at a skeleton. These tests pin the contract instead:
 *   - every dynamic segment answers an unknown slug with a real HTTP 404 and its designed not-found UI;
 *   - known slugs answer 200;
 *   - redirect() answers with an HTTP 3xx and a Location header;
 *   - primary content is in the initial HTML and visible with JavaScript disabled (no pending
 *     Suspense fallback, no unrevealed streamed segment, no aria-busy skeleton).
 *
 * Read-only against whatever database the server uses; known slugs are discovered through the
 * public API (github-primer / carbon / button are the indexed fixtures the other specs use too).
 * The saved-comparison redirect needs a saved comparison: an existing one is used, otherwise one is
 * created only when E2E_ALLOW_WRITES=1 (never write to a shared dev database by default).
 *
 *   E2E_NO_SERVER=1 E2E_PORT=3110 npx playwright test tests/e2e/routing.spec.ts --project=desktop
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const NOPE = "atlas-e2e-no-such-slug";
const NOPE_UUID = "00000000-0000-4000-8000-000000000000";
const SYSTEM = "github-primer";
const COMPARE = "/compare?type=button&systems=github-primer,carbon";

type Known = {
  component: { href: string; name: string; slug: string };
  pattern: { href: string; slug: string };
  patternType: string;
  collection: string;
  tokenSet: string;
  tokenId: string;
};

async function json<T>(request: APIRequestContext, url: string): Promise<T> {
  const res = await request.get(url);
  expect(res.status(), `GET ${url}`).toBe(200);
  return (await res.json()) as T;
}

/** Real slugs from the public API, so the 200 cases don't depend on hard-coded catalog content. */
let knownCache: Promise<Known> | null = null;
function known(request: APIRequestContext): Promise<Known> {
  knownCache ??= (async () => {
    const comps = await json<{ data: { slug: string; name: string; urls: { atlas: string } }[] }>(request, `/api/systems/${SYSTEM}/components`);
    const pats = await json<{ data: { slug: string; type: { slug: string } | null; urls: { atlas: string } }[] }>(request, `/api/patterns?system=${SYSTEM}`);
    const cols = await json<{ data: { slug: string; isCurated: boolean }[] }>(request, "/api/collections");
    const toks = await json<{ data: { id: string; set: { slug: string } }[] }>(request, `/api/tokens?system=${SYSTEM}`);
    const c = comps.data[0];
    const p = pats.data[0];
    const typed = pats.data.find((x) => x.type);
    const col = cols.data.find((x) => x.isCurated);
    const t = toks.data[0];
    if (!c || !p || !typed?.type || !col || !t) throw new Error(`${SYSTEM} needs indexed components, patterns, tokens and a curated collection`);
    return {
      component: { href: c.urls.atlas, name: c.name, slug: c.slug },
      pattern: { href: p.urls.atlas, slug: p.slug },
      patternType: typed.type.slug,
      collection: col.slug,
      tokenSet: t.set.slug,
      tokenId: t.id,
    };
  })();
  return knownCache;
}

const raw = (request: APIRequestContext, url: string) => request.get(url, { maxRedirects: 0 });

/** A soft 404 would still say noindex; a real one must also carry the status. */
async function expect404(request: APIRequestContext, url: string, notFoundCopy?: string | RegExp) {
  const res = await raw(request, url);
  expect(res.status(), `${url} should be a real 404`).toBe(404);
  if (notFoundCopy) {
    const body = (await res.text()).replace(/&#x27;|&apos;/g, "'");
    if (typeof notFoundCopy === "string") expect(body, `${url} renders its not-found UI`).toContain(notFoundCopy);
    else expect(body).toMatch(notFoundCopy);
  }
}

/**
 * Whether this client may use /ops (localhost mode or an admin session). A 200 that carries a
 * streamed NEXT_REDIRECT is the soft redirect this spec exists to catch, not access.
 */
async function opsAccess(request: APIRequestContext): Promise<"granted" | "denied"> {
  const res = await raw(request, "/ops");
  if (res.status() >= 300 && res.status() < 400) return "denied";
  expect(res.status(), "/ops").toBe(200);
  expect((await res.text()).includes("NEXT_REDIRECT"), "/ops answered 200 with a streamed redirect instead of an HTTP redirect").toBe(false);
  return "granted";
}

async function expect200(request: APIRequestContext, url: string) {
  const res = await raw(request, url);
  expect(res.status(), `${url} should be 200`).toBe(200);
  return res;
}

test.describe("unknown slugs are real 404s on every dynamic route", () => {
  test("systems/[slug] and everything under it", async ({ request }) => {
    const designed = "This design system isn't in the index";
    await expect404(request, `/systems/${NOPE}`, designed);
    await expect404(request, `/systems/${NOPE}/components`, designed);
    await expect404(request, `/systems/${NOPE}/patterns`, designed);
    await expect404(request, `/systems/${SYSTEM}/components/${NOPE}`, "This component isn't in ATLAS's index");
    await expect404(request, `/systems/${NOPE}/components/${NOPE}`, "This component isn't in ATLAS's index");
    await expect404(request, `/systems/${SYSTEM}/patterns/${NOPE}`, "Pattern not in the index");
    await expect404(request, `/systems/${NOPE}/patterns/${NOPE}`, "Pattern not in the index");
  });

  test("components/[type], patterns/[type], collections/[slug], compare/s/[slug]", async ({ request }) => {
    await expect404(request, `/components/${NOPE}`, "Not an ATLAS canonical type");
    await expect404(request, `/patterns/${NOPE}`, "Not an ATLAS pattern type");
    await expect404(request, `/collections/${NOPE}`, "Collection not found");
    await expect404(request, "/compare/s/ZZZZZZZZ", "Not in the ATLAS taxonomy"); // well-formed, unknown
    await expect404(request, "/compare/s/x", "Not in the ATLAS taxonomy"); // malformed
  });

  test("query-addressed records: compare type, token system, token scales, add-to-collection", async ({ request }) => {
    await expect404(request, `/compare?type=${NOPE}&systems=github-primer,carbon`, "Not in the ATLAS taxonomy");
    await expect404(request, `/tokens?system=${NOPE}`, "Not in the index");
    await expect404(request, `/tokens/compare?systems=${NOPE}`, "Not in the index");
    await expect404(request, `/collections/add?type=component&id=${NOPE_UUID}`);
  });

  test("unmatched URLs use the root not-found", async ({ request }) => {
    await expect404(request, `/${NOPE}`, "Not in the index");
    await expect404(request, `/systems/${SYSTEM}/${NOPE}`, "Not in the index");
  });

  test("ops/runs/[id]: auth first, then a real 404", async ({ request }) => {
    if ((await opsAccess(request)) === "denied") {
      // No admin access from this client: unknown ids must not leak existence, just redirect to login.
      const res = await raw(request, `/ops/runs/${NOPE_UUID}`);
      expect(res.status()).toBe(307);
      expect(res.headers().location).toContain("/ops/login?next=%2Fops%2Fruns%2F");
    } else {
      await expect404(request, `/ops/runs/${NOPE_UUID}`, "Run not found");
      await expect404(request, "/ops/runs/not-a-uuid", "Run not found");
    }
  });

  test("route handlers under dynamic segments", async ({ request }) => {
    const k = await known(request);
    for (const url of [
      `/api/systems/${NOPE}`,
      `/api/systems/${NOPE}/components`,
      `/api/components/${SYSTEM}/${NOPE}`,
      `/api/collections/${NOPE}`,
      `/api/collections/${NOPE}/export`,
      "/api/comparisons/ZZZZZZZZ",
      `/api/export/${NOPE}`,
      `/tokens/export/${SYSTEM}/${NOPE}`,
      `/tokens/export/${NOPE}/${k.tokenSet}`,
      `/tokens/inspect/${NOPE_UUID}`,
    ]) {
      expect((await raw(request, url)).status(), url).toBe(404);
    }
    expect((await raw(request, `/tokens/inspect/${NOPE}`)).status()).toBe(400); // malformed id
  });
});

test.describe("known slugs are 200", () => {
  test("pages", async ({ request }) => {
    const k = await known(request);
    for (const url of [
      `/systems/${SYSTEM}`,
      `/systems/carbon`,
      `/systems/${SYSTEM}/patterns`,
      k.component.href,
      k.pattern.href,
      "/components/button",
      `/patterns/${k.patternType}`,
      `/collections/${k.collection}`,
      COMPARE,
      `/tokens?system=${SYSTEM}`,
      `/tokens?system=${SYSTEM}&set=${k.tokenSet}`,
    ]) {
      const res = await expect200(request, url);
      expect(await res.text(), `${url} must not be a soft 404`).not.toContain('name="robots" content="noindex"');
    }
  });

  test("route handlers", async ({ request }) => {
    const k = await known(request);
    for (const url of [
      `/api/systems/${SYSTEM}`,
      `/api/systems/${SYSTEM}/components`,
      `/api/components/${SYSTEM}/${k.component.slug}`,
      `/api/collections/${k.collection}`,
      `/api/export/systems.json`,
      `/tokens/export/${SYSTEM}/${k.tokenSet}`,
      `/tokens/inspect/${k.tokenId}`,
    ]) {
      await expect200(request, url);
    }
  });
});

test.describe("redirect() is an HTTP redirect", () => {
  test("/systems/[slug]/components -> the catalog filtered to that system", async ({ request }) => {
    const res = await raw(request, `/systems/${SYSTEM}/components`);
    expect(res.status()).toBe(307);
    expect(res.headers().location).toBe(`/components?view=components&system=${SYSTEM}`);
  });

  test("/ops without admin access -> /ops/login", async ({ request }) => {
    test.skip((await opsAccess(request)) === "granted", "this client has admin access (localhost mode or session), so /ops does not redirect");
    const res = await raw(request, "/ops");
    expect(res.status()).toBe(307);
    expect(res.headers().location).toMatch(/^\/ops\/login\?next=%2Fops&reason=/);
  });

  test("/compare/s/[slug] -> the canonical comparison URL", async ({ request }) => {
    const list = await json<{ data: { featured: { slug: string }[]; mine: { slug: string }[] } }>(request, "/api/comparisons");
    let slug = [...list.data.featured, ...list.data.mine][0]?.slug;
    if (!slug && process.env.E2E_ALLOW_WRITES === "1") {
      const res = await request.post("/api/comparisons", { data: { type: "button", systems: ["github-primer", "carbon"], title: "E2E routing redirect" } });
      expect(res.status()).toBe(201);
      slug = ((await res.json()) as { data: { slug: string } }).data.slug;
    }
    test.skip(!slug, "no saved comparison in this database (set E2E_ALLOW_WRITES=1 to create one)");
    const res = await raw(request, `/compare/s/${slug}`);
    expect(res.status()).toBe(307);
    expect(res.headers().location).toMatch(new RegExp(`^/compare(/systems)?\\?.*saved=${slug}`));
  });
});

test.describe("without JavaScript the primary content is in the initial HTML", () => {
  test.use({ javaScriptEnabled: false });

  /** Status 200, the h1, and nothing left behind a Suspense fallback or skeleton. */
  async function open(page: Page, url: string, h1: string | RegExp) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBe(200);
    const main = page.locator("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(h1);
    // Pending Suspense boundaries leave <template id="B:n"> placeholders; streamed-but-unrevealed
    // content sits in <div hidden id="S:n"> until a script swaps it in. Neither may exist.
    await expect(page.locator('template[id^="B:"]')).toHaveCount(0);
    await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0);
    await expect(main.locator('[aria-busy="true"]')).toHaveCount(0);
    return main;
  }

  test("home", async ({ page }) => {
    const main = await open(page, "/", /design systems, indexed with their sources/);
    await expect(main.locator(`a[href="/systems/${SYSTEM}"]`).first()).toBeVisible();
  });

  test("/systems", async ({ page }) => {
    const main = await open(page, "/systems", "Design systems");
    await expect(main.locator(`a[href="/systems/${SYSTEM}"]`).first()).toBeVisible();
    await expect(main.locator('a[href="/systems/carbon"]').first()).toBeVisible();
  });

  test("system detail", async ({ page }) => {
    const main = await open(page, `/systems/${SYSTEM}`, "GitHub Primer");
    await expect(main.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Components", exact: true })).toBeVisible();
    await expect(main.locator(`a[href^="/systems/${SYSTEM}/components/"]`).first()).toBeVisible();
  });

  test("/components", async ({ page }) => {
    const main = await open(page, "/components", "Components");
    await expect(main.locator('a[href="/components/button"]').first()).toBeVisible();
  });

  test("component detail", async ({ page, request }) => {
    const k = await known(request);
    const main = await open(page, k.component.href, k.component.name);
    // Section headings carry their coverage chip ("Overview Documented").
    await expect(main.getByRole("region", { name: /^Overview\b/ })).toBeVisible();
    await expect(main.locator(`a[href="/systems/${SYSTEM}"]`).first()).toBeVisible();
  });

  test("component comparison", async ({ page }) => {
    const main = await open(page, COMPARE, "Button");
    const matrix = main.getByRole("table", { name: /^Button compared across GitHub Primer, IBM Carbon Design System\./ });
    await expect(matrix).toBeVisible();
    await expect(matrix.getByRole("columnheader", { name: /^GitHub Primer/ })).toBeVisible();
    await expect(matrix.getByRole("columnheader", { name: /^IBM Carbon Design System/ })).toBeVisible();
    expect(await matrix.getByRole("row").count()).toBeGreaterThan(3);
  });

  test("/tokens", async ({ page }) => {
    const main = await open(page, "/tokens", /\S/);
    await expect(main.getByText(/[\d,]+ tokens in [\d,]+ sets?/).first()).toBeVisible();
  });

  test("/patterns", async ({ page }) => {
    const main = await open(page, "/patterns", "Patterns");
    await expect(main.locator('a[href^="/patterns/"]').first()).toBeVisible();
  });

  test("/collections", async ({ page }) => {
    const main = await open(page, "/collections", "Collections");
    await expect(main.locator('a[href^="/collections/"]').first()).toBeVisible();
  });

  test("/about", async ({ page }) => {
    const main = await open(page, "/about", "How ATLAS knows what it shows.");
    await expect(main.getByRole("heading", { name: /Sources & access policy/ })).toBeVisible();
  });
});
