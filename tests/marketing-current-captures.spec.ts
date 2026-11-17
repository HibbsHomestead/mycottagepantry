import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { marketingDemo } from "./marketing-demo-fixture";
import { systemLabelTemplates } from "../src/lib/label-studio";
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from "./workspace-fixture";

test("refresh marketing assets from the current app with isolated sample photographs", async ({
  browser,
}) => {
  test.setTimeout(240000);
  for (const mobile of [false, true]) {
    const width = mobile ? 390 : 1440;
    const height = mobile ? 693 : 1080;
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      colorScheme: "light",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const workspace = marketingDemo();
    workspace.settings[0].currentPantryView = mobile ? "table" : "cards";
    workspace.label_templates = [
      {
        ...structuredClone(systemLabelTemplates[0]),
        id: "sample-loaf-label",
        name: "White bread · demonstration design",
        isSystem: false,
        revision: 1,
      },
    ];
    await installWorkspaceFixture(page);
    const writes: string[] = [];
    await page.route("**/api/**", (route) => {
      const request = route.request();
      if (request.method() !== "GET")
        writes.push(request.method() + " " + new URL(request.url()).pathname);
      if (
        request.method() === "GET" &&
        new URL(request.url()).pathname === "/api/workspace"
      )
        return route.fulfill({
          json: { workspace, role: "Owner", demo: true },
        });
      return route.abort();
    });
    for (const [name, section] of [
      ["pantry", "Inventory/Ingredients"],
      ["recipes", "Recipes"],
      ["products", "Products/All Products"],
      ["costing", "Recipes"],
      ["production", "Production/Production Runs"],
      ["labels", "Labels"],
      ["finances", "Finance/Tax Center"],
    ]) {
      if (
        process.env.MARKETING_CAPTURE_VIEW &&
        process.env.MARKETING_CAPTURE_VIEW !== name
      )
        continue;
      console.log("Capturing", name, mobile ? "phone" : "desktop");
      await page.setViewportSize(
        !mobile && name === "labels"
          ? { width: 1920, height: 1440 }
          : { width, height },
      );
      await page.goto(workspaceFixtureUrl(section));
      await expect(page.locator(".app-shell")).toBeVisible();
      await expect(page.locator(".page-heading")).toBeVisible();
      if (name === "pantry") {
        await page
          .getByRole("combobox", { name: "Filter by category", exact: true })
          .selectOption({ label: "Market staples" });
        await expect(
          page.locator(mobile ? ".pantry-table tbody tr" : ".pantry-card"),
        ).toHaveCount(9);
      }
      if (name === "costing") {
        await page
          .locator(".recipe-card")
          .filter({ hasText: "Homestyle White Bread" })
          .click();
        await page
          .getByRole("dialog")
          .getByText("Cost breakdown", { exact: true })
          .click();
      }
      if (name === "labels") {
        await page
          .getByRole("button", {
            name: "Edit White bread · demonstration design",
            exact: true,
          })
          .click();
        await expect(page.locator(".studio-editor")).toBeVisible();
        await page
          .getByRole("combobox", { name: "Product", exact: true })
          .first()
          .selectOption("loaf");
        if (mobile) {
          for (let i = 0; i < 4; i++)
            await page
              .getByRole("button", { name: "Zoom out", exact: true })
              .click();
        }
      }
      await page.evaluate(() => document.fonts.ready);
      // Load every sample photograph, including native lazy images, before capture.
      await page.locator(".pantry-photo img").evaluateAll(async (images) => {
        await Promise.all(
          images.map(async (image) => {
            const img = image as HTMLImageElement;
            img.loading = "eager";
            await img.decode();
          }),
        );
      });
      await expect(
        page.locator('.pantry-photo[data-photo-state="loading"]'),
      ).toHaveCount(0);
      if (["pantry", "recipes", "products"].includes(name)) {
        expect(
          await page.locator(".pantry-photo img").count(),
        ).toBeGreaterThanOrEqual(3);
        await expect(
          page.locator('.pantry-photo[data-photo-state="missing"]'),
        ).toHaveCount(0);
      }
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
        timeout: 15000,
      });
      await page.mouse.move(0, 0);
      await page.evaluate(() => window.scrollTo(0, 0));
      if (name === "products")
        await page.locator(".product-card").first().scrollIntoViewIfNeeded();
      if (name === "pantry")
        await page
          .locator(mobile ? ".pantry-table" : ".pantry-card")
          .first()
          .evaluate((el) => el.scrollIntoView({ block: "start" }));
      if (name === "recipes")
        await page
          .locator(".recipe-card")
          .first()
          .evaluate((el) => el.scrollIntoView({ block: "start" }));
      if (name === "labels")
        await page
          .locator(".studio-stage-area")
          .evaluate((el) => el.scrollIntoView({ block: "start" }));
      const shot = await page.screenshot({ animations: "disabled" });
      await sharp(shot)
        .resize(mobile ? 780 : 2000, mobile ? 1386 : 1500)
        .webp({ quality: 90 })
        .toFile(
          `public/screenshots/current-${name}${mobile ? "-mobile" : ""}.webp`,
        );
      if (name === "products" && !mobile) {
        await sharp(shot)
          .extract({ left: 0, top: 0, width: 2880, height: 1920 })
          .resize(2160, 1440)
          .webp({ quality: 90 })
          .toFile("public/screenshots/current-hero.webp");
      }
    }
    expect(writes).toEqual([]);
    await context.close();
  }
});
