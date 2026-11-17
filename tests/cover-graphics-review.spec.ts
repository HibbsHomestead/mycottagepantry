import { bookSummary } from "../src/lib/checkbook";
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { demoData } from "../src/lib/demo";
import { accentThemes, appearanceVariables } from "../src/lib/appearance";
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from "./workspace-fixture";
import { installPublicPlanFixture } from "./public-plan-fixture";
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
const directory = "docs/reviews/cover-graphics";
const variants = [
  { theme: "cottage", mode: "light" },
  { theme: "orchard", mode: "light" },
  { theme: "cottage", mode: "dark" },
] as const;
async function assertDecorative(page: import("@playwright/test").Page) {
  await expect(page.locator(".cover-background:visible")).toBeVisible();
  expect(
    await page.locator(".cover-background:visible").getAttribute("aria-hidden"),
  ).toBe("true");
  expect(
    await page
      .locator(".cover-background:visible")
      .evaluate((el) => getComputedStyle(el).pointerEvents),
  ).toBe("none");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test("workspace graphic direction, themes and reflow", async ({ page }) => {
  test.setTimeout(180000);
  mkdirSync(directory, { recursive: true });
  await installWorkspaceFixture(page);
  const workspace = demoData();
  workspace.journals = Array.from({ length: 18 }, (_, i) => ({
    id: `review-journal-${i}`,
    name: [
      "Saturday market sales",
      "Bread bag restock",
      "Farmers market stall",
    ][i % 3],
    date: `2026-11-${String(i + 1).padStart(2, "0")}`,
    status: "posted",
    lines: [
      { account: "Bank account", debit: 74.25 + i, credit: 0 },
      { account: "Sales revenue", credit: 74.25 + i, debit: 0 },
    ],
  }));
  workspace.bookkeeping = [
    {
      ...bookSummary(workspace, "2026-11-01", "2026-11-30"),
      settings: { bills: false, invoices: false },
    },
  ];
  await page.route("**/api/workspace*", (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { workspace, role: "Owner", demo: true } });
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const appearance of variants) {
      workspace.settings[0].appearance = appearance;
      for (const [name, section] of [
        ["inventory", "Inventory/Ingredients"],
        ["finance", "Finance/Register"],
      ]) {
        const url = workspaceFixtureUrl(section).replace(
          "#",
          "&cover-preview=1#",
        );
        await page.goto("about:blank");
        await page.goto(url);
        await expect(page.locator("main.app-page")).toBeVisible();
        if (name === "inventory")
          expect(await page.locator(".pantry-card").count()).toBeGreaterThan(5);
        else
          await expect(
            page.locator("main table tbody tr").nth(5),
          ).toBeVisible();
        await assertDecorative(page);
        await page.screenshot({
          animations: "disabled",
          path: `${directory}/${name}-${appearance.theme}-${appearance.mode}-${width}.png`,
        });
        if (
          width === 1440 &&
          appearance.theme === "cottage" &&
          appearance.mode === "light"
        ) {
          await page.screenshot({
            animations: "disabled",
            fullPage: true,
            path: `${directory}/${name}-full.png`,
          });
        }
      }
    }
  }
  // Existing palette/mode combinations inherit the same artwork, including System.
  for (const theme of accentThemes)
    for (const mode of ["light", "dark", "system"] as const) {
      workspace.settings[0].appearance = { theme: theme.id, mode };
      await page.emulateMedia({
        colorScheme: mode === "system" ? "dark" : "light",
      });
      await page.goto("about:blank");
      await page.goto(
        workspaceFixtureUrl("Inventory/Ingredients").replace(
          "#",
          "&cover-preview=1#",
        ),
      );
      await expect(page.locator(".pantry-card").first()).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute(
        "data-mode",
        mode === "light" ? "light" : "dark",
      );
      await assertDecorative(page);
      if (mode === "system") {
        await page.emulateMedia({ colorScheme: "light" });
        await expect(page.locator("html")).toHaveAttribute(
          "data-mode",
          "light",
        );
      }
    }
});
test("public, login and real admin shell with synthetic authorized responses", async ({
  page,
}) => {
  test.setTimeout(180000);
  await installPublicPlanFixture(page);
  await page.route("**/api/admin*", (route) => {
    expect(route.request().method()).toBe("GET");
    const session =
      new URL(route.request().url()).searchParams.get("action") === "session";
    return route.fulfill({
      json: session
        ? { stage: "authenticated", role: "admin", identityId: "review-admin" }
        : {
            totals: { customer_accounts: 37, ovens: 32, recent_accounts: 8 },
            definitions: {
              customer_accounts: "Recorded customer accounts",
              ovens: "Registered business workspaces",
              recent_accounts: "First recorded during the last 30 days",
              failed_jobs: "Job monitoring is unavailable.",
              subscriptions: "Saved subscription records by plan and status.",
            },
            subscriptions: [
              {
                plan_id: "free",
                status: "active",
                source: "registration",
                count: 12,
              },
              {
                plan_id: "cottage",
                status: "active",
                source: "stripe",
                count: 17,
              },
            ],
            recent: [
              {
                identity_id: "preview-account",
                first_recorded_at: "2026-11-15T10:00:00Z",
                oven_count: 1,
              },
            ],
            activity: [],
            asOf: "2026-11-16T05:00:00Z",
          },
    });
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const appearance of variants) {
      for (const [name, route] of [
        ["home", "/"],
        ["login", "/login"],
        ["admin", "/admin"],
      ]) {
        // Admin retains its default brand behavior. Dark is shown as an explicit
        // visual simulation after mounting, not a new saved admin preference.
        if (name === "admin" && appearance.theme !== "cottage") continue;
        await page.goto(`${route}?cover-preview=1`);
        if (name === "admin")
          await expect(
            page.getByRole("heading", { name: "Recorded subscriptions" }),
          ).toBeVisible();
        if (name === "login")
          await expect(
            page.locator(".public-auth input").first(),
          ).toBeVisible();
        await page.evaluate((vars) => {
          for (const [key, value] of Object.entries(vars))
            document.documentElement.style.setProperty(key, value);
        }, appearanceVariables(appearance));
        await page.evaluate((mode) => {
          document.documentElement.dataset.mode = mode;
          document.documentElement.classList.toggle("dark", mode === "dark");
        }, appearance.mode);
        await assertDecorative(page);
        await page.screenshot({
          animations: "disabled",
          path: `${directory}/${name}-${appearance.theme}-${appearance.mode}-${width}.png`,
        });
      }
    }
  }
  await page.goto("/");
  await expect(page.locator(".public-site")).toBeVisible();
  await expect(page.locator(".cover-background")).toHaveCount(0);
});
