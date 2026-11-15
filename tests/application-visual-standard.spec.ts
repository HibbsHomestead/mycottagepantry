import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from "./workspace-fixture";
import { demoData } from "../src/lib/demo";
import { bookSummary } from "../src/lib/checkbook";
const phase = process.env.VISUAL_PHASE || "after";
const pages = {
  dashboard: "Dashboard",
  inventory: "Inventory/Ingredients",
  recipes: "Production/Recipes & Designs",
  products: "Products/All Products",
  handmade: "Handmade/Overview",
  production: "Production/Production Runs",
  sales: "Sales/Sales",
  labels: "Labels/Labels",
  finance: "Finance/Register",
  settings: "Settings/Business Profile",
  purchasing: "Purchasing/Purchases & Receipts",
};
for (const [width, height] of [
  [1366, 768],
  [1440, 1000],
  [2560, 1000],
  [390, 844],
]) {
  test(`application reference ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height });
    await installWorkspaceFixture(page);
    const w = demoData();
    await page.route("**/api/workspace*", async (route) => {
      expect(route.request().method()).toBe("GET");
      const url = new URL(route.request().url());
      w.bookkeeping = [
        bookSummary(
          w,
          url.searchParams.get("bookFrom") || "2026-01-01",
          url.searchParams.get("bookTo") || "2026-12-31",
        ),
      ];
      await route.fulfill({
        json: { workspace: w, role: "Owner", demo: true },
      });
    });
    const measurements: Record<string, unknown> = {};
    const directory = `docs/reviews/application-standard/${phase}`;
    mkdirSync(directory, { recursive: true });
    for (const [name, route] of Object.entries(pages)) {
      await page.goto(workspaceFixtureUrl(route));
      await expect(page.locator("main.app-page")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `${directory}/${name}-${width}.png`,
        animations: "disabled",
      });
      measurements[name] = await page.evaluate(() => {
        const main = document.querySelector("main.app-page")!;
        const candidates = [
          ...main.querySelectorAll(
            "tbody > tr, .pantry-card, .recipe-card, .product-card-photo-first, .finance-list-row--receipt, .batch-card",
          ),
        ].filter((el) => el.getBoundingClientRect().height > 0);
        const first = candidates[0]?.getBoundingClientRect();
        const header = main
          .querySelector(".page-heading")!
          .getBoundingClientRect();
        return {
          firstRowY: first ? Math.round(first.top) : null,
          visibleRows: candidates.filter((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.top >= 0 &&
              r.bottom <= innerHeight - (innerWidth <= 700 ? 80 : 0)
            );
          }).length,
          headerBottom: Math.round(header.bottom),
          pageX: Math.round(main.getBoundingClientRect().x),
          overflow: document.documentElement.scrollWidth > innerWidth,
          font: getComputedStyle(main).fontFamily,
          navs: main.querySelectorAll(".section-tabs, .book-nav, .settings-nav")
            .length,
        };
      });
      expect((measurements[name] as { overflow: boolean }).overflow, name).toBe(
        false,
      );
    }
    writeFileSync(
      `${directory}/measurements-${width}.json`,
      JSON.stringify(measurements, null, 2),
    );
  });
}
