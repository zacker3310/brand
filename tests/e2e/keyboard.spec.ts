/**
 * Keyboard-only journeys across the shell and the main interactive surfaces. Every focus stop is
 * checked for a visible focus indicator (outline or ring box-shadow), and no journey may trap focus.
 *
 *   E2E_NO_SERVER=1 E2E_PORT=3120 npx playwright test tests/e2e/keyboard.spec.ts
 */
import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

type Stop = { tag: string; name: string; visible: boolean; indicator: boolean };

/** Describes document.activeElement: what it is and whether its focus is visibly indicated. */
async function activeStop(page: Page): Promise<Stop> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { tag: "body", name: "", visible: false, indicator: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
    const ring = cs.boxShadow !== "none" && cs.boxShadow !== "";
    // A peer-focus pattern (sr-only input, styled label) shows the ring on the associated label.
    const label = el.id ? (document.querySelector(`label[for="${CSS.escape(el.id)}"]`) as HTMLElement | null) : null;
    const lcs = label ? getComputedStyle(label) : null;
    const labelRing = !!lcs && ((lcs.boxShadow !== "none" && lcs.boxShadow !== "") || (lcs.outlineStyle !== "none" && parseFloat(lcs.outlineWidth) > 0));
    const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    return { tag: el.tagName.toLowerCase(), name, visible: r.width > 0 && r.height > 0, indicator: outline || ring || labelRing };
  });
}

async function tabTo(page: Page, n: number, opts: { shift?: boolean } = {}) {
  const stops: Stop[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press(opts.shift ? "Shift+Tab" : "Tab");
    stops.push(await activeStop(page));
  }
  return stops;
}

