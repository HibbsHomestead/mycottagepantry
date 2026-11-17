import { test, expect } from "@playwright/test";
import { installPublicPlanFixture } from "./public-plan-fixture";

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

for (const width of [390, 820, 1366, 1920, 2560]) {
  test(`ordinary public layout and current screenshots fit at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await installPublicPlanFixture(page);
    await page.route("**/api/workspace*", (route) => route.abort());
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ["/", "/features", "/pricing"]) {
      await page.goto(path, { waitUntil: "networkidle" });
      await expect(page.locator(".public-site")).toBeVisible();
      expect(new URL(page.url()).search).toBe("");
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.locator(".public-header").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { width: r.width, left: r.left, right: r.right };
      });
      expect(geometry.width).toBe(Math.min(width, 1600));
      expect(
        Math.abs(geometry.left - (width - geometry.right)),
      ).toBeLessThanOrEqual(1);
      for (const selector of [
        ".public-footer",
        ".public-page-intro:not(.narrow)",
        ".public-hero",
        ".tour-sections",
        ".pricing-width",
      ]) {
        for (const element of await page.locator(selector).all()) {
          const box = await element.boundingBox();
          expect(box!.width).toBeLessThanOrEqual(1600);
          expect(
            Math.abs(box!.x - (width - box!.x - box!.width)),
          ).toBeLessThanOrEqual(1);
        }
      }
      for (const img of await page.locator('img[src^="/screenshots/"]').all()) {
        await img.scrollIntoViewIfNeeded();
        await img.evaluate(async (el) => {
          await (el as HTMLImageElement).decode();
        });
        const image = await img.evaluate((el) => {
          const image = el as HTMLImageElement;
          const box = image.getBoundingClientRect();
          return {
            source: image.currentSrc,
            natural: image.naturalWidth,
            ratio: box.width / box.height,
            nativeRatio: image.naturalWidth / image.naturalHeight,
          };
        });
        expect(image.source).toContain("/screenshots/current-");
        expect(image.natural).toBeGreaterThan(0);
        expect(Math.abs(image.ratio - image.nativeRatio)).toBeLessThan(0.02);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      if (path === "/") {
        const hero = await page.locator(".public-hero").evaluate((el) => ({
          minimum: getComputedStyle(el).minHeight,
          padding: parseFloat(getComputedStyle(el).paddingTop),
          columns: getComputedStyle(el).gridTemplateColumns.split(" ").length,
        }));
        expect(hero.minimum).toBe("0px");
        expect(hero.padding).toBeLessThanOrEqual(36);
        expect(hero.columns).toBe(width <= 1000 ? 1 : 2);
        await page.screenshot({
          path: `/tmp/public-current-${width}.png`,
          fullPage: true,
        });
      }
    }
  });
}
