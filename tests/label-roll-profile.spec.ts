import { expect, test } from "@playwright/test";
import { demoData } from "../src/lib/demo";
import {
  blankLabel,
  newElement,
  resolveLabelData,
} from "../src/lib/label-studio";
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from "./workspace-fixture";

test("saved roll media is used by artwork preview, Print, and PDF", async ({
  page,
}, testInfo) => {
  const workspace = demoData();
  const source = { kind: "product" as const, id: workspace.products[0].id };
  const label = {
    ...blankLabel(),
    id: "roll-profile-fixture",
    name: "Portrait Roll Fixture",
    workflowVersion: 1 as const,
    recordKind: "label" as const,
    source,
    productId: source.id,
    revision: 1,
    width: 216,
    height: 288,
    elements: [
      { ...newElement("text", "", "product.name"), x: 18, y: 22, width: 180 },
    ],
  };
  workspace.products[0].labelDesignId = label.id;
  workspace.label_templates = [label];
  workspace.settings[0].currentPrinterProfiles = [];
  workspace.label_print_jobs = [];
  await installWorkspaceFixture(page);
  await page.route("**/api/workspace*", async (route) => {
    const request = route.request();
    if (request.url().includes("labelPdf=1"))
      return route.fulfill({
        contentType: "application/pdf",
        body: "%PDF-fixture",
      });
    if (request.method() === "POST") {
      const { action, data } = request.postDataJSON();
      if (action === "labelPrinterProfile") {
        expect(data.profile).toMatchObject({
          width: 4,
          height: 3,
          rotation: 90,
        });
        workspace.settings[0].currentPrinterProfiles = [data.profile];
      } else if (action === "labelSave") {
        workspace.label_templates = [
          {
            ...data.document,
            revision: 2,
            savedAt: new Date().toISOString(),
            lastSaveOperationId: data.operationId,
          },
        ];
      } else if (action === "labelPrint") {
        workspace.label_print_jobs = [
          {
            id: "roll-print-fixture",
            name: label.name,
            documentSnapshot: workspace.label_templates[0],
            renderedDataSnapshot: resolveLabelData(workspace, source),
          },
        ];
      } else expect(action).toBe("labelDraft");
    }
    await route.fulfill({ json: { workspace, role: "Owner", demo: false } });
  });
  await page.addInitScript(() => {
    window.print = () => {
      Object.assign(window.parent, {
        capturedPrint: document.documentElement.outerHTML,
      });
      window.dispatchEvent(new Event("afterprint"));
    };
  });
  await page.goto(workspaceFixtureUrl("Labels"));
  const open = page.getByRole("button", {
    name: `Preview/Print ${label.name}`,
  });
  await open.click();
  await page.getByLabel("Output layout").selectOption("roll");
  await page.getByLabel("Across printhead (in)").fill("4");
  await page.getByLabel("Feed length (in)").fill("3");
  await page.getByLabel("Output rotation").selectOption("90");
  await page.getByRole("button", { name: "Save new print profile" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Media settings saved" }),
  ).toBeVisible();
  const profile = workspace.settings[0].currentPrinterProfiles[0];
  const printer = page.getByLabel("Printer / printing method");
  await expect(printer).toHaveValue(profile.id);
  const preview = page.getByRole("img", { name: /artwork on loaded media/i });
  await expect(preview).toHaveAttribute("viewBox", "0 0 288 216");
  await expect(preview.locator(":scope > g")).toHaveAttribute(
    "transform",
    "matrix(0 1 -1 0 288 0)",
  );
  await expect(
    page.getByText("The dimensions are swapped.", { exact: false }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save label", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /Saved ·/ }),
  ).toBeVisible();
  await page.reload();
  await open.click();
  await expect(printer).toHaveValue(profile.id);
  await expect(page.getByLabel("Output rotation")).toHaveValue("90");
  await preview.screenshot({
    path: testInfo.outputPath("studio-output-preview.png"),
  });

  const reviewed = page.getByRole("checkbox", {
    name: /I reviewed these warnings/,
  });
  if (await reviewed.count()) await reviewed.check();
  await page.getByRole("button", { name: "Print labels" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "capturedPrint")))
    .toContain("@page{size:288pt 216pt;margin:0}");
  expect(
    await page.evaluate(() => Reflect.get(window, "capturedPrint")),
  ).toContain("translate(288pt,0pt) matrix(0,1,-1,0,0,0)");
  const pdfRequest = page.waitForRequest("**/api/workspace?labelPdf=1");
  await page.getByRole("button", { name: "Download PDF" }).click();
  expect((await pdfRequest).postDataJSON()).toMatchObject({
    mediaProfileId: profile.id,
  });

  workspace.settings[0].currentPrinterProfiles = [];
  await page.reload();
  await open.click();
  await expect(printer).toHaveValue(profile.id);
  await expect(preview).toHaveCount(0);
  await expect(
    page
      .getByRole("alert")
      .filter({
        hasText: "The saved print profile is unavailable on this device.",
      }),
  ).toBeVisible();

  workspace.settings[0].currentPrinterProfiles = [profile];
  await page.goto(workspaceFixtureUrl("Products/Food"));
  const productName = workspace.products[0].name;
  const card = page.getByRole("article", { name: productName });
  await card.getByRole("button", { name: productName, exact: true }).click();
  await page
    .getByRole("button", { name: "Preview Label", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `Preview Label · ${productName}`,
  });
  const productPreview = dialog.getByRole("img", {
    name: /artwork on loaded media/i,
  });
  await expect(productPreview).toHaveAttribute("viewBox", "0 0 288 216");
  await expect(productPreview.locator(":scope > g")).toHaveAttribute(
    "transform",
    "matrix(0 1 -1 0 288 0)",
  );
});
