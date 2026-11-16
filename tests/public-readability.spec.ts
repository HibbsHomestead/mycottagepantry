import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { accessFixture } from "./account-access-fixture";
import { installPublicPlanFixture } from "./public-plan-fixture";

const phase = process.env.READABILITY_PHASE === "before" ? "before" : "after";
const directory = "docs/reviews/public-readability";
test("public readability, responsive widths and rendered evidence", async ({
  page,
}) => {
  test.setTimeout(240000);
  mkdirSync(directory, { recursive: true });
  await installPublicPlanFixture(page);
  const measurements: unknown[] = [];
  const routes = [
    ["home", "/"],
    ["features", "/features"],
    ["pricing", "/pricing"],
    ["signup", "/signup"],
    ["login", "/login"],
    ["recovery", "/recover"],
    ["verification", "/verify-email"],
  ] as const;
  for (const width of [390, 768, 1366, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, path] of routes) {
      await page.route("**/api/account-access**", (route) =>
        route.fulfill({
          json: accessFixture(
            name === "verification" ? "email_unverified" : "signed_out",
          ),
        }),
      );
      await page.goto(path + "?cover-preview=1");
      await expect(page.locator(".public-site")).toBeVisible();
      if (name === "pricing")
        await expect(page.locator(".plan-card").last()).toBeVisible();
      await expect(page.locator(".cover-background")).toBeVisible();
      if (name === "pricing")
        await expect(
          page.getByText("Checking availability…", { exact: true }),
        ).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      const sizes = await page.evaluate(() => {
        const read = (s: string) => {
          const el = document.querySelector(s);
          return el ? getComputedStyle(el).fontSize : null;
        };
        return {
          body: read(".public-site"),
          navigation: read(".public-header nav"),
          description: read(".plan-audience"),
          button: read(".public-button"),
          comparison: read(".plan-details-table td"),
          input: read(".public-auth input, .registration-form input"),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      measurements.push({ width, name, ...sizes });
      if (phase === "after") {
        expect(sizes.overflow, `${name} at ${width}`).toBe(false);
        expect(parseFloat(sizes.body!)).toBeGreaterThanOrEqual(18);
        for (const key of [
          "navigation",
          "button",
          "description",
          "comparison",
          "input",
        ] as const)
          if (sizes[key])
            expect(parseFloat(sizes[key]!)).toBeGreaterThanOrEqual(16);
      }
      if (
        [390, 1440].includes(width) &&
        !["recovery", "verification"].includes(name)
      ) {
        await page.screenshot({
          path: `${directory}/${phase}-${name}-${width}.webp`,
          fullPage: true,
          animations: "disabled",
        });
        if (name === "pricing")
          await page.locator(".plan-table-scroll").screenshot({
            path: `${directory}/${phase}-comparison-${width}.webp`,
          });
      }
    }
  }
  // A 1440px browser at 200% zoom has a 720 CSS-pixel layout viewport.
  await page.setViewportSize({ width: 720, height: 500 });
  for (const [name, path] of routes) {
    await page.route("**/api/account-access**", (route) =>
      route.fulfill({
        json: accessFixture(
          name === "verification" ? "email_unverified" : "signed_out",
        ),
      }),
    );
    await page.goto(path + "?cover-preview=1");
    await expect(page.locator(".public-site")).toBeVisible();
    if (phase === "after")
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        name + " 200% equivalent",
      ).toBe(true);
  }
  writeFileSync(
    `${directory}/${phase}-measurements.json`,
    JSON.stringify(measurements, null, 2),
  );
});

test("public typography follows browser text resizing", async ({ page }) => {
  await installPublicPlanFixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const path of ["/", "/pricing", "/signup", "/login"]) {
    await page.goto(path + "?cover-preview=1");
    await expect(page.locator(".public-site")).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    expect(
      await page
        .locator(".public-site")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBe(36);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
