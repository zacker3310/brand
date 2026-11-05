/**
 * Comparison experience: /compare (index + component comparison), /compare/systems,
 * /compare/s/[slug], /api/comparisons (+ export). Runs against real indexed data
 * (github-primer, carbon, material-web are indexed in the dev database).
 *
 *   E2E_NO_SERVER=1 E2E_PORT=3103 npx playwright test tests/e2e/compare.spec.ts --project=desktop
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SYSTEMS = ["github-primer", "carbon", "material-web"];

/** Enhanced controls replace their no-JS fallbacks after hydration; wait for that before interacting. */
async function hydrated(page: Page, what: "picker" | "matrix" | "share") {
  if (what === "picker") await expect(page.locator('button[role="combobox"]').first()).toBeVisible({ timeout: 30_000 });
  if (what === "matrix") await expect(page.locator('button[role="switch"]')).toBeVisible({ timeout: 30_000 });
  if (what === "share") await expect(page.getByRole("button", { name: "Save & share" })).toHaveAttribute("aria-haspopup", "dialog", { timeout: 30_000 });
}
const CMP = `/compare?type=button&systems=${SYSTEMS.join(",")}`;

/** axe on this area's content (<main>); the shared shell is covered by its own owner's specs. */
async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test.describe("compare index", () => {
  test("renders the picker and data-derived suggestions", async ({ page }) => {
    await page.goto("/compare");
    await expect(page.getByRole("heading", { level: 1, name: "Compare implementations" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Component type", exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: /Systems to compare/ })).toBeVisible();
    const suggestions = page.getByRole("region", { name: "Suggested comparisons" }).or(page.locator("section", { has: page.getByRole("heading", { name: "Suggested comparisons" }) }));
    await expect(suggestions.getByRole("link").first()).toBeVisible();
    // Counts come from the database, not hard-coded copy.
    await expect(page.getByText(/\d+ canonical component types · \d+ with at least one indexed implementation/)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("keyboard: choose a type with the combobox, pick systems, submit", async ({ page }) => {
    await page.goto("/compare");
    await hydrated(page, "picker");
    const combo = page.getByRole("combobox", { name: "Component type", exact: true });
    await combo.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.type("checkbox");
    await page.keyboard.press("Enter");
    await expect(combo).toContainText("Checkbox");
    // Implementing systems are listed first; select two with the keyboard.
    const picker = page.getByRole("group", { name: /Systems to compare/ });
    await expect(picker.getByText(/Implements Checkbox/)).toBeVisible();
    for (const name of ["GitHub Primer", "IBM Carbon Design System"]) {
      const box = picker.getByRole("checkbox", { name });
      await box.focus();
      await page.keyboard.press("Space");
      await expect(box).toBeChecked();
    }
    await expect(picker.getByText("2 of 5 selected")).toBeVisible();
    await page.getByRole("button", { name: /^Compare/ }).click();
    await page.waitForURL(/type=checkbox&systems=github-primer,carbon/);
    await expect(page.getByRole("heading", { level: 1, name: "Checkbox" })).toBeVisible();
  });

  test("validates the selection without JavaScript round trips", async ({ page }) => {
    await page.goto("/compare?type=button&systems=carbon");
    await expect(page.getByText("Select at least 2 systems.")).toBeVisible();
  });
});

test.describe("component comparison", () => {
  test("renders real data per system with coverage chips and a legend", async ({ page }) => {
    await page.goto(CMP);
    await expect(page).toHaveTitle(/Button: GitHub Primer vs IBM Carbon Design System vs Material Web/);
    const table = page.getByRole("table").first();
    for (const name of ["GitHub Primer", "IBM Carbon Design System", "Material Web"]) {
      await expect(table.getByRole("columnheader").filter({ hasText: name })).toBeVisible();
    }
    for (const group of ["Naming", "Variants", "States", "API", "Accessibility", "Design tokens", "Interaction conventions", "Documentation links", "Evidence"]) {
      await expect(table.getByRole("heading", { level: 3, name: group, exact: true })).toBeVisible();
    }
    // Every empty cell explains itself; the legend defines each state.
    await expect(table.getByText("Not documented").first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Legend" })).toContainText("absent capability");
    await expect(table.getByText("aligned by name (inferred)").first()).toBeVisible();
    // Provenance credits.
    await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
    await expect(page.getByText(/belong to their respective owners/)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("show differences only hides identical rows and updates the URL", async ({ page }) => {
    await page.goto(CMP);
    await hydrated(page, "matrix");
    const table = page.getByRole("table").first();
    const sameRow = table.getByRole("row").filter({ hasText: "Same in all columns" }).first();
    await expect(sameRow).toBeVisible();
    const toggle = page.getByRole("switch", { name: /Show differences only/ });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(sameRow).toBeHidden();
    await expect(page).toHaveURL(/diff=1/);
    await expect(page.getByRole("status").filter({ hasText: /rows that differ/ })).toHaveText(/Showing \d+ of \d+ rows/);
    // Server-rendered state matches (shareable URL).
    await page.reload();
    await expect(page.getByRole("switch", { name: /Show differences only/ })).toHaveAttribute("aria-checked", "true");
    await expect(table.getByRole("row").filter({ hasText: "Same in all columns" }).first()).toBeHidden();
  });

  test("expands the long tail of aligned props", async ({ page }) => {
    await page.goto(CMP);
    await hydrated(page, "matrix");
    const more = page.getByRole("button", { name: /Show \d+ more aligned props/ }).first();
    await expect(more).toBeVisible();
    await more.click();
    await expect(page.getByRole("button", { name: "Show fewer props" }).first()).toBeVisible();
    await expect(page).toHaveURL(/props=all/);
  });

  test("lets the user pick which component fills a column", async ({ page }) => {
    await page.goto(CMP);
    await hydrated(page, "matrix");
    const select = page.locator("#pick-carbon"); // desktop column header (the mobile list has its own select)
    await expect(select).toHaveAccessibleName("IBM Carbon Design System component to compare");
    await expect(select).toBeVisible();
    await select.selectOption({ label: "Copy button" });
    await page.waitForURL(/pick=carbon:copy-button/);
    await expect(page.getByRole("columnheader").filter({ hasText: "Copy button" })).toBeVisible();
  });

  test("marks systems ATLAS has not indexed instead of showing empty values", async ({ page }) => {
    await page.goto(`/compare?type=button&systems=carbon,shadcn-ui`);
    await expect(page.getByRole("columnheader").filter({ hasText: "Not in ATLAS index" })).toBeVisible();
    await expect(page.getByRole("columnheader").filter({ hasText: "Registry metadata only" })).toBeVisible();
  });

  test("unknown component types render the not-found state", async ({ page }) => {
    await page.goto("/compare?type=definitely-not-a-type&systems=carbon,github-primer");
    await expect(page.getByText("Not in the ATLAS taxonomy")).toBeVisible();
  });

  test("has no horizontal page scroll at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CMP);
    await expect(page.getByRole("heading", { name: "Compared components" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("save, share and export", () => {
  test("POST /api/comparisons validates input", async ({ request }) => {
    const bad = await request.post("/api/comparisons", { data: { type: "button", systems: ["carbon"] } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.code).toBe("invalid_request");
    const unknown = await request.post("/api/comparisons", { data: { type: "button", systems: ["carbon", "no-such-system"] } });
    expect(unknown.status()).toBe(400);
    expect(JSON.stringify(await unknown.json())).toContain("no-such-system");
  });

  test("saves a comparison and the short link opens it", async ({ page, request }) => {
    test.slow(); // first hit compiles the redirect route in dev
    const res = await request.post("/api/comparisons", { data: { type: "button", systems: SYSTEMS, title: "E2E button comparison", picks: { carbon: "button" } } });
    expect(res.status()).toBe(201);
    const { data } = await res.json();
    expect(data.url).toMatch(/^\/compare\/s\/[A-Za-z0-9]{8}$/);
    const api = await request.get(`/api/comparisons/${data.slug}`);
    expect((await api.json()).data).toMatchObject({ typeSlug: "button", systemSlugs: SYSTEMS, picks: { carbon: "button" } });
    await page.goto(data.url);
    await page.waitForURL(/saved=/);
    await expect(page.getByText("E2E button comparison")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Button" })).toBeVisible();
  });

  test("Save & share from the UI creates a copyable link", async ({ page }) => {
    test.slow();
    await page.goto(CMP);
    await hydrated(page, "share");
    await page.getByRole("button", { name: "Save & share" }).click();
    await page.getByRole("button", { name: "Create link" }).click();
    const link = page.getByLabel("Shareable link");
    await expect(link).toHaveValue(/\/compare\/s\/[A-Za-z0-9]{8}$/, { timeout: 30_000 });
    await expect(page.getByText("Link created")).toBeVisible();
  });

  test("unknown saved slugs are not found", async ({ page }) => {
    await page.goto("/compare/s/ZZZZZZZZ");
    await expect(page.getByText("Not in the ATLAS taxonomy")).toBeVisible();
  });

  test("exports JSON and CSV with metadata, sources and disclaimer", async ({ request }) => {
    const json = await request.get(`/api/comparisons/export?kind=component&type=button&systems=${SYSTEMS.join(",")}&format=json`);
    expect(json.status()).toBe(200);
    expect(json.headers()["content-disposition"]).toMatch(/attachment; filename="atlas-compare-button/);
    const body = await json.json();
    expect(body.atlas).toMatchObject({ generator: "ATLAS", kind: "component-comparison" });
    expect(body.atlas.disclaimer).toMatch(/belong to their respective owners/);
    expect(body.systems.map((s: { slug: string }) => s.slug)).toEqual(SYSTEMS);
    expect(body.systems[0].component.docsUrl).toMatch(/^https:\/\//);
    const csv = await request.get(`/api/comparisons/export?kind=component&type=button&systems=${SYSTEMS.join(",")}&format=csv`);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const text = await csv.text();
    expect(text).toMatch(/^# ATLAS export: component comparison: Button/);
    expect(text).toContain("group,attribute,alignment");
    const sys = await request.get(`/api/comparisons/export?kind=system&systems=carbon,github-primer&format=json`);
    expect((await sys.json()).systems[0].scores.length).toBeGreaterThan(0);
    expect((await request.get(`/api/comparisons/export?kind=component&type=button&systems=carbon&format=csv`)).status()).toBe(400);
  });
});

test.describe("system comparison", () => {
  test("scores with confidence and evidence, and never scores metadata-only systems on component data", async ({ page }) => {
    await page.goto("/compare/systems?systems=carbon,github-primer,apple-hig");
    await expect(page.getByRole("heading", { level: 1, name: "System comparison" })).toBeVisible();
    const card = page.getByRole("region", { name: "Scorecard" });
    await expect(card.getByRole("columnheader").filter({ hasText: "Apple Human Interface Guidelines" })).toContainText("Metadata only");
    await expect(card.getByText("Not indexed").first()).toBeVisible();
    await expect(card.getByText(/confidence/).first()).toBeVisible();
    await expect(card.getByText(/\d+% evidence/).first()).toBeVisible();
    // Rubric definitions are inline and expandable.
    const how = page.locator("#component-coverage").getByText("How this is scored");
    await how.click();
    await expect(page.locator("#component-coverage").getByText(/ATLAS core component types/).first()).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test("criteria checkboxes filter the rubric rows", async ({ page }) => {
    await page.goto("/compare/systems?systems=carbon,github-primer&criteria=theming,maintenance");
    const card = page.getByRole("region", { name: "Scorecard" });
    await expect(card.getByRole("rowheader")).toHaveCount(2);
    await expect(card.getByRole("rowheader").first()).toContainText("Theming capability");
  });

  test("empty state offers the indexed systems", async ({ page }) => {
    await page.goto("/compare/systems");
    await expect(page.getByRole("heading", { level: 1, name: "Compare design systems" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Compare these \d+/ })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
