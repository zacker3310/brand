/**
 * Production QA sweep: full-page axe (shell included, no exclusions) and screenshots for the main
 * routes, in both color schemes. The desktop project runs at 1440px, the mobile project at 390px.
 *
 *   E2E_NO_SERVER=1 E2E_PORT=3120 npx playwright test tests/e2e/qa.spec.ts
 *
 * Results land in .cache/qa/axe/<project>-<scheme>-<route>.json (every violation, any impact) and
 * screenshots in .cache/screens/qa/<width>-<scheme>-<route>.png (viewport) and -full.png (full page).
 * The test fails on serious or critical violations only; moderate/minor ones are recorded.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

test.describe.configure({ timeout: 120_000 });

export const QA_ROUTES: [name: string, url: string][] = [
  ["home", "/"],
  ["systems", "/systems"],
  ["system-carbon", "/systems/carbon"],
  ["system-bootstrap", "/systems/bootstrap"],
  ["system-apple-hig", "/systems/apple-hig"],
  ["components", "/components"],
  ["component-type-button", "/components/button"],
  ["component-primer-action-menu", "/systems/github-primer/components/action-menu"],
  ["compare-button", "/compare?type=button&systems=github-primer,carbon,material-web"],
  ["compare-systems", "/compare/systems?systems=github-primer,carbon,ant-design"],
  ["tokens", "/tokens"],
  ["tokens-spectrum", "/tokens?system=adobe-spectrum"],
  ["patterns", "/patterns"],
  ["collections", "/collections"],
  ["about", "/about"],
  ["api-docs", "/api-docs"],
  ["search", "/search?q=react%20combobox"],
];

const SHOTS = path.resolve(".cache/screens/qa");
const AXE = path.resolve(".cache/qa/axe");

type Finding = { route: string; id: string; impact: string | null | undefined; help: string; nodes: number; targets: string[] };

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  // Web fonts change metrics; screenshots and contrast checks should see the final render.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });
    for (const [name, url] of QA_ROUTES) {
      test(`${name}: full-page axe + screenshots`, async ({ page }, info) => {
        const width = info.project.name === "mobile" ? 390 : 1440;
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        const res = await page.goto(url);
        expect(res?.status(), url).toBe(200);
        await expect(page.locator("main h1").first()).toBeVisible();
        await settle(page);
        // next-themes applies the resolved scheme as a class on <html>.
        await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${scheme}\\b`));

        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${width}-${scheme}-${name}.png`) });
        await page.screenshot({ path: path.join(SHOTS, `${width}-${scheme}-${name}-full.png`), fullPage: true });

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${url} scrolls horizontally`).toBeLessThanOrEqual(0);

        // @axe-core/playwright types its Page against its own playwright-core copy.
        const results = await new AxeBuilder({ page } as unknown as ConstructorParameters<typeof AxeBuilder>[0])
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const findings: Finding[] = results.violations.map((v) => ({ route: url, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
        mkdirSync(AXE, { recursive: true });
        writeFileSync(path.join(AXE, `${info.project.name}-${scheme}-${name}.json`), JSON.stringify({ passes: results.passes.length, violations: findings }, null, 2));
        const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
      });
    }
  });
}
