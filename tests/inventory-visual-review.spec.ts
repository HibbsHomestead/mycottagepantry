import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { accentThemes } from "../src/lib/appearance";
import { demoData } from "../src/lib/demo";
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from "./workspace-fixture";

const directory = "docs/reviews/inventory-refinement";
test("capture Inventory with identical records and state", async ({ page }) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(10000);
  mkdirSync(directory, { recursive: true });
  await installWorkspaceFixture(page);
  const workspace = demoData();
  workspace.settings[0].appearance = { theme: "cottage", mode: "light" };
  await page.route("**/api/workspace*", (route) => {
    return route.fulfill({ json: { workspace, role: "Owner", demo: true } });
  });
  const stage = process.env.INVENTORY_REVIEW_STAGE || "after";
  const contents: Record<string, unknown> = {};
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(
      workspaceFixtureUrl("Inventory/Ingredients").replace(
        "#",
        "&cover-preview=1#",
      ),
    );
    const main = page.locator("main.inventory-layout-page");
    await expect(main.locator(".pantry-summary")).toBeVisible();
    await main.getByRole("button", { name: "Table", exact: true }).click();
    await expect(main.locator(".pantry-table")).toBeVisible();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
      timeout: 15000,
    });
    await page.screenshot({
      path: `${directory}/${stage}-${width}.png`,
      fullPage: true,
    });
    contents[width] = {
      summary: await main.locator(".pantry-summary").innerText(),
      rows: await main.locator("tbody").innerText(),
      cells: await main.locator("tbody td").allTextContents(),
      headings: await main.locator("thead").innerText(),
    };
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  if (stage === "after") {
    const before = JSON.parse(
      readFileSync(`${directory}/before-content.json`, "utf8"),
    );
    for (const width of Object.keys(contents)) {
      const current = contents[width] as { summary: string; cells: string[] };
      expect(current.summary).toBe(before[width].summary);
      expect(current.cells).toEqual(before[width].cells);
    }
  }
  writeFileSync(
    `${directory}/${stage}-content.json`,
    JSON.stringify(contents, null, 2),
  );
});

test("preview palettes, responsive rows and existing actions", async ({
  page,
}) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(10000);
  await installWorkspaceFixture(page);
  const workspace = demoData();
  await page.route("**/api/workspace*", (route) =>
    route.fulfill({ json: { workspace, role: "Owner", demo: true } }),
  );
  const url = workspaceFixtureUrl("Inventory/Ingredients").replace(
    "#",
    "&cover-preview=1#",
  );
  for (const width of [320, 375, 390, 430, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(url);
    const main = page.locator("main.inventory-layout-page");
    await main.getByRole("button", { name: "Table", exact: true }).click();
    const table = main.locator(".pantry-table");
    await expect(table.locator("tbody tr")).toHaveCount(
      workspace.ingredients.filter(
        (i) => !["material", "packaging", "supply"].includes(i.usedAs),
      ).length,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    if (width <= 700) {
      await expect(table.locator("thead")).toBeHidden();
      expect(
        await table.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    } else {
      await expect(table.locator("thead")).toBeVisible();
      await expect(table.locator("thead th")).toHaveCount(9);
    }
    const search = main.getByRole("textbox", { name: "Search pantry" });
    await search.fill("Bread flour");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await table
      .getByRole("button", { name: "Actions for Bread flour", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "View item", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await search.fill("no-matching-inventory-item-9876");
    await expect(
      main.getByRole("heading", { name: "No items match this view." }),
    ).toBeVisible();
    await search.fill("");
    await main
      .getByRole("combobox", { name: "Sort by", exact: true })
      .selectOption("quantity");
    await main.getByRole("button", { name: "Reverse sort direction" }).click();
    await expect(
      main.getByRole("combobox", { name: "Sort by", exact: true }),
    ).toHaveValue("quantity");
    await main
      .locator(".inventory-tabs")
      .getByRole("button", { name: /^Low stock/ })
      .click();
    await expect(
      main
        .locator(".inventory-tabs")
        .getByRole("button", { name: /^Low stock/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await main
      .locator(".inventory-tabs")
      .getByRole("button", { name: /^All items/ })
      .click();
    await main
      .getByRole("button", { name: "Print shelf/bin labels (0)", exact: true })
      .click();
    const checkbox = main.getByRole("checkbox").first();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await main.getByRole("button", { name: "Done", exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  for (const theme of accentThemes) {
    for (const mode of ["light", "dark", "system"] as const) {
      workspace.settings[0].appearance = { theme: theme.id, mode };
      await page.emulateMedia({
        colorScheme: mode === "light" ? "light" : "dark",
      });
      await page.goto("about:blank");
      await page.goto(url);
      await expect(page.locator(".pantry-summary")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await expect(page.locator("html")).toHaveAttribute(
        "data-mode",
        mode === "light" ? "light" : "dark",
      );
      if (
        (theme.id === "orchard" && mode === "light") ||
        (theme.id === "cottage" && mode === "dark")
      )
        await page.screenshot({
          path: `${directory}/${theme.id}-${mode}-390.png`,
          fullPage: true,
        });
    }
  }
  await page.goto(workspaceFixtureUrl("Inventory/Ingredients"));
  await expect(page.locator(".cover-background")).toHaveCount(0);
  expect(
    await page
      .locator(".inventory-layout-page")
      .evaluate((el) =>
        getComputedStyle(el).getPropertyValue("--inventory-border"),
      ),
  ).toBe("");
});

test("long inventory text and enlarged phone text remain contained", async ({
  page,
}) => {
  await installWorkspaceFixture(page);
  const workspace = demoData();
  workspace.ingredients[0].name =
    "Stone-ground whole wheat baking flour in the large pantry storage container";
  workspace.ingredients[0].category =
    "Specialty baking ingredients and pantry essentials";
  workspace.ingredients[0].quantity = 12345678.125;
  await page.route("**/api/workspace*", (route) =>
    route.fulfill({ json: { workspace, role: "Owner", demo: true } }),
  );
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto(
    workspaceFixtureUrl("Inventory/Ingredients").replace(
      "#",
      "&cover-preview=1#",
    ),
  );
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.addStyleTag({ content: "html { font-size: 125% !important; }" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await expect(
    page
      .locator(".pantry-table .item-name")
      .filter({ hasText: workspace.ingredients[0].name }),
  ).toBeVisible();
  expect(
    await page
      .locator(".pantry-table")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: `${directory}/long-text-125-percent-390.png`,
    fullPage: true,
  });
});
