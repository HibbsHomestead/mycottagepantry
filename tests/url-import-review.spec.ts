import { expect, test } from "@playwright/test";
import { demoData } from "../src/lib/demo";
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from "./workspace-fixture";
for (const width of [1440, 390])
  test(`URL review stays separate from unsaved package editor at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await installWorkspaceFixture(page);
    const workspace = demoData();
    let writes = 0;
    const saved: any[] = [];
    await page.route("**/api/workspace*", (route) => {
      if (route.request().url().includes("productImport"))
        return route.fulfill({
          json: {
            products: [
              {
                title: "Cookie bags 100 count",
                fields: {
                  name: "Cookie bags",
                  packagePrice: 12.5,
                  currency: "USD",
                  purchaseUnit: "package",
                  amountPerPackage: 100,
                  unit: "each",
                },
                sourceUrl: "https://test.invalid/bags",
                imageUrl: "",
                checkedAt: "2026-11-22T00:00:00Z",
                warnings: [],
                conditions: [],
              },
            ],
          },
        });
      if (route.request().method() === "POST") {
        writes++;
        saved.push(route.request().postDataJSON());
      }
      return route.fulfill({ json: { workspace, role: "Owner", demo: false } });
    });
    await page.goto(workspaceFixtureUrl("Inventory/Ingredients"));
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    const editor = page.getByRole("dialog").first();
    await editor
      .getByLabel("Item Type", { exact: true })
      .selectOption("packaging");
    if (
      await editor.getByRole("button", { name: "URL", exact: true }).isVisible()
    )
      await editor.getByRole("button", { name: "URL", exact: true }).click();
    await editor
      .getByLabel("Product URL", { exact: true })
      .fill("https://test.invalid/bags");
    await editor
      .getByRole("button", { name: "Import details", exact: true })
      .click();
    const review = page.getByRole("dialog", {
      name: "Review imported information",
    });
    await expect(review).toBeVisible();
    expect(writes).toBe(0);
    await review
      .getByRole("button", { name: "Select all", exact: true })
      .click();
    await expect(review.getByText(/12.5 ÷ 100 = 0.125/)).toBeVisible();
    const accept = review.getByRole("button", {
      name: "Accept & use information",
      exact: true,
    });
    await accept.scrollIntoViewIfNeeded();
    await expect(accept).toBeVisible();
    expect(
      await review.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({ path: `/tmp/cottage-import-review-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(review).toBeHidden();
    await expect(editor).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Import details", exact: true }),
    ).toBeFocused();
    expect(writes).toBe(0);
    await editor
      .getByRole("button", { name: "Import details", exact: true })
      .click();
    await review
      .getByRole("button", { name: "Select all", exact: true })
      .click();
    await review
      .getByRole("button", { name: "Accept & use information", exact: true })
      .click();
    await expect(review).toBeHidden();
    expect(writes).toBe(0);
    await editor
      .getByRole("tab", { name: "Purchase & Stock", exact: true })
      .click();
    await expect(
      editor.getByLabel("Amount in each package", { exact: true }),
    ).toHaveValue("100");
    await expect(
      editor.getByLabel("Purchase unit", { exact: true }),
    ).toHaveValue("package");
    await editor
      .getByRole("button", { name: "Save item", exact: true })
      .click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toMatchObject({
      action: "save",
      table: "ingredients",
      data: {
        inventoryPackageSetup: true,
        initialStock: false,
        purchaseUnit: "package",
        amountPerPackage: 100,
        packagePrice: 12.5,
        unit: "each",
      },
    });
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
