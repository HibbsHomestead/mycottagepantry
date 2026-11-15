import { test, expect } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
for (const width of [1366, 1440, 390])
  test(`compact failed receipt ${width}`, async ({ page }) => {
    await page.setViewportSize({
      width,
      height: width === 390 ? 844 : width === 1440 ? 800 : 768,
    })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.receipt_extractions = [
      {
        id: 'fordland-test',
        name: 'FordlandCBA',
        vendor: 'FordlandCBA',
        date: '2026-11-14',
        status: 'draft',
        extractionStatus: 'failed',
        filename: 'FordlandCBA.pdf',
        fileHash: 'fixture',
        previewMime: 'application/pdf',
        originalMime: 'application/pdf',
        arithmeticVersion: 2,
        allocationVersion: 1,
        printedTotal: null,
        tax: 0,
        taxTreatment: 'exclusive',
        subtotal: 25,
        total: 25,
        lines: [
          {
            description: 'Confirmed purchase',
            amount: 25,
            allocation: 'business',
            decision: 'expense',
            category: 'Supplies expense',
          },
        ],
        history: [],
      },
    ]
    if (width !== 390)
      workspace.receipt_extractions[0].lines = Array.from(
        { length: 8 },
        (_, i) => ({
          description: `Confirmed item ${i + 1}`,
          amount: i === 0 ? 4 : 3,
          allocation: 'business',
          decision: 'expense',
          category: 'Supplies expense',
        }),
      )
    const pdf = await PDFDocument.create()
    pdf.addPage().drawText('FordlandCBA - Receipt total $25.00', {
      x: 30,
      y: 700,
      size: 16,
    })
    const bytes = Buffer.from(await pdf.save())
    await page.route('**/api/workspace*', async (route) => {
      if (new URL(route.request().url()).searchParams.has('receiptFile'))
        return route.fulfill({ contentType: 'application/pdf', body: bytes })
      if (route.request().method() === 'POST') {
        const { action, data } = route.request().postDataJSON()
        expect(action).toBe('receiptDraft')
        Object.assign(workspace.receipt_extractions[0], data)
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: true } })
    })
    await page.goto(workspaceFixtureUrl('Finances/Receipt inbox'))
    await page.locator('.finance-list-row--receipt').first().click()
    const dialog = page.locator('.receipt-review-dialog')
    const total = dialog.getByRole('spinbutton', {
      name: 'Receipt total (from receipt)',
      exact: true,
    })
    await expect(total).toBeVisible()
    await expect(total).toBeFocused()
    await page.screenshot({
      path: `docs/reviews/receipt-compact/missing-total-${width}.png`,
    })
    await total.fill('25.00')
    await expect(dialog.getByText('Difference $0.00 ✓')).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Post', exact: true }),
    ).toBeEnabled()
    await expect(dialog.getByRole('tab')).toHaveCount(0)
    if (width !== 390)
      await expect(
        dialog
          .locator('.receipt-desktop-document')
          .getByText('Loading receipt preview…'),
      ).toHaveCount(0)
    await page.screenshot({
      path: `docs/reviews/receipt-compact/popup-${width}.png`,
    })
    if (width !== 390) {
      await expect(dialog.locator('.receipt-compact-row')).toHaveCount(8)
      expect(
        await dialog
          .locator('.receipt-table-scroll')
          .evaluate((el) => el.scrollHeight - el.clientHeight),
      ).toBeLessThanOrEqual(1)
    }
    await page.screenshot({
      path: `docs/reviews/receipt-compact/popup-${width}.png`,
    })
    if (width === 1366) {
      expect(
        await dialog.evaluate((el) => el.scrollHeight - el.clientHeight),
      ).toBeLessThanOrEqual(1)
      expect(
        await dialog
          .locator('.receipt-fields')
          .evaluate((el) => el.scrollHeight - el.clientHeight),
      ).toBeLessThanOrEqual(1)
    }
  })

test('November overview explains inventory spending and pending review', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.clock.setFixedTime(new Date('2026-11-15T06:30:00Z'))
  await installWorkspaceFixture(page)
  const workspace = demoData()
  for (const key of Object.keys(workspace))
    if (key !== 'settings') workspace[key] = []
  workspace.settings[0].timezone = 'America/Chicago'
  workspace.receipt_extractions = [
    {
      id: 'clara',
      name: "Clara's Discount Groceries",
      vendor: "Clara's Discount Groceries",
      date: '2026-11-10',
      status: 'posted',
      total: 20.41,
      businessTotal: 20.41,
    },
    {
      id: 'country',
      name: 'COUNTRY MART',
      vendor: 'COUNTRY MART',
      date: '2026-11-14',
      status: 'draft',
      total: 30,
    },
    {
      id: 'old',
      name: 'Older receipt',
      vendor: 'Older receipt',
      date: '2026-10-30',
      status: 'cancelled',
      total: 4,
    },
  ]
  workspace.finance_transactions = [
    {
      id: 'purchase',
      name: "Clara's Discount Groceries",
      date: '2026-11-10',
      kind: 'receipt',
      status: 'posted',
      receiptId: 'clara',
      amount: 20.41,
      lineSnapshots: [{ decision: 'inventory', postedAmount: 20.41 }],
    },
  ]
  await page.route('**/api/workspace*', (route) =>
    route.fulfill({ json: { workspace, role: 'Owner', demo: true } }),
  )
  await page.goto(workspaceFixtureUrl('Finances/Overview'))
  const spending = page.getByRole('region', { name: 'Purchases / money spent' })
  await expect(spending).toContainText('Inventory purchases (assets) $20.41')
  await expect(spending).toContainText('Total spent $20.41')
  await expect(spending).toContainText('Receipts awaiting review: 1')
  await expect(
    page.getByText('No records in this period', { exact: true }),
  ).toHaveCount(0)
  await expect(
    page.locator('.finance-summary-card.expenses strong'),
  ).toHaveText('$0.00')
  await expect(page.locator('.finance-receipt-row').first()).toContainText(
    'COUNTRY MART',
  )
  await page.getByLabel('Only selected period').check()
  await expect(page.locator('.finance-receipt-row')).toHaveCount(2)
  await page.screenshot({
    path: 'docs/reviews/receipt-compact/november-overview.png',
    fullPage: true,
  })
})
