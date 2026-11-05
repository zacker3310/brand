import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Universal Component Catalog, component-type pages and component detail.
 * Runs against real indexed data (no fixtures): assertions check structure and consistency, not
 * hard-coded counts, so they hold as more systems are ingested.
 */

// Dev-server compiles on a shared 4-core box can be slow; data assertions still run against the real DB.
test.describe.configure({ timeout: 90_000 });
expect.configure({ timeout: 20_000 });

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // Shell search trigger (integrator-owned): aria-label "Search ATLAS" vs visible placeholder text.
    .exclude("button[aria-keyshortcuts]")
    // Site footer (integrator-owned) uses --subtle-foreground, below 4.5:1; reported separately.
    .exclude("body > footer, footer.mt-24")
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

/** Client enhancements (auto-submit, tabs) attach after hydration; the server-rendered form works before that. */
async function hydrated(page: Page, selector = "form[data-ready]") {
  await page.locator(selector).first().waitFor({ state: "attached" });
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("component catalog (/components)", () => {
  test("types view lists canonical types with system-specific names from the index", async ({ page }) => {
    await page.goto("/components");
    await expect(page.getByRole("heading", { level: 1, name: "Components" })).toBeVisible();
    const status = page.getByRole("status").first();
    await expect(status).toContainText(/types? with implementations/);

    const actions = page.getByRole("region", { name: "Actions" }).or(page.locator("section[aria-labelledby='group-actions']"));
    await expect(actions.getByRole("link", { name: "Button", exact: true }).first()).toHaveAttribute("href", "/components/button");
    // Implementation names link to component detail pages.
    const implLinks = actions.locator("a[href^='/systems/'][href*='/components/']");
    expect(await implLinks.count()).toBeGreaterThan(0);
    // "n of m systems" is derived, never blank.
    await expect(actions.getByText(/\d+ of \d+ systems/).first()).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("system facet filters through the URL and updates counts", async ({ page }) => {
    await page.goto("/components?view=components");
    await hydrated(page);
    const total = Number((await page.getByRole("status").first().innerText()).match(/of ([\d,]+) components/)?.[1]?.replace(/,/g, ""));
    expect(total).toBeGreaterThan(0);

    const filters = page.getByRole("complementary", { name: "Catalog filters" });
    const carbon = filters.getByRole("checkbox", { name: /Carbon/ });
    await carbon.check();
    await expect(page).toHaveURL(/system=carbon/);
    await expect(page).toHaveURL(/view=components/);
    const filtered = Number((await page.getByRole("status").first().innerText()).match(/of ([\d,]+) components/)?.[1]?.replace(/,/g, ""));
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(total);
    // Every visible row belongs to the selected system.
    const rowLinks = page.locator("table tbody a[href^='/systems/']");
    const hrefs = await rowLinks.evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) expect(h).toMatch(/^\/systems\/carbon\/components\//);

    // Removing the active-filter chip restores the full set.
    await page.getByRole("list", { name: "Active filters" }).getByRole("link").first().click();
    await expect(page).not.toHaveURL(/system=carbon/);
  });

  test("search is keyboard-operable, debounced, and expands synonyms honestly", async ({ page }) => {
    await page.goto("/components");
    await hydrated(page);
    const search = page.getByRole("searchbox", { name: /Search components and types/ });
    await search.focus();
    await page.keyboard.type("snackbar");
    await expect(page).toHaveURL(/q=snackbar/);
    await expect(page.getByText(/Also matching implementations ATLAS mapped to/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Toast", exact: true }).first()).toBeVisible();
    // Focus stays in the field while results update.
    await expect(search).toBeFocused();
  });

  test("works without JavaScript: the filter form is a plain GET form", async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto("/components?view=components&system=github-primer&sort=name");
    await expect(page.getByRole("status").first()).toContainText(/components/);
    const form = page.locator("form[role='search'][action='/components']");
    await expect(form).toHaveAttribute("method", "get");
    await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
    await ctx.close();
  });

  test("components view sorts via URL and shows coverage per row", async ({ page }) => {
    await page.goto("/components?view=components");
    await hydrated(page);
    await page.getByLabel("Sort").selectOption("coverage");
    await expect(page).toHaveURL(/sort=coverage/);
    const strips = page.locator("table [role='img'][aria-label^='Coverage:']");
    expect(await strips.count()).toBeGreaterThan(0);
    await expect(strips.first()).toHaveAttribute("aria-label", /of 12 fields documented/);
    await expectNoSeriousA11yViolations(page);
  });

  test("coverage matrix explains absence and scrolls inside its own container", async ({ page }) => {
    await page.goto("/components?layout=matrix");
    await expect(page.getByText("Not found in ATLAS's index", { exact: false }).first()).toBeVisible();
    const matrix = page.getByRole("region", { name: /Coverage matrix/ });
    await expect(matrix.locator("thead th[scope='col']")).not.toHaveCount(0);
    await expect(matrix.locator("tbody th[scope='row']").first()).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test.describe("at phone width", () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test("no horizontal page scroll", async ({ page }) => {
      for (const url of ["/components", "/components?view=components", "/components?layout=matrix"]) {
        await page.goto(url);
        await expectNoHorizontalScroll(page);
      }
    });
  });
});

test.describe("component type page (/components/[type])", () => {
  test("shows the ATLAS definition, synonyms, APG link and implementations", async ({ page }) => {
    await page.goto("/components/button");
    await expect(page.getByRole("heading", { level: 1, name: "Button" })).toBeVisible();
    await expect(page.getByText("ATLAS definition", { exact: true })).toBeVisible();
    await expect(page.getByText(/Related but not interchangeable/)).toBeVisible();
    await expect(page.getByRole("link", { name: /WAI-ARIA APG: Button pattern/ })).toHaveAttribute(
      "href",
      "https://www.w3.org/WAI/ARIA/apg/patterns/button/",
    );
    const rows = page.getByRole("region", { name: "Implementations, scrollable" }).locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
    const compare = page.getByRole("link", { name: /Compare these/ });
    await expect(compare).toHaveAttribute("href", /^\/compare\?type=button&systems=[a-z0-9-]+(,[a-z0-9-]+){1,3}$/);
    await expectNoSeriousA11yViolations(page);
  });

  test("unknown type renders the not-found state", async ({ page }) => {
    await page.goto("/components/definitely-not-a-type");
    await expect(page.getByText("Not an ATLAS canonical type")).toBeVisible();
  });
});

test.describe("component detail (/systems/[slug]/components/[component])", () => {
  test("renders provenance, coverage for every field and evidence", async ({ page }) => {
    await page.goto("/systems/github-primer/components/action-menu");
    await expect(page.getByRole("heading", { level: 1, name: "ActionMenu" })).toBeVisible();
    const coverage = page.getByRole("region", { name: "Coverage" }).or(page.locator("section[aria-labelledby='coverage-title']"));
    await expect(coverage.locator("li")).toHaveCount(12);
    await expect(page.locator("#evidence li").first()).toBeVisible();
    await expect(page.getByText(/^Data from /)).toBeVisible();
    // Empty fields explain themselves instead of rendering blank.
    await expect(page.locator("#variants")).toContainText(/Not documented|Not extracted|Documented as none/);
    await expectNoSeriousA11yViolations(page);
  });

  test("props table filters live and announces the result", async ({ page }) => {
    await page.goto("/systems/github-primer/components/action-menu#api");
    await hydrated(page, "#api [data-ready]");
    const filter = page.getByRole("searchbox", { name: /Filter props/ });
    const status = page.locator("#api").getByRole("status");
    const before = await status.innerText();
    await filter.fill("overlay");
    await expect(status).toContainText(/ of \d+ props match/);
    expect(await status.innerText()).not.toEqual(before);
    await expect(page).toHaveURL(/pq=overlay/);
    const names = await page.locator("#api tbody th[scope='row'] code").allInnerTexts();
    expect(names.length).toBeGreaterThan(0);
  });

  test("implementation tabs are keyboard operable and shareable via the URL", async ({ page }) => {
    await page.goto("/systems/carbon/components/button#api");
    await hydrated(page, "#api [data-ready]");
    const tabs = page.locator("#api").getByRole("tab");
    const count = await tabs.count();
    test.skip(count < 2, "needs a component documenting more than one implementation");
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/impl=/);
    // Reloading the shared URL restores the same tab (server-rendered).
    await page.reload();
    await expect(page.locator("#api").getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
  });

  test("unknown component renders the not-found state", async ({ page }) => {
    await page.goto("/systems/github-primer/components/not-a-real-component");
    await expect(page.getByText("This component isn't in ATLAS's index")).toBeVisible();
  });

  test.describe("at phone width", () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test("no horizontal page scroll", async ({ page }) => {
      for (const url of ["/systems/carbon/components/button", "/systems/material-design/components/buttons", "/components/combobox"]) {
        await page.goto(url);
        await expectNoHorizontalScroll(page);
      }
    });
  });
});
