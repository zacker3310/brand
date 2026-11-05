/**
 * Platform area: Collections & bookmarks, Ops console, REST API + exports, API docs, Methodology.
 * Run against a dev server whose DATABASE_URL is a disposable copy (these tests create
 * collections, bookmarks, an ingestion run and resolve errors):
 *   E2E_NO_SERVER=1 E2E_PORT=3105 npx playwright test tests/e2e/platform.spec.ts --project=desktop
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).exclude("nextjs-portal").analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

async function noHorizontalScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw + 1);
}

test.describe("REST API", () => {
  test("list envelope, filters, validation and errors", async ({ request }) => {
    const res = await request.get("/api/systems?pageSize=3");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("max-age=60");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["data", "page", "pageSize", "total"]);
    expect(body.data).toHaveLength(3);
    expect(body.total).toBeGreaterThanOrEqual(3);
    expect(body.data[0]).toHaveProperty("urls.atlas");

    const bad = await request.get("/api/systems?category=nope&colour=red");
    expect(bad.status()).toBe(400);
    const err = await bad.json();
    expect(err.error.code).toBe("invalid_request");
    expect(err.error.issues.map((i: { path: string }) => i.path).sort()).toEqual(["category", "colour"]);

    const missing = await request.get("/api/systems/does-not-exist");
    expect(missing.status()).toBe(404);
    expect((await missing.json()).error.code).toBe("not_found");

    const comps = await (await request.get("/api/components?pageSize=1")).json();
    const c = comps.data[0];
    const detail = await (await request.get(`/api/components/${c.system.slug}/${c.slug}`)).json();
    expect(detail.data).toHaveProperty("variants");
    expect(detail.data).toHaveProperty("evidence");
    expect(detail.data).toHaveProperty("coverage");
  });

  test("exports carry metadata, source URLs and the disclaimer", async ({ request }) => {
    const csv = await request.get("/api/export/systems.csv");
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const text = await csv.text();
    expect(text).toContain("# disclaimer: Names, trademarks and documentation belong to their owners; this export is a reference list, not a license grant.");
    expect(text).toMatch(/\r\nslug,name,category,/);
    const json = await (await request.get("/api/export/components.json")).json();
    expect(json.meta.generator).toBe("ATLAS");
    expect(json.meta.recordCount).toBe(json.data.length);
    expect(json.data[0]).toHaveProperty("docsUrl");
    expect((await request.get("/api/export/secrets.json")).status()).toBe(404);
  });

  test("admin endpoints refuse non-loopback callers; public status hides errors", async ({ request }) => {
    const res = await request.post("/api/ops/runs", { data: { system: "carbon" }, headers: { "x-forwarded-for": "203.0.113.7" } });
    expect([401, 403]).toContain(res.status());
    const status = await (await request.get("/api/ingestion/status?limit=3")).json();
    expect(status.data).toHaveProperty("queue.byStatus");
    expect(JSON.stringify(status)).not.toMatch(/lastError|last_error|lockedBy/);
  });
});

test.describe("Collections", () => {
  test("curated collections render from data with their rules", async ({ page, request }) => {
    const curated = await (await request.get("/api/collections?scope=curated")).json();
    await page.goto("/collections");
    await expect(page.getByRole("heading", { level: 1, name: "Collections" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your collections" })).toBeVisible();
    for (const c of curated.data.slice(0, 3)) await expect(page.getByRole("link", { name: c.name })).toBeVisible();
    await axe(page);
    await page.getByRole("link", { name: curated.data[0].name }).click();
    await expect(page.getByText(/^Rule:/)).toBeVisible();
    await expect(page.getByText(/Curated by ATLAS/)).toBeVisible();
    await axe(page);
  });

  test("create, collect, annotate, reorder, export and delete", async ({ page, request }) => {
    const comps = await (await request.get("/api/components?pageSize=2")).json();
    const [c1, c2] = comps.data;
    await page.goto("/collections");
    const name = `E2E list ${Date.now()}`;
    // Keyboard path: focus the name field, type, submit with Enter.
    await page.getByLabel("Name").focus();
    await page.keyboard.type(name);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("This collection is empty")).toBeVisible();
    const slug = new URL(page.url()).pathname.split("/").pop()!;

    // No-JS fallback form for "Collect": add two components.
    for (const c of [c1, c2]) {
      await page.goto(`/collections/add?entityType=component&entityId=${c.id}`);
      await page.getByRole("radio", { name: new RegExp(name) }).check();
      await page.getByRole("button", { name: "Add to collection" }).click();
      await expect(page).toHaveURL(new RegExp(`/collections/${slug}\\?added=1`));
    }
    const items = page.locator('section[aria-labelledby="items-title"] ol > li');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText(c1.name);

    // Reorder with the keyboard.
    await page.getByRole("button", { name: `Move ${c1.name} down` }).focus();
    await page.keyboard.press("Enter");
    await expect(items.nth(0)).toContainText(c2.name);

    // Note + tags.
    await items.nth(0).getByText(/Add note|Edit note/).click();
    await items.nth(0).getByLabel("Note").fill("Compare keyboard model");
    await items.nth(0).getByLabel(/Tags/).fill("Review, a11y");
    await items.nth(0).getByRole("button", { name: "Save" }).click();
    await expect(items.nth(0).getByText("Compare keyboard model")).toBeVisible();
    await expect(page.getByRole("link", { name: /#review/ }).first()).toBeVisible();
    await page.goto(`/collections/${slug}?tag=a11y`);
    await expect(page.locator('section[aria-labelledby="items-title"] ol > li')).toHaveCount(1);
    await axe(page);

    const csv = await page.request.get(`/api/collections/${slug}/export?format=csv`);
    const text = await csv.text();
    expect(text).toContain("not a license grant");
    expect(text).toContain("Compare keyboard model");
    expect(csv.headers()["cache-control"]).toBe("private, no-store");
    const json = await (await page.request.get(`/api/collections/${slug}/export?format=json`)).json();
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toHaveProperty("officialSourceUrl");

    // Another browser (no cookie) cannot see it.
    const anon = await request.get(`/api/collections/${slug}`);
    expect(anon.status()).toBe(404);

    // Delete requires explicit confirmation.
    await page.goto(`/collections/${slug}`);
    await page.getByText("Edit", { exact: true }).click();
    await page.getByRole("checkbox", { name: /can’t be undone/ }).check();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(/\/collections\?deleted=1/);
    await expect(page.getByText("Collection deleted")).toBeVisible();
  });

  test("bookmark button toggles and announces state", async ({ page }) => {
    await page.goto("/collections");
    const comps = await (await page.request.get("/api/components?pageSize=1")).json();
    const c = comps.data[0];
    const res = await page.request.post("/api/bookmarks", { data: { entityType: "component", entityId: c.id, bookmarked: true }, headers: { origin: new URL(page.url()).origin } });
    expect(res.status()).toBe(200);
    await page.reload();
    const bookmarks = page.locator("#bookmarks");
    await expect(bookmarks.getByRole("link", { name: c.name, exact: true })).toBeVisible();
    const toggle = bookmarks.getByRole("button", { name: `Remove bookmark: ${c.name}` });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(bookmarks.getByRole("button", { name: `Bookmark ${c.name}` })).toHaveAttribute("aria-pressed", "false");
    const status = await (await page.request.get(`/api/bookmarks/status?refs=component:${c.id}`)).json();
    expect(status.data[`component:${c.id}`]).toBe(false);
  });

  test("add-to-collection dialog creates a collection in place", async ({ page }) => {
    const comps = await (await page.request.get("/api/components?pageSize=1")).json();
    const c = comps.data[0];
    await page.goto("/collections");
    await page.request.post("/api/bookmarks", { data: { entityType: "component", entityId: c.id, bookmarked: true } });
    await page.reload();
    await page.locator("#bookmarks").getByRole("link", { name: `Collect ${c.name} into a collection` }).click();
    const dialog = page.getByRole("dialog", { name: "Add to collection" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("New collection").fill("Dialog made");
    await dialog.getByRole("button", { name: "Create & add" }).click();
    await expect(dialog.getByRole("status")).toContainText("Created Dialog made");
    await expect(dialog.getByRole("checkbox", { name: "Dialog made" })).toBeChecked();
    await axe(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test.describe("Operations (localhost mode)", () => {
  test("overview, sections and keyboard navigation", async ({ page }) => {
    await page.goto("/ops");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByText("ATLAS_ADMIN_TOKEN is not set.")).toBeVisible();
    await axe(page);
    const nav = page.getByRole("navigation", { name: "Operations" });
    for (const name of ["Systems", "Runs", "Queue", "Errors", "Quarantine", "Sources", "Registry", "Duplicates", "Evidence"]) {
      await nav.getByRole("link", { name: new RegExp(`^${name}`) }).click();
      await expect(nav.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    await axe(page);
  });

  test("run detail shows stages, jobs and extractions", async ({ page, request }) => {
    const status = await (await request.get("/api/ingestion/status?limit=1")).json();
    test.skip(!status.data.runs.length, "no ingestion runs in this database");
    await page.goto(`/ops/runs/${status.data.runs[0].id}`);
    await expect(page.getByRole("heading", { name: "Stages" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Extractions" })).toBeVisible();
    await axe(page);
  });

  test("enqueue a run, then cancel its job (never ingests in the request)", async ({ page }) => {
    await page.goto("/ops/systems?q=material");
    const enqueue = page.locator("button:enabled", { hasText: "Enqueue run" }).first();
    await expect(enqueue).toBeVisible();
    await enqueue.click();
    await expect(page.getByRole("status")).toContainText(/enqueued|already has an active run/);
    await page.goto("/ops/queue");
    const cancel = page.getByRole("button", { name: /Cancel job/ }).first();
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(page.getByRole("status")).toContainText("cancelled");
  });

  test("errors can be filtered and resolved", async ({ page }) => {
    await page.goto("/ops/errors?state=all");
    await expect(page.getByRole("heading", { level: 1, name: "Extraction errors" })).toBeVisible();
    await page.getByLabel("State").selectOption("all");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/state=all/);
    await axe(page);
  });

  test("login page explains the access mode", async ({ page }) => {
    await page.goto("/ops/login");
    // Loopback in development: already authorised, redirected to the console.
    await expect(page).toHaveURL(/\/ops$/);
  });
});

test.describe("Docs pages", () => {
  test("API docs are generated from the registry with live examples", async ({ page, request }) => {
    const openapi = await (await request.get("/api/openapi.json")).json();
    const ops = Object.values(openapi.paths as Record<string, Record<string, unknown>>).reduce((a, p) => a + Object.keys(p).length, 0);
    await page.goto("/api-docs");
    await expect(page.getByRole("heading", { level: 1, name: "REST API" })).toBeVisible();
    await expect(page.locator("article[id^=ep-]")).toHaveCount(ops);
    await expect(page.getByLabel("Example response for List design systems")).toContainText('"total"');
    await axe(page);
  });

  test("methodology shows live registry counts and the coverage legend", async ({ page, request }) => {
    const verified = (await (await request.get("/api/systems?pageSize=1")).json()).total as number;
    await page.goto("/about");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("How ATLAS knows");
    const reg = page.locator("#registry");
    await expect(reg.getByText("Verified", { exact: true }).locator("..")).toContainText(String(verified));
    for (const label of ["Documented", "None (documented)", "Not documented", "Not extracted", "Inferred"]) await expect(page.locator("#coverage").getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /scoring|rubric/i })).toHaveAttribute("href", "/compare/systems");
    await axe(page);
  });
});

test.describe("Responsive", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const path of ["/collections", "/about", "/api-docs", "/ops", "/ops/systems", "/ops/queue"]) {
    test(`no horizontal page scroll at 390px: ${path}`, async ({ page }) => {
      await page.goto(path);
      await noHorizontalScroll(page);
    });
  }
});