test.describe("shell", () => {
  test("header: skip link, home, primary nav, search trigger, theme menu, all with visible focus", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "the primary nav collapses into a menu button on phones (covered below)");
    await page.goto("/systems");
    await page.locator("body").press("Tab");
    const skip = await activeStop(page);
    expect(skip.name).toBe("Skip to content");
    expect(skip.visible && skip.indicator).toBe(true);
    const stops = [skip, ...(await tabTo(page, 9))];
    const names = stops.map((s) => s.name);
    expect(names).toEqual([
      "Skip to content",
      "ATLAS home",
      "Systems",
      "Components",
      "Compare",
      "Tokens",
      "Patterns",
      "Collections",
      "Search systems, components, tokens and patterns",
      "Change color theme",
    ]);
    for (const s of stops) expect(s.visible && s.indicator, `focus indicator on ${s.name}`).toBe(true);
    // The current section is marked.
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Systems" })).toHaveAttribute("aria-current", "page");
    // Theme menu opens with the keyboard and Escape returns focus to its trigger.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitemradio", { name: "Dark" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Change color theme" })).toBeFocused();
    // Skip link moves focus past the header.
    await page.goto("/systems");
    await page.locator("body").press("Tab");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("#main"))).toBe(true);
  });

  test("phone header: menu button opens the nav; Escape closes it and returns focus", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "phone layout only");
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Open navigation" });
    await menu.focus();
    expect((await activeStop(page)).indicator).toBe(true);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("link", { name: "Systems" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(menu).toBeFocused();
  });

  test("Ctrl/Cmd+K palette: type a query, arrow to a result, Enter navigates; Escape restores focus", async ({ page }) => {
    await page.goto("/about");
    const trigger = page.getByRole("button", { name: "Search systems, components, tokens and patterns" });
    await trigger.focus();
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Search ATLAS" });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole("combobox");
    await expect(input).toBeFocused();
    // Escape closes and returns focus to where it was.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press("ControlOrMeta+k");
    await expect(input).toBeFocused();
    // Results arrive (debounced) from /api/search; wait for the full query's response.
    const settled = page.waitForResponse((r) => r.url().includes("/api/search?q=carbon&"));
    await page.keyboard.type("carbon");
    await settled;
    const options = dialog.getByRole("option");
    const carbon = options.filter({ hasText: "IBM Carbon Design System" }).first();
    await expect(carbon).toBeVisible();
    // From the first option, arrow until the Carbon system option is the active descendant, then Enter.
    await page.keyboard.press("Home");
    for (let i = 0; i < 24 && (await carbon.getAttribute("aria-selected")) !== "true"; i++) await page.keyboard.press("ArrowDown");
    await expect(carbon).toHaveAttribute("aria-selected", "true");
    await expect(input).toBeFocused();
    const href = await page.evaluate(async () => {
      const r = await fetch("/api/search?q=carbon&limit=24");
      const j = (await r.json()) as { hits: { title: string; url: string }[] };
      return j.hits.find((h) => h.title === "IBM Carbon Design System")?.url ?? null;
    });
    expect(href).toBeTruthy();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${href!.replace(/[.?*+^$()|[\]\\]/g, "\\$&")}$`));
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Carbon");
  });

  test("palette: the last option is 'See all results' and Enter opens /search", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Search ATLAS" });
    await page.keyboard.type("react combobox");
    const all = dialog.getByRole("option", { name: /See all results for “react combobox”/ });
    await expect(all).toBeVisible();
    await page.keyboard.press("End");
    await expect(all).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=react%20combobox/);
  });
});

test.describe("surfaces", () => {
  test("directory filters toggle with Space and update the URL; focus is visible on each facet", async ({ page }) => {
    await page.goto("/systems");
    await page.locator("form[data-enhanced]").waitFor();
    const toggle = page.locator("#filters-toggle");
    if (await page.locator("label[for='filters-toggle']").isVisible()) {
      await toggle.focus();
      expect((await activeStop(page)).indicator, "Filters disclosure focus").toBe(true);
      await page.keyboard.press("Space");
    }
    const box = page.locator("#f-depth-indexed");
    await box.focus();
    expect((await activeStop(page)).indicator, "facet checkbox focus").toBe(true);
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/depth=indexed/);
    await expect(page.locator("#f-depth-indexed")).toBeChecked();
    // Tab continues past the facet (no trap) to the next control.
    await page.locator("#f-depth-indexed").focus();
    await page.keyboard.press("Tab");
    expect((await activeStop(page)).tag).not.toBe("body");
  });

  test("compare picker: combobox and system checkboxes are keyboard operable with visible focus", async ({ page }) => {
    await page.goto("/compare");
    const combo = page.getByRole("combobox", { name: "Component type", exact: true });
    await expect(page.locator('button[role="combobox"]').first()).toBeVisible({ timeout: 30_000 });
    await combo.focus();
    expect((await activeStop(page)).indicator, "type combobox focus").toBe(true);
    await page.keyboard.press("Enter");
    await page.keyboard.type("tabs");
    await page.keyboard.press("Enter");
    await expect(combo).toContainText("Tabs");
    await expect(combo).toBeFocused();
    const picker = page.getByRole("group", { name: /Systems to compare/ });
    const first = picker.getByRole("checkbox").first();
    await first.focus();
    expect((await activeStop(page)).indicator, "system checkbox focus").toBe(true);
    await page.keyboard.press("Space");
    await expect(first).toBeChecked();
  });

  test("token explorer: category tabs reachable by Tab, Enter switches category, focus visible", async ({ page }) => {
    await page.goto("/tokens?system=github-primer");
    const tabs = page.getByRole("navigation", { name: "Token categories" }).getByRole("link");
    expect(await tabs.count()).toBe(9);
    const spacing = tabs.filter({ hasText: /^Spacing/ });
    await spacing.focus();
    const stop = await activeStop(page);
    expect(stop.visible && stop.indicator, "category tab focus").toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/category=spacing/);
    await expect(page.getByRole("navigation", { name: "Token categories" }).getByRole("link", { name: /^Spacing/ })).toHaveAttribute("aria-current", /page|true/);
    // View switcher (visual/table/...) is reachable next; nothing traps focus.
    await page.keyboard.press("Tab");
    expect((await activeStop(page)).tag).not.toBe("body");
  });
});
