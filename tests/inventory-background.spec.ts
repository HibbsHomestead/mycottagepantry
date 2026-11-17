import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { demoData } from "../src/lib/demo";
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from "./workspace-fixture";

test("approved artwork renders on ordinary Inventory loads and leaves with navigation", async ({
  page,
}) => {
  test.setTimeout(120000);
  mkdirSync("docs/reviews/inventory-background", { recursive: true });
  await installWorkspaceFixture(page);
  const workspace = demoData();
  workspace.settings[0].appearance = { theme: "cottage", mode: "light" };
  await page.route("**/api/workspace*", (route) =>
    route.fulfill({ json: { workspace, role: "Owner", demo: true } }),
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(workspaceFixtureUrl("Inventory/Ingredients"));
    await expect(page.locator(".pantry-summary")).toBeVisible();
    const art = page.locator(".inventory-background");
    await expect(art).toBeVisible();
    await expect(art.locator(".inventory-sprig")).toHaveCount(3);
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await expect(page.locator(".pantry-table")).toBeVisible();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
      timeout: 15000,
    });
    await page.screenshot({
      path: `docs/reviews/inventory-background/all-items-${width}.png`,
      fullPage: false,
    });
    await page
      .locator(".inventory-tabs")
      .getByRole("button", { name: /^Needs review/ })
      .click();
    await page
      .getByRole("textbox", { name: "Search pantry" })
      .fill("Bread flour");
    await expect(page.locator(".pantry-table tbody tr")).toHaveCount(1);
    await page.screenshot({
      path: `docs/reviews/inventory-background/needs-review-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.evaluate(() => {
      location.hash = "Recipes";
    });
    await expect(art).toHaveCount(0);
  }
  for (const [theme, mode] of [
    ["cottage", "dark"],
    ["orchard", "light"],
  ] as const) {
    workspace.settings[0].appearance = { theme, mode };
    await page.goto("about:blank");
    await page.goto(workspaceFixtureUrl("Inventory/Ingredients"));
    await expect(page.locator(".pantry-summary")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await page
      .locator(".inventory-tabs")
      .getByRole("button", { name: /^Needs review/ })
      .click();
    await page
      .getByRole("textbox", { name: "Search pantry" })
      .fill("Bread flour");
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
      timeout: 15000,
    });
    await page.screenshot({
      path: `docs/reviews/inventory-background/${theme}-${mode}-390.png`,
      fullPage: true,
    });
  }
});
