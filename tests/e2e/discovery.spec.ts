import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test, type Page } from "@playwright/test";

/**
 * Discovery surfaces: home, directory (/systems), system detail, search.
 * Runs against the real index; assertions check structure and consistency between counts, not
 * hard-coded numbers, so they hold as more systems are ingested.
 */

async function expectNoSeriousA11yViolations(page: Page) {
  // Full page, shell included: no exclusions.
  const results = await new AxeBuilder({ page } as unknown as ConstructorParameters<typeof AxeBuilder>[0])
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

// Dev servers recompile on first hit; give navigation-driven assertions room.
test.setTimeout(90_000);
const expect = baseExpect.configure({ timeout: 15_000 });

const num = (s: string | null | undefined) => Number((s ?? "").replace(/[^\d]/g, ""));

test.describe("home", () => {
  test("renders live library statistics, derived sections and a working search form", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("design systems");

    const ledger = page.getByRole("complementary", { name: "The library" });
    const verified = num(await ledger.locator("div", { hasText: "Verified systems" }).locator("dd").first().textContent());
    expect(verified).toBeGreaterThan(0);
    // The depth breakdown partitions the verified systems.
    const depth = /(\d+) systems? deeply indexed · (?:(\d+) component inventor(?:y|ies) · )?(\d+) metadata-level/;
    await expect(ledger).toContainText(depth);
    const [, deep, inventory, meta] = depth.exec((await ledger.textContent()) ?? "")!;
    expect(num(deep) + num(inventory) + num(meta)).toBe(verified);

    // featured systems are derived (rule label present) and link to detail pages
    const featured = page.locator("section#featured");
    await expect(featured).toContainText("Ranked by published components + tokens");
    expect(await featured.locator("a[href^='/systems/']").count()).toBeGreaterThan(0);

    // component categories link to the catalog with a group filter
    expect(await page.locator("section#categories a[href^='/components?group=']").count()).toBeGreaterThanOrEqual(10);

    // suggested comparisons point at /compare with a type and >= 3 systems
    const firstCompare = page.locator("section#comparisons a[href^='/compare?type=']").first();
    if (await firstCompare.count()) {
      const href = await firstCompare.getAttribute("href");
      const systems = new URL(href!, "http://x").searchParams.get("systems")!.split(",");
      expect(systems.length).toBeGreaterThanOrEqual(3);
    }

    await expect(page.getByRole("heading", { name: "Unknown is never shown as none" })).toBeVisible();
    await expect(page.getByRole("link", { name: /How ATLAS verifies data/ })).toHaveAttribute("href", "/about");

    const q = page.locator("#home-q");
    await q.fill("button");
    await q.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=button/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("button");
  });

  test("is accessible and does not scroll horizontally", async ({ page }) => {
    await page.goto("/");
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe("directory (/systems)", () => {
  test("lists every verified system with a derived count", async ({ page }) => {
    await page.goto("/systems");
    await expect(page.getByRole("heading", { level: 1, name: "Design systems" })).toBeVisible();
    const count = num(await page.locator("#results-heading span").first().textContent());
    expect(count).toBeGreaterThanOrEqual(100);
    expect(await page.locator("main article").count()).toBe(count);
    // metadata-only systems say so instead of showing zero counts
    await expect(page.locator("main article").getByText("Metadata only").first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("facets filter through the URL with consistent counts, and chips clear them", async ({ page }) => {
    await page.goto("/systems");
    // auto-apply is a progressive enhancement: wait until the form is hydrated
    await page.locator("form[data-enhanced]").waitFor();
    const option = page.locator("label[for='f-depth-indexed']");
    // Below lg the filters sit behind a "Filters" disclosure.
    if (!(await option.isVisible())) await page.locator("label[for='filters-toggle']").click();
    const facetCount = num(await option.locator("span.tabular").textContent());
    expect(facetCount).toBeGreaterThan(0);
    await option.click();
    await expect(page).toHaveURL(/depth=indexed/);
    await expect(page.locator("#results-heading")).toContainText(`${facetCount} of`);
    expect(await page.locator("main article").count()).toBe(facetCount);

    const chip = page.getByRole("list", { name: "Active filters" }).getByRole("link", { name: /Depth: Deeply indexed/ });
    await chip.click();
    await expect(page).not.toHaveURL(/depth=/);
    await expect(page.locator("#f-depth-indexed")).not.toBeChecked();
  });

  test("GET URLs are server-rendered (shareable; no client fetching needed)", async ({ page, request }) => {
    // Content is rendered on the server for the URL state. (React's streaming reveal needs JS, so
    // this checks the HTML response itself rather than a JS-disabled browser.)
    const html = await (await request.get("/systems?framework=react&sort=name&view=list")).text();
    expect(html).toContain('aria-label="Design systems table"');
    expect(html).toMatch(/id="f-framework-react"[^>]*checked/);
    await page.goto("/systems?framework=react&sort=name&view=list");
    const rows = page.locator("table tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
    const names = await rows.locator("th a").allInnerTexts();
    expect([...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))).toEqual(names);
    await expect(page.locator("#f-framework-react")).toBeChecked();
    await expect(page.locator("#directory-sort")).toHaveValue("name");
  });

  test("server-side search matches name, alias and organization (typo tolerant)", async ({ page }) => {
    await page.goto("/systems?q=primr");
    await expect(page.locator("main article").first()).toContainText("Primer");
    await page.goto("/systems?q=IBM");
    await expect(page.locator("main article").first()).toContainText("Carbon");
  });

  test("registry decisions list rejected and duplicate candidates with their replacement", async ({ page }) => {
    await page.goto("/systems?registry=all");
    const list = page.locator("main ol").first();
    const items = list.locator("> li");
    expect(await items.count()).toBeGreaterThan(0);
    await expect(list).toContainText(/Rejected|Duplicate/);
    const replacement = list.getByText("Replaced in the 100 by").first();
    await expect(replacement).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe("system detail (/systems/[slug])", () => {
  test("deeply indexed system: header, sections, evidence and nav", async ({ page }) => {
    await page.goto("/systems/carbon");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Carbon");
    const nav = page.getByRole("navigation", { name: "On this page" });
    for (const label of ["Overview", "Components", "Tokens", "Patterns", "Accessibility", "Frameworks", "Resources", "Change history", "Evidence", "Registry notes"]) {
      await expect(nav.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    // nav counts agree with the section bodies
    const navComponents = num(await nav.getByRole("link", { name: /^Components/ }).textContent());
    expect(await page.locator("section#components a[href^='/systems/carbon/components/']").count()).toBe(navComponents);

    // a key fact's evidence expands inline (native details)
    const repoFact = page.locator("section#overview dl > div", { hasText: "Repository" });
    await repoFact.locator("summary").click();
    await expect(repoFact.locator("details[open] ul")).toContainText(/registry-research|adapter:/);

    // swatches are real tokens linking to the token explorer
    expect(await page.locator("section#tokens a[href^='/tokens?system=carbon&q=']").count()).toBeGreaterThan(0);

    // change history is paginated through the URL
    const older = page.getByRole("link", { name: "Older" });
    if (await older.count()) {
      await older.click();
      await expect(page).toHaveURL(/changes=2/);
    }
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test("metadata-only system explains what is and is not verified", async ({ page }) => {
    await page.goto("/systems/apple-hig");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Apple Human Interface Guidelines");
    const deep = page.locator("section#deep-index");
    await expect(deep).toContainText("Deep ingestion has not been performed");
    await expect(deep).toContainText(/\d+ of \d+ registry checks passed/);
    await expect(deep.getByText("Not extracted").first()).toBeVisible();
    await expect(page.locator("section#components")).toHaveCount(0);
    await expectNoSeriousA11yViolations(page);
  });

  test("unknown and rejected slugs render the not-found state", async ({ page }) => {
    for (const slug of ["definitely-not-a-system", "airbnb-dls"]) {
      await page.goto(`/systems/${slug}`);
      await expect(page.getByText("This design system isn't in the index")).toBeVisible();
      await expect(page.getByRole("link", { name: "See registry decisions" })).toHaveAttribute("href", "/systems?registry=all");
    }
  });
});

test.describe("search (/search)", () => {
  test("shows interpretation, facets and results; keyboard moves through results", async ({ page }) => {
    await page.goto("/search?q=React%20combobox");
    await expect(page.getByLabel("How the query was interpreted")).toContainText(/framework/i);
    const total = num(await page.locator("#results-count span").first().textContent());
    expect(total).toBeGreaterThan(0);

    const input = page.locator("#search-q");
    await input.focus();
    await input.press("ArrowDown");
    const first = page.locator("a[data-result-link]").first();
    await expect(first).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("a[data-result-link]").nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(input).toBeFocused();
    await expectNoSeriousA11yViolations(page);
  });

  test("type facet narrows results and is reflected in the URL", async ({ page }) => {
    await page.goto("/search?q=button");
    const refine = page.getByRole("complementary", { name: "Refine results" });
    // Below lg the facets sit in a "Refine results" disclosure (a second copy of the desktop list).
    const disclosure = refine.locator("details > summary").filter({ hasText: /^Refine results/ });
    if (await disclosure.isVisible()) await disclosure.click();
    const facet = refine.locator("a[href*='types=component']").filter({ hasText: /^Components/ }).filter({ visible: true }).first();
    const facetCount = num(await facet.locator("span.tabular").textContent());
    await facet.click();
    await expect(page).toHaveURL(/types=component(&|$)/);
    await expect(page.locator("#results-count")).toContainText(String(facetCount));
  });

  test("grouped view, pagination and empty state", async ({ page }) => {
    await page.goto("/search?q=color&view=grouped");
    await expect(page.locator("main section[aria-labelledby^='grp-']").first()).toBeVisible();
    const next = page.getByRole("navigation", { name: "Search result pages" }).getByRole("link", { name: "Next" });
    if (await next.count()) {
      await next.click();
      await expect(page).toHaveURL(/page=2/);
    }
    await page.goto("/search?q=zzqqxxnotathing");
    await expect(page.getByText(/Nothing in the index matches/)).toBeVisible();
    await expect(page.getByRole("link", { name: "React combobox" })).toBeVisible();
  });

  test("invalid parameters render a designed error, not a crash", async ({ page }) => {
    await page.goto("/search?q=x&types=nope");
    await expect(page.getByText("This search link has invalid parameters")).toBeVisible();
  });
});

test.describe("responsive", () => {
  test("no horizontal page scroll at 390px on any discovery route", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/", "/systems", "/systems?view=list", "/systems?registry=all", "/systems/carbon", "/systems/apple-hig", "/systems/bootstrap", "/search?q=button", "/search?q=color&view=grouped"]) {
      await page.goto(path);
      await page.locator("#main h1").first().waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(1);
    }
  });
});
