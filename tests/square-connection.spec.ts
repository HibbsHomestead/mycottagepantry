import { test, expect } from "@playwright/test";
import { demoData } from "../src/lib/demo";
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from "./workspace-fixture";
for (const width of [1440, 390])
  test(`Square status and bounded review controls ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await installWorkspaceFixture(page);
    await page.route("**/api/workspace*", (route) =>
      route.fulfill({
        json: { workspace: demoData(), role: "Owner", demo: false },
      }),
    );
    let reads = 0;
    await page.route("**/api/square-sales*", (route) => {
      const post = route.request().method() === "POST";
      const view = {
        environment: "sandbox",
        configured: true,
        status: post ? "sync_failed" : "connected",
        merchantId: "fixture-merchant",
        merchantName: "Fictional test seller",
        businessName: "Fictional bakery",
        locations: [
          { id: "a", name: "Test market A", timezone: "UTC", currency: "USD" },
          { id: "b", name: "Test market B", timezone: "UTC", currency: "USD" },
        ],
        selectedLocations: ["a", "b"],
        lastSuccessfulSync: null,
        lastAttemptedSync: post ? "2026-01-02T12:00:00Z" : null,
        error: post
          ? "Square sample timed out. Retry the selected range."
          : null,
        callbackUrl:
          "https://fixture.invalid/api/square-sales?callback=1&environment=sandbox",
      };
      if (post) reads++;
      return route.fulfill({
        json: { view, ...(post ? { error: view.error } : {}) },
      });
    });
    await page.goto(workspaceFixtureUrl("Sales/Sales"));
    await page
      .getByRole("link", { name: "Connect / manage Square", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Square", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Fictional test seller", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Test market A", { exact: false }),
    ).toBeChecked();
    await expect(
      page.getByLabel("Test market B", { exact: false }),
    ).toBeChecked();
    await page.getByLabel("Start (UTC, inclusive)").fill("2026-01-01T00:00");
    await page.getByLabel("End (UTC, exclusive)").fill("2026-01-03T00:00");
    await page.getByRole("button", { name: "Preview sales" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Retry the selected range",
    );
    await expect(page.getByLabel("Start (UTC, inclusive)")).toHaveValue(
      "2026-01-01T00:00",
    );
    await expect(
      page.getByLabel("Test market A", { exact: false }),
    ).toBeChecked();
    await expect(
      page.getByLabel("Test market B", { exact: false }),
    ).toBeChecked();
    expect(reads).toBe(1);
    await page.screenshot({
      path: `/tmp/square-connection-${width}.png`,
      fullPage: true,
    });
  });

test("missing platform setup stays customer-safe and connection screen never imports sales", async ({
  page,
}) => {
  await installWorkspaceFixture(page);
  let writes = 0;
  await page.route("**/api/workspace*", (route) => {
    if (route.request().method() === "POST") writes++;
    return route.fulfill({
      json: { workspace: demoData(), role: "Owner", demo: false },
    });
  });
  await page.route("**/api/square-sales*", (route) =>
    route.fulfill({
      json: {
        view: {
          configured: false,
          status: "not_connected",
          environment: "production",
          locations: [],
          selectedLocations: [],
        },
      },
    }),
  );
  await page.goto(workspaceFixtureUrl("Settings/Integrations"));
  await expect(
    page.getByText("Square connection is not available yet. Contact support."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect Square", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Application secret", { exact: false }),
  ).toHaveCount(0);
  expect(writes).toBe(0);
});

test("reviewing a bounded sample requires separate explicit import approval", async ({
  page,
}) => {
  const { detectSquare } = await import("../src/lib/square-sales");
  await installWorkspaceFixture(page);
  let imports = 0;
  await page.route("**/api/workspace*", (route) => {
    if (route.request().method() === "POST") imports++;
    return route.fulfill({
      json: { workspace: demoData(), role: "Owner", demo: false },
    });
  });
  const csv =
    "Payment ID,Date,Net Sales,Currency\nfixture-payment,2026-01-02,7.25,USD";
  await page.route("**/api/square-sales*", (route) => {
    const action =
      route.request().method() === "POST"
        ? route.request().postDataJSON().action
        : "";
    return route.fulfill({
      json: {
        view: {
          configured: true,
          status: "connected",
          merchantId: "fixture-merchant",
          environment: "sandbox",
          locations: [
            { id: "a", name: "Market", timezone: "UTC", currency: "USD" },
          ],
          selectedLocations: ["a"],
        },
        ...(action === "sample"
          ? {
              sample: {
                csv,
                count: 1,
                proof: "fixture-noncredential-review",
                options: {
                  ...detectSquare(csv),
                  account: "fixture-merchant",
                  timezone: "UTC",
                },
              },
            }
          : {}),
      },
    });
  });
  await page.goto(workspaceFixtureUrl("Settings/Integrations"));
  await page.getByLabel("Start (UTC, inclusive)").fill("2026-01-01T00:00");
  await page.getByLabel("End (UTC, exclusive)").fill("2026-01-03T00:00");
  await page.getByRole("button", { name: "Preview sales" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByText("fixture-payment", { exact: true }),
  ).toBeVisible();
  expect(imports).toBe(0);
  const confirm = page.getByRole("button", { name: "Import reviewed sales" });
  await expect(confirm).toBeDisabled();
  await page
    .getByLabel("I reviewed these transactions", { exact: false })
    .check();
  await confirm.click();
  expect(imports).toBe(1);
});
