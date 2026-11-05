import AxeBuilder from "@axe-core/playwright";
import { expect as baseExpect, test, type Page } from "@playwright/test";

/**
 * Pattern Library: index, pattern type comparison, system pattern detail. Assertions follow links taken
 * from the rendered pages instead of hard-coded slugs, so they hold as more systems are ingested.
 */

test.setTimeout(120_000);
const expect = baseExpect.configure({ timeout: 20_000 });
const num = (s: string | null | undefined) => Number((s ?? "").replace(/[^\d]/g, ""));

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude("header button[aria-label='Search ATLAS']")
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
}

test.describe("pattern library", () => {
  test("index shows live totals, documented types and unclassified patterns", async ({ page }) => {
    await page.goto("/patterns");
    await expect(page.getByRole("heading", { level: 1, name: "Patterns" })).toBeVisible();
    const documented = page.locator("#types ul > li");
    const n = await documented.count();
    expect(n).toBeGreaterThan(0);
    await expect(page.getByText(new RegExp(`^${n} of \\d+ ATLAS pattern types`))).toBeVisible();

    const unclassifiedRows = page.getByRole("table", { name: "Unclassified patterns" }).locator("tbody tr");
    const unclassified = await unclassifiedRows.count();
    const stat = page.getByText("Unclassified", { exact: true }).first().locator("xpath=..");
    expect(num(await stat.locator("div").first().textContent())).toBe(unclassified);
    await expectNoSeriousA11yViolations(page);
  });

  test("a pattern type lists each system's pattern and compares them when two or more document it", async ({ page }) => {
    await page.goto("/patterns");
    const card = page.locator("#types ul > li a").first();
    const href = await card.getAttribute("href");
    await card.click();
    await expect(page).toHaveURL(href!);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("ATLAS definition")).toBeVisible();
    const articles = page.locator("#systems article");
    expect(await articles.count()).toBeGreaterThan(0);
    const systems = num(await page.getByRole("heading", { name: /^Documented by \d+ systems?/ }).textContent());
    if (systems >= 2) {
      const table = page.getByRole("table");
      await expect(table).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Scope (docs section)" })).toBeVisible();
      await expect(table.getByText(/Description: /).first()).toBeVisible();
    } else {
      await expect(page.getByRole("table")).toHaveCount(0);
    }
    await expectNoSeriousA11yViolations(page);
  });

  test("pattern detail shows classification, related components and evidence", async ({ page }) => {
    await page.goto("/patterns");
    await page.locator("#types ul > li a").first().click();
    const link = page.locator("#systems article h3 a").first();
    const name = (await link.textContent())!.trim();
    await link.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByRole("complementary", { name: "Classification" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Related components" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("system pattern list separates mapped and unclassified patterns", async ({ page }) => {
    await page.goto("/patterns");
    const href = await page.getByRole("table", { name: "Unclassified patterns" }).locator("tbody tr th a").first().getAttribute("href");
    const system = href!.split("/")[2]!;
    await page.goto(`/systems/${system}/patterns`);
    await expect(page.getByRole("heading", { level: 1, name: "Patterns" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Unclassified" })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("unknown type, system or pattern is a 404", async ({ page }) => {
    expect((await page.goto("/patterns/not-a-pattern-type"))?.status()).toBe(404);
    await expect(page.getByText("Not an ATLAS pattern type")).toBeVisible();
    expect((await page.goto("/systems/github-primer/patterns/not-a-pattern"))?.status()).toBe(404);
    expect((await page.goto("/systems/not-a-system/patterns"))?.status()).toBe(404);
  });

  test("keyboard reaches pattern type cards", async ({ page }) => {
    await page.goto("/patterns");
    const first = page.locator("#types ul > li a").first();
    await first.focus();
    await expect(first).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/patterns\/[a-z-]+$/);
  });
});
