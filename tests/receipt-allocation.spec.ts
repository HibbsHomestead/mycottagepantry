import { test, expect } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { demoData } from '../src/lib/demo'
import { planFinance } from '../src/lib/finance'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
for (const width of [1440, 390])
  test(`mixed allocation review and posting ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const w = demoData()
    w.receipt_extractions = [
      {
        id: 'browser-allocation',
        name: 'Review mill',
        vendor: 'Review mill',
        filename: 'disposable.pdf',
        fileHash: 'disposable-hash',
        originalMime: 'application/pdf',
        previewMime: 'application/pdf',
        date: '2026-11-15',
        receivedDate: '2026-11-15',
        currency: 'USD',
        arithmeticVersion: 2,
        allocationVersion: 1,
        status: 'draft',
        taxTreatment: 'exclusive',
        tax: 0,
        total: 20,
        printedTotal: 20,
        lines: [
          {
            description: 'Two bags flour',
            printedQuantity: 2,
            printedUnit: w.ingredients[0].unit,
            amount: 20,
            allocation: 'unreviewed',
            decision: '',
            quantity: '',
            unit: '',
          },
        ],
        history: [],
      },
    ]
    const prior = w.ingredients[0].quantity
    const doc = await PDFDocument.create(),
      font = await doc.embedFont(StandardFonts.Helvetica)
    doc.addPage().drawText('Review mill - 2 bags flour - total USD 20.00', {
      font,
      x: 30,
      y: 700,
      size: 14,
    })
    doc
      .addPage()
      .drawText('Supporting page - end of disposable receipt', {
        font,
        x: 30,
        y: 700,
        size: 14,
      })
    const pdf = Buffer.from(await doc.save())
    let sequence = 0
    await page.route('**/api/workspace*', async (route) => {
      if (new URL(route.request().url()).searchParams.has('receiptFile'))
        return route.fulfill({ contentType: 'application/pdf', body: pdf })
      if (route.request().method() === 'POST') {
        const { action, data } = route.request().postDataJSON()
        try {
          const plan = planFinance(
            w,
            action,
            data,
            () => `browser-${++sequence}`,
          )
          for (const { table, record } of plan.writes) {
            const rows = (w[table] ||= [])
            const index = rows.findIndex((r) => r.id === record.id)
            const saved = { ...record, updatedAt: `v${++sequence}` }
            if (index < 0) rows.push(saved)
            else rows[index] = saved
          }
          if (plan.journal) (w.journals ||= []).push(plan.journal)
        } catch (e) {
          return route.fulfill({ status: 400, json: { error: String(e) } })
        }
      }
      return route.fulfill({
        json: { workspace: w, role: 'Owner', demo: true },
      })
    })
    await page.goto(workspaceFixtureUrl('Finances/Receipt inbox'))
    await page.getByRole('button', { name: /Review mill/ }).click()
    const dialog = page.getByRole('dialog', {
      name: 'Review receipt',
      exact: true,
    })
    await expect(
      dialog.getByRole('region', { name: 'Allocation summary' }),
    ).toContainText('Needs review')
    if (width === 1440) {
      const left = await dialog.locator('.receipt-fields').boundingBox()
      const right = await dialog.locator('.receipt-preview').boundingBox()
      expect(left!.x).toBeLessThan(right!.x)
      expect(Math.abs(left!.y - right!.y)).toBeLessThan(5)
      const preview = dialog.locator('.receipt-desktop-document')
      await preview
        .getByRole('button', { name: 'Next page', exact: true })
        .click()
      await expect(preview).toContainText('Page 2 of 2')
      await preview
        .getByRole('button', { name: 'Previous page', exact: true })
        .click()
    } else {
      await dialog.locator('.receipt-preview-launch').click()
      await expect(
        page.getByRole('dialog', { name: 'Original receipt', exact: true }),
      ).toBeVisible()
      const preview = page.getByRole('dialog', {
        name: 'Original receipt',
        exact: true,
      })
      await preview
        .getByRole('button', { name: 'Next page', exact: true })
        .click()
      await expect(preview).toContainText('Page 2 of 2')
      await page.keyboard.press('Escape')
    }
    await dialog.getByRole('tab', { name: 'Line Items' }).click()
    await dialog.getByRole('button', { name: /Two bags flour.*Edit/ }).click()
    await dialog
      .getByRole('combobox', { name: 'Allocation', exact: true })
      .selectOption('split')
    await dialog.getByLabel('Business percentage', { exact: true }).fill('50')
    await dialog
      .getByRole('combobox', { name: 'Business recording', exact: true })
      .selectOption('inventory')
    await dialog
      .getByRole('combobox', { name: 'Match inventory item', exact: true })
      .selectOption('ingredients:' + w.ingredients[0].id)
    await dialog.getByLabel('Business quantity received').fill('1')
    await dialog
      .getByRole('combobox', { name: 'Unit received', exact: true })
      .selectOption(w.ingredients[0].unit)
    await dialog
      .getByLabel(
        'I confirmed the business quantity and allocated cost correspond',
        { exact: false },
      )
      .check()
    await dialog
      .getByLabel('I confirmed the received quantity and stock', {
        exact: false,
      })
      .check()
    await dialog.getByRole('button', { name: 'Save as draft' }).click()
    expect(w.ingredients[0].quantity).toBe(prior)
    await dialog
      .getByRole('button', { name: 'Close', exact: true })
      .first()
      .click()
    await page.getByRole('button', { name: /Review mill/ }).click()
    await dialog.getByRole('tab', { name: 'Line Items' }).click()
    await expect(
      dialog.getByRole('region', { name: 'Allocation summary' }),
    ).toContainText('Ready to post')
    await expect(
      dialog.getByRole('region', { name: 'Allocation summary' }),
    ).toContainText('Personal / excluded $10.00')
    await dialog.getByRole('button', { name: /Two bags flour.*Edit/ }).click()
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
    ).toBe(true)
    await dialog.evaluate((el) => {
      el.scrollTop = 0
    })
    if (width === 1440)
      await expect(
        dialog.locator('.receipt-desktop-document'),
      ).not.toContainText('Loading receipt preview')
    await page.screenshot({
      path: `docs/reviews/receipt-allocation/review-${width}.png`,
      fullPage: false,
    })
    await dialog
      .getByLabel('Business percentage', { exact: true })
      .evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await page.screenshot({
      path: `docs/reviews/receipt-allocation/split-${width}.png`,
    })
    await dialog.getByRole('button', { name: 'Review confirmation' }).click()
    await dialog.getByRole('button', { name: 'Confirm & post' }).click()
    await expect(dialog).toBeHidden()
    expect(w.ingredients[0].quantity).toBe(prior + 1)
    expect(w.finance_transactions.at(-1)?.amount).toBe(10)
    expect(w.receipt_extractions[0].total).toBe(20)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
