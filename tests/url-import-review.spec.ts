import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { demoData } from "../src/lib/demo";
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from "./workspace-fixture";

// Browser page zoom, rather than CSS zoom on the dialog or mobile pinch zoom.
async function zoomFixture(width: number) {
  const extension = await mkdtemp(join(tmpdir(), "pantry-test-zoom-"));
  let context: BrowserContext | undefined;
  const close = async () => {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
  };
  try {
    await Promise.all([
      writeFile(
        join(extension, "manifest.json"),
        JSON.stringify({
          manifest_version: 3,
          name: "Isolated screenshot zoom",
          version: "1.0.0",
          permissions: ["tabs"],
          background: { service_worker: "worker.js" },
        }),
      ),
      writeFile(
        join(extension, "worker.js"),
        "chrome.runtime.onInstalled.addListener(() => {});",
      ),
    ]);
    context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      viewport: { width, height: 900 },
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    return {
      page: context.pages()[0],
      close,
      setZoom: (ratio: number) =>
        worker.evaluate(async (next) => {
          const { tabs } = (
            globalThis as unknown as {
              chrome: {
                tabs: {
                  query: (
                    opts: object,
                  ) => Promise<{ id: number; url?: string }[]>;
                  setZoom: (id: number, value: number) => Promise<void>;
                  getZoom: (id: number) => Promise<number>;
                };
              };
            }
          ).chrome;
          const tab = (await tabs.query({})).find((item) =>
            item.url?.startsWith("http://localhost:8889/capture-fixture"),
          );
          if (!tab)
            throw new Error("The synthetic workspace tab is unavailable.");
          await tabs.setZoom(tab.id, next);
          return tabs.getZoom(tab.id);
        }, ratio),
    };
  } catch (error) {
    await close();
    throw error;
  }
}
for (const [width, zoom] of [
  [1440, 100],
  [1440, 80],
  [390, 100],
])
  test(`URL review stays separate from unsaved package editor at ${width}px / ${zoom}%`, async ({
    page: defaultPage,
  }) => {
    const isolatedZoom = zoom !== 100 ? await zoomFixture(width) : null;
    const page: Page = isolatedZoom?.page ?? defaultPage;
    const cssWidth = Math.round((width * 100) / zoom);
    const cssHeight = Math.round((900 * 100) / zoom);
    try {
      if (!isolatedZoom) await page.setViewportSize({ width, height: 900 });
      await page.route("https://test.invalid/bags.svg", (route) =>
        route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" rx="12" fill="#e7e0cd"/><path d="M28 24H72L77 78H23Z" fill="#fcfaf0" stroke="#64684a" stroke-width="3"/><text x="50" y="55" text-anchor="middle" fill="#444934" font-size="13">100</text></svg>',
        }),
      );
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
                    brand: "Sample Paper Goods",
                    retailerSku: "BAG-100",
                    notes:
                      "Clear bakery bags for individually wrapped cookies. Resealable closure; review package details before use.",
                    packagePrice: 12.5,
                    currency: "USD",
                    purchaseUnit: "package",
                    amountPerPackage: 100,
                    unit: "each",
                  },
                  sourceUrl:
                    "https://test.invalid/bags?catalog=" +
                    "long-source-link-".repeat(12),
                  imageUrl: "https://test.invalid/bags.svg",
                  checkedAt: "2026-11-22T00:00:00Z",
                  warnings: [],
                  conditions: [],
                },
                {
                  title: "Cookie bags 200 count",
                  fields: {
                    name: "Cookie bags",
                    packagePrice: 20,
                    currency: "USD",
                    purchaseUnit: "package",
                    amountPerPackage: 200,
                    unit: "each",
                  },
                  sourceUrl: "https://test.invalid/bags?variant=200",
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
        return route.fulfill({
          json: { workspace, role: "Owner", demo: false },
        });
      });
      await page.goto(workspaceFixtureUrl("Inventory/Ingredients"));
      if (isolatedZoom)
        expect(await isolatedZoom.setZoom(zoom / 100)).toBe(zoom / 100);
      await page.getByRole("button", { name: "Add item", exact: true }).click();
      const editor = page.getByRole("dialog").first();
      await editor
        .getByLabel("Item Type", { exact: true })
        .selectOption("packaging");
      if (
        await editor
          .getByRole("button", { name: "URL", exact: true })
          .isVisible()
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
      const offer = review.getByLabel(
        "Choose the exact product / package / offer",
      );
      await expect(
        review.getByRole("button", { name: "Accept & use information" }),
      ).toBeDisabled();
      expect(
        await offer.evaluate((el) =>
          Math.abs(
            el.getBoundingClientRect().width -
              el.closest(".url-import-scroll")!.clientWidth,
          ),
        ),
      ).toBeLessThan(2);
      const initial = (await review.boundingBox())!;
      expect(initial.height).toBeLessThan(cssHeight - 50);
      await offer.selectOption("0");
      await review
        .getByRole("button", { name: "Select all", exact: true })
        .click();
      await expect(review.getByText(/12.5 ÷ 100 = 0.125/)).toBeVisible();
      const accept = review.getByRole("button", {
        name: "Accept & use information",
        exact: true,
      });
      await expect(accept).toBeInViewport();
      const box = (await review.boundingBox())!;
      expect(Math.abs(box.width - Math.min(800, cssWidth - 32))).toBeLessThan(
        2,
      );
      expect(Math.abs(box.x + box.width / 2 - cssWidth / 2)).toBeLessThan(2);
      expect(box.height).toBeLessThanOrEqual(cssHeight - 31);
      const frame = await review.evaluate((el) => {
        const body = el.querySelector(".url-import-scroll")!;
        const footer = el.querySelector("footer")!;
        const header = el.querySelector("header")!;
        const offsets = () =>
          [footer, header].map(
            (node) =>
              node.getBoundingClientRect().top - el.getBoundingClientRect().top,
          );
        const before = offsets();
        body.scrollTop = body.scrollHeight;
        const after = offsets();
        const scrolled = body.scrollTop;
        body.scrollTop = 0;
        return { before, after, scrolled, outer: el.scrollTop };
      });
      expect(frame.scrolled).toBeGreaterThan(0);
      expect(frame.after).toEqual(frame.before);
      expect(frame.outer).toBe(0);
      await expect(review.locator(".product-import-summary img")).toBeVisible();
      expect(
        await review
          .locator(".product-import-fields")
          .evaluate(
            (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
          ),
      ).toBe(width === 390 ? 1 : 2);
      expect(
        await review.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await mkdir("docs/reviews/url-import-width", { recursive: true });
      await page.screenshot({
        path: `docs/reviews/url-import-width/review-${width}-${zoom}.png`,
        animations: "disabled",
      });
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
      await offer.selectOption("0");
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
    } finally {
      try {
        await page.unrouteAll({ behavior: "ignoreErrors" });
      } finally {
        await isolatedZoom?.close();
      }
    }
  });
