import { test, expect } from '@playwright/test'
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`receipt upload, multipage review, retry and item creation preserve corrections ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData(),
      actions: string[] = []
    workspace.receipt_extractions = []
    const doc = await PDFDocument.create(),
      font = await doc.embedFont(StandardFonts.Helvetica)
    for (const text of [
      'Synthetic mill invoice 0821 Flour 2 bags USD 12',
      'Printed total USD 12. Review both pages.',
    ])
      doc.addPage().drawText(text, { font, x: 25, y: 700 })
    const pdf = Buffer.from(await doc.save())
    let release: () => void = () => {},
      attempt = 0
    const processing = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/workspace*', async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.has('receiptFile'))
        return route.fulfill({ contentType: 'application/pdf', body: pdf })
      if (url.searchParams.has('receiptUpload')) {
        const receipt = {
          id: 'browser-receipt',
          name: 'Synthetic invoice.pdf',
          filename: 'Synthetic invoice.pdf',
          status: 'draft',
          extractionStatus: 'queued',
          fileHash: 'fixture-private-file',
          originalMime: 'application/pdf',
          previewMime: 'application/pdf',
          updatedAt: 'v1',
          vendor: '',
          date: '',
          subtotal: null,
          tax: null,
          total: null,
          lines: [],
          history: [],
        }
        workspace.receipt_extractions = [receipt]
        return route.fulfill({ json: { receipt } })
      }
      if (route.request().method() === 'POST') {
        const { action, data } = route.request().postDataJSON()
        actions.push(action)
        const current = workspace.receipt_extractions[0]
        if (action === 'receiptExtract') {
          attempt++
          if (attempt === 1) await processing
          if (attempt === 1)
            Object.assign(current, {
              vendor: 'Synthetic mill',
              date: '2026-11-02',
              receiptNumber: '0821',
              currency: 'USD',
              subtotal: 12,
              tax: null,
              total: 12,
              extractionStatus: 'partial',
              updatedAt: 'v2',
              lines: [
                {
                  description: 'Flour',
                  amount: 12,
                  printedQuantity: 2,
                  printedUnit: 'bags',
                  quantity: null,
                  unit: '',
                  decision: '',
                },
              ],
            })
          else
            Object.assign(current, {
              extractionStatus: 'partial',
              updatedAt: 'v4',
              pendingExtraction: { vendor: 'Replacement mill', lines: [] },
            })
        } else if (action === 'receiptDraft')
          Object.assign(current, data, { updatedAt: 'v3' })
        else if (action === 'receiptDismissExtraction') {
          delete current.pendingExtraction
          current.updatedAt = 'v5'
        } else throw new Error('Unexpected mutation: ' + action)
        return route.fulfill({ json: { workspace } })
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: true } })
    })
    await page.goto(workspaceFixtureUrl('Finances/Receipt inbox'))
    await page.getByLabel('Upload receipt', { exact: true }).setInputFiles({
      name: 'Synthetic invoice.pdf',
      mimeType: 'application/pdf',
      buffer: pdf,
    })
    const review = page.getByRole('dialog', {
      name: 'Review receipt',
      exact: true,
    })
    await expect(
      review.getByText('Reading receipt', { exact: true }),
    ).toBeVisible()
    await expect(
      review.getByRole('textbox', { name: 'Merchant', exact: true }),
    ).toBeDisabled()
    release()
    await expect(
      review.getByRole('textbox', { name: 'Merchant', exact: true }),
    ).toHaveValue('Synthetic mill')
    await expect(
      review.getByText('Partially extracted — review needed', { exact: true }),
    ).toBeVisible()
    await review
      .getByRole('button', { name: /Original receipt attached.*View receipt/ })
      .click()
    const source = page.getByRole('dialog', {
      name: 'Original receipt',
      exact: true,
    })
    await expect(source.getByText('Page 1 of 2', { exact: true })).toBeVisible()
    await source.getByRole('button', { name: 'Next page', exact: true }).click()
    await expect(source.getByText('Page 2 of 2', { exact: true })).toBeVisible()
    await source.getByRole('button', { name: 'Back to editing' }).click()
    await review.getByRole('button', { name: /Flour.*Edit/ }).click()
    await review
      .getByRole('textbox', { name: 'Merchant', exact: true })
      .fill('Owner corrected mill')
    await review
      .getByRole('combobox', { name: 'What is this for?', exact: true })
      .selectOption('inventory')
    await review
      .getByRole('combobox', { name: 'Match inventory item', exact: true })
      .selectOption('ingredients:' + workspace.ingredients[0].id)
    await review.getByText('Printed package details', { exact: true }).click()
    await expect(
      review.getByLabel('Printed purchase count', { exact: true }),
    ).toHaveValue('2')
    await expect(
      review.getByLabel('Actual quantity received', { exact: true }),
    ).toHaveValue('')
    await review
      .getByRole('combobox', { name: 'Match inventory item', exact: true })
      .selectOption('new')
    const item = page.getByRole('dialog', { name: 'Add Item', exact: true })
    await expect(item).toBeVisible()
    await item.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      review.getByRole('textbox', { name: 'Merchant', exact: true }),
    ).toHaveValue('Owner corrected mill')
    await review
      .getByRole('button', { name: 'Retry reading', exact: true })
      .click()
    await expect(
      review.getByText('Review replacement values', { exact: true }),
    ).toBeVisible()
    await expect(
      review.getByRole('textbox', { name: 'Merchant', exact: true }),
    ).toHaveValue('Owner corrected mill')
    await review
      .getByRole('button', { name: 'Keep my edits', exact: true })
      .click()
    await expect(
      review.getByText('Review replacement values', { exact: true }),
    ).toHaveCount(0)
    await expect(
      review.getByRole('textbox', { name: 'Merchant', exact: true }),
    ).toHaveValue('Owner corrected mill')
    expect(actions).toEqual([
      'receiptExtract',
      'receiptDraft',
      'receiptExtract',
      'receiptDraft',
      'receiptDismissExtraction',
    ])
    expect(
      await review.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: `/tmp/receipt-review-${width}.png`,
      animations: 'disabled',
    })
  })
}
