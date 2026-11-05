import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test, type Page } from "@playwright/test";

/**
 * Token Explorer, scale comparison and token set exports. Runs against the real index: assertions check
 * structure and internal consistency (tab counts vs. set counts), never hard-coded token numbers.
 */

test.setTimeout(120_000);
const expect = baseExpect.configure({ timeout: 20_000 });
const num = (s: string | null | undefined) => Number((s ?? "").replace(/[^\d]/g, ""));

async function expectNoSeriousA11yViolations(page: Page) {
  // Known issues in integrator-owned shared UI, reported as requested changes:
  //  - the header search trigger's aria-label differs from its visible text;
  //  - the kit's VerificationBadge "inferred" colors (--inferred on --inferred-soft) are below 4.5:1 in light mode.
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude("header button[aria-label='Search ATLAS']")
    .exclude("span.text-inferred.bg-inferred-soft")
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Category tab counts ("Color 2,410") keyed by label. */
async function tabCounts(page: Page) {
  const tabs = page.getByRole("navigation", { name: "Token categories" }).getByRole("link");
  const out: Record<string, number> = {};
  for (const t of await tabs.all()) {
    const text = (await t.textContent()) ?? "";
    const m = /^([A-Za-z]+)\s*([\d,]+)$/.exec(text.trim());
    if (m) out[m[1]!] = num(m[2]);
  }
  return out;
}

test.describe("token explorer", () => {
  test("defaults to the system with most tokens; tab counts add up to the set total", async ({ page }) => {
    await page.goto("/tokens");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const systemSelect = page.getByLabel("Design system");
    const options = await systemSelect.locator("option").allTextContents();
    expect(options.length).toBeGreaterThan(0);
    const counts = options.map((o) => num(o.split("·").pop()));
    expect(counts[0]).toBe(Math.max(...counts));

    const allSets = page.getByRole("navigation", { name: "Token sets" }).getByRole("link").first();
    await expect(allSets).toHaveAttribute("aria-current", "page");
    const total = num(await allSets.locator("span").last().textContent());
    const tabs = await tabCounts(page);
    expect(Object.keys(tabs)).toHaveLength(9);
    expect(Object.values(tabs).reduce((a, b) => a + b, 0)).toBe(total);

    await expect(page.locator("#token-results a[data-inspect]").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Alias resolution/ })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("selecting a token opens the inspector with its alias chain and updates the URL", async ({ page }) => {
    await page.goto("/tokens?system=github-primer&set=primitives-theme-light&category=color");
    const item = page.locator("#token-results a[data-inspect]").filter({ hasText: "default" }).first();
    const id = await item.getAttribute("data-inspect");
    await item.click();
    await expect(page).toHaveURL(new RegExp(`token=${id}`));
    const inspector = page.getByRole("complementary", { name: "Token inspector" });
    await expect(inspector.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(inspector.getByRole("heading", { name: /References \(upstream\)/ })).toBeVisible();
    await expect(inspector.getByRole("heading", { name: /Referenced by \(downstream\)/ })).toBeVisible();
    await inspector.getByRole("button", { name: "Close inspector" }).click();
    await expect(page).not.toHaveURL(/token=/);
    await expect(item).toBeFocused();
  });

  test("keyboard: a token is reachable and opens with Enter", async ({ page }) => {
    await page.goto("/tokens?system=github-primer&set=primitives-base-color-light&category=color");
    const first = page.locator("#token-results a[data-inspect]").first();
    await first.focus();
    await expect(first).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/token=/);
    await expect(page.getByRole("complementary", { name: "Token inspector" }).getByRole("heading", { level: 2 })).toBeFocused();
  });

  test("searching an exact token name filters the results and inspects it", async ({ page }) => {
    await page.goto("/tokens?system=github-primer&category=color");
    const search = page.getByRole("searchbox", { name: /Search tokens/ });
    await search.fill("fgColor.default");
    await search.press("Enter");
    await expect(page).toHaveURL(/q=fgColor\.default/);
    await expect(page.locator("#token-results a[data-inspect]").first()).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Token inspector" }).getByRole("heading", { level: 2 })).toHaveText("fgColor.default");
  });

  test("table view lists tokens with alias state, tier and a source link", async ({ page }) => {
    await page.goto("/tokens?system=github-primer&set=primitives-theme-light&category=color&view=table");
    const table = page.getByRole("table", { name: "Tokens in the current scope" });
    await expect(table).toBeVisible();
    expect(await table.locator("tbody tr").count()).toBeGreaterThan(10);
    await expect(table.getByRole("columnheader", { name: "Alias state" })).toBeVisible();
    await expect(table.locator("tbody tr").first().getByRole("link", { name: /opens in a new tab/ })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("theme comparison pairs two themed sets", async ({ page }) => {
    await page.goto("/tokens?system=github-primer&category=color&view=themes");
    await expect(page.getByLabel("Theme A")).toBeVisible();
    await expect(page.getByLabel("Theme B")).toBeVisible();
    const rows = page.getByRole("table").locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(page.getByText(/color tokens with a value in both/)).toBeVisible();
  });

  test("contrast checker measures a manual pair and lists name-paired tokens", async ({ page }) => {
    await page.goto("/tokens?system=github-primer&set=primitives-theme-light&category=color&view=contrast");
    await page.getByLabel("Foreground", { exact: true }).fill("#ffffff");
    await page.getByLabel("Background", { exact: true }).fill("#000000");
    await page.getByRole("button", { name: "Check contrast" }).click();
    await expect(page.getByText("21.00")).toBeVisible();
    await expect(page.getByRole("heading", { name: /pairs found by name/ })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("motion previews can be paused", async ({ page }) => {
    await page.goto("/tokens?system=github-primer&category=motion");
    const toggle = page.getByRole("button", { name: /^(Pause|Play) all/ });
    await expect(toggle).toBeVisible();
    const first = page.getByRole("button", { name: /^(Pause|Play) base\./ }).first();
    const before = await first.getAttribute("aria-pressed");
    await first.click();
    await expect(first).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
  });

  test("mobile width has no horizontal page scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of ["/tokens", "/tokens?system=github-primer&view=table", "/tokens?system=carbon&category=color&view=themes", "/tokens/compare"]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
  });

  test("unknown system or set renders not-found (noindex)", async ({ page }) => {
    // Streaming has started (root loading.tsx), so Next keeps HTTP 200 and marks the page noindex.
    for (const url of ["/tokens?system=no-such-system", "/tokens?system=github-primer&set=no-such-set"]) {
      await page.goto(url);
      await expect(page.getByText("Not in the index")).toBeVisible();
      expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBeGreaterThan(0);
    }
  });
});

test.describe("scale comparison", () => {
  test("aligns scales by value and says it does not imply equivalence", async ({ page }) => {
    await page.goto("/tokens/compare?systems=github-primer,carbon&category=spacing");
    await expect(page.getByRole("note")).toContainText("Aligned by value, not by meaning; ATLAS does not imply semantic equivalence.");
    const table = page.getByRole("table").first();
    await expect(table).toBeVisible();
    expect(await table.locator("tbody tr").count()).toBeGreaterThan(0);
    await page.getByRole("link", { name: "Typography" }).click();
    await expect(page).toHaveURL(/category=typography/);
    await expect(page.getByRole("heading", { name: "Font size" })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});

test.describe("exports", () => {
  test("permitted sets download as JSON and CSS with attribution", async ({ request }) => {
    const json = await request.get("/tokens/export/github-primer/primitives-theme-light?format=json");
    expect(json.status()).toBe(200);
    expect(json.headers()["content-disposition"]).toContain("attachment");
    const doc = await json.json();
    expect(doc.$atlas.redistribution).toBe("permitted");
    expect(doc.$atlas.source).toMatch(/^https:\/\//);
    expect(doc.tokens.length).toBe(doc.$atlas.tokenCount);

    const css = await request.get("/tokens/export/github-primer/primitives-theme-light?format=css");
    expect(css.status()).toBe(200);
    const text = await css.text();
    expect(text).toContain(":root {");
    expect(text).toContain("Source: https://");
  });

  test("invalid format is 400 and unknown sets are 404", async ({ request }) => {
    expect((await request.get("/tokens/export/github-primer/primitives-theme-light?format=xml")).status()).toBe(400);
    expect((await request.get("/tokens/export/github-primer/no-such-set?format=json")).status()).toBe(404);
  });

  test("the set summary offers downloads only when redistribution is permitted", async ({ page }) => {
    await page.goto("/tokens?system=github-primer&set=primitives-theme-light");
    const chip = page.getByText(/^Redistribution (permitted|conditional|restricted|unknown)$/).first();
    const label = (await chip.textContent()) ?? "";
    if (label.endsWith("permitted")) {
      await expect(page.getByRole("link", { name: "JSON" })).toHaveAttribute("href", /format=json/);
    } else {
      await expect(page.getByRole("button", { name: "JSON" })).toBeDisabled();
      await expect(page.getByText(/Download unavailable/)).toBeVisible();
    }
  });
});
