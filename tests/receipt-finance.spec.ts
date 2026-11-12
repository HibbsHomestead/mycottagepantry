import { test, expect } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { demoData } from '../src/lib/demo'
import { planFinance } from '../src/lib/finance'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
test.use({ video: 'on', trace: 'on' })
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

async function fixture(page: import('@playwright/test').Page) {
  await installWorkspaceFixture(page)
  const w = demoData()
  w.receipt_extractions = [
    {
      id: 'review-fixture',
      name: 'Meadow Supply',
      filename: 'Meadow-receipt.pdf',
      fileHash: 'fixture-document',
      originalMime: 'application/pdf',
      previewMime: 'application/pdf',
      vendor: 'Meadow Supply',
      date: '2026-11-10',
      status: 'draft',
      extractionStatus: 'partial',
      tax: 1.2,
      subtotal: 24,
      total: 25.2,
      lines: [
        {
          description: 'Bread flour · 2 bags',
          printedQuantity: 2,
          amount: 12,
          decision: '',
          quantity: null,
          unit: '',
        },
        {
          description: 'Market table supplies',
          amount: 8,
          decision: 'expense',
          category: 'Supplies expense',
        },
        { description: 'Personal groceries', amount: 4, decision: 'personal' },
      ],
    },
  ]
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica)
  doc
    .addPage([300, 600])
    .drawText(
      'MEADOW SUPPLY\n2026-11-10\n\nBread flour       12.00\nTable supplies     8.00\nPersonal           4.00\nTax                1.20\nTOTAL             25.20',
      { font, size: 12, x: 25, y: 550, lineHeight: 28 },
    )
  const pdf = Buffer.from(await doc.save()),
    actions: string[] = []
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().url().includes('receiptFile'))
      return route.fulfill({ contentType: 'application/pdf', body: pdf })
    if (route.request().method() === 'POST') {
      const { action, data } = route.request().postDataJSON()
      actions.push(action)
      if (action === 'receiptManual')
        w.receipt_extractions.push({
          id: crypto.randomUUID(),
          name: 'Manual receipt',
          vendor: '',
          date: '',
          status: 'draft',
          extractionStatus: 'manual',
          lines: [],
          tax: null,
        })
      else if (
        ['receiptDraft', 'receiptPost', 'receiptCancel'].includes(action)
      ) {
        try {
          const plan = planFinance(w, action, data, () => crypto.randomUUID())
          for (const write of plan.writes) {
            const rows = (w[write.table] ||= []),
              index = rows.findIndex((r) => r.id === write.record.id)
            const record = { ...write.record, updatedAt: crypto.randomUUID() }
            if (index >= 0) rows[index] = record
            else rows.push(record)
          }
          if (plan.journal) (w.journals ||= []).push(plan.journal)
        } catch (e) {
          return route.fulfill({ status: 400, json: { error: String(e) } })
        }
      } else if (action === 'receiptExtract') {
        w.receipt_extractions[0].extractionStatus = 'failed'
        w.receipt_extractions[0].extractionMessage =
          'Reader unavailable. Existing values preserved.'
      } else throw new Error('Unexpected fixture mutation: ' + action)
    }
    return route.fulfill({ json: { workspace: w, role: 'Owner', demo: true } })
  })
  return { w, actions }
}
for (const width of [390, 768, 1440])
  test(`finance and compact receipt rendering ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await fixture(page)
    await page.goto(workspaceFixtureUrl('Finances/Overview'))
    await expect(
      page.getByRole('heading', { name: 'Money made clear.' }),
    ).toBeVisible()
    await page.getByLabel('Date range').selectOption('All time')
    await expect(page.locator('.finance-summary-card')).toHaveCount(4)
    await page.getByRole('button', { name: /receipts awaiting review/ }).click()
    await expect(
      page.getByRole('heading', {
        name: 'Receipts awaiting review',
        exact: true,
      }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Close list', exact: true }).click()
    await page.screenshot({
      path: `docs/reviews/receipt-finance/after-finance-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: /Recorded expenses/ }).click()
    await expect(
      page.getByRole('heading', { name: 'Expense records', exact: true }),
    ).toBeVisible()
    await page.getByLabel('Date range').selectOption('Custom')
    await page.getByLabel('From', { exact: true }).fill('2020-01-01')
    await page.getByLabel('Through', { exact: true }).fill('2020-01-31')
    await expect(
      page.getByText('No matching records. Try another date range or search.'),
    ).toBeVisible()
    await page.goto(workspaceFixtureUrl('Finances/Receipt inbox'))
    await page.getByRole('button', { name: /Meadow Supply/ }).click()
    const review = page.getByRole('dialog', {
      name: 'Review receipt',
      exact: true,
    })
    await expect(review.locator('.receipt-row-editor')).toHaveCount(0)
    await expect(review.locator('.receipt-thumbnail canvas')).toHaveAttribute(
      'width',
      '78',
    )
    await page.screenshot({
      path: `docs/reviews/receipt-finance/after-receipt-${width}.png`,
      animations: 'disabled',
    })
    await review.getByRole('button', { name: /Bread flour.*Edit/ }).click()
    const input = review.getByLabel('Description', { exact: true })
    expect(
      await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16)
    expect(
      await review.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    await input.fill(
      'Long flour name · reviewed correction that stays in this exact row',
    )
    const previewButton = review.getByRole('button', {
      name: /show on receipt/,
    })
    await previewButton.scrollIntoViewIfNeeded()
    const editingTop = await review.evaluate((el) => el.scrollTop)
    await previewButton.click()
    await expect(
      page.getByRole('dialog', { name: 'Original receipt', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Back to editing' }).click()
    await expect
      .poll(() => review.evaluate((el) => el.scrollTop))
      .toBe(editingTop)
    await expect(input).toHaveValue(
      'Long flour name · reviewed correction that stays in this exact row',
    )
    await expect(review.locator('.receipt-row-editor')).toHaveCount(1)
    await input.focus()
    await page.setViewportSize({ width, height: 520 })
    await expect(input).toHaveValue(
      'Long flour name · reviewed correction that stays in this exact row',
    )
    await expect
      .poll(async () => {
        const box = await input.boundingBox()
        return box ? box.y >= 0 && box.y + box.height <= 520 : false
      })
      .toBe(true)
    await page.setViewportSize({ width, height: 900 })
    await review.getByRole('button', { name: 'Save as draft' }).click()
    await review
      .getByRole('button', { name: 'Close', exact: true })
      .first()
      .click()
    await page.getByRole('button', { name: /Meadow Supply/ }).click()
    await expect(
      page
        .getByRole('dialog', { name: 'Review receipt' })
        .getByText(
          'Long flour name · reviewed correction that stays in this exact row',
          { exact: true },
        ),
    ).toBeVisible()
  })
test('phone editing demo: automatic totals, manual recovery, personal allocation, draft/reopen and confirmation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { w, actions } = await fixture(page)
  await page.goto(workspaceFixtureUrl('Finances/Receipt inbox'))
  await page.getByRole('button', { name: /Meadow Supply/ }).click()
  const review = page.getByRole('dialog', {
    name: 'Review receipt',
    exact: true,
  })
  await test.step('Confirm tax', async () => {
    await review.getByLabel('Tax treatment').selectOption('exclusive')
  })
  await review.getByRole('button', { name: /Bread flour.*Edit/ }).click()
  await review.getByLabel('How to enter the amount').selectOption('quantity')
  await review.getByLabel('Quantity purchased', { exact: true }).fill('2')
  await review.getByLabel('Unit price ($)', { exact: true }).fill('6')
  await review.getByLabel('What is this for?').selectOption('expense')
  await review.getByLabel('Expense category').selectOption('Supplies expense')
  const totals = review.getByRole('region', {
    name: 'Automatic receipt totals',
  })
  await expect(totals).toContainText('$25.20')
  await review.getByLabel('Additional line discount ($)').fill('0.20')
  await expect(totals).toContainText('$25.00')
  await expect(totals).toContainText('differs from the printed total')
  await review.getByLabel('Additional line discount ($)').fill('0')
  await test.step('Retry reading preserves edits', async () => {
    await review.getByRole('button', { name: 'Retry reading' }).click()
  })
  await expect(
    review.getByLabel('Unit price ($)', { exact: true }),
  ).toHaveValue('6')
  await review.getByRole('button', { name: 'Save as draft' }).click()
  expect(actions).not.toContain('receiptPost')
  await review.getByRole('button', { name: 'Review confirmation' }).click()
  await expect(
    review.getByRole('region', { name: 'Confirm receipt effects' }),
  ).toBeInViewport()
  await expect(
    review.getByRole('region', { name: 'Confirm receipt effects' }),
  ).toContainText('$21.00')
  await expect(
    review.getByRole('region', { name: 'Confirm receipt effects' }),
  ).toContainText('$4.20')
  await page.screenshot({
    path: 'docs/reviews/receipt-finance/phone-confirmation.png',
    animations: 'disabled',
  })
  await review.getByRole('button', { name: 'Confirm & post' }).click()
  await expect(review).toHaveCount(0)
  expect(
    w.finance_transactions.filter((t) => t.receiptId === 'review-fixture'),
  ).toHaveLength(1)
  expect(w.receipt_extractions[0].fileHash).toBe('fixture-document')
  await page.getByRole('button', { name: /Meadow Supply/ }).click()
  await expect(
    page.getByRole('dialog', { name: 'Receipt record' }),
  ).toBeVisible()
  expect(actions.filter((a) => a === 'receiptPost')).toHaveLength(1)
})
test('manual receipt can complete with calculated totals and no printed total or file', async ({
  page,
}) => {
  await fixture(page)
  await page.goto(workspaceFixtureUrl('Finances/Receipt inbox'))
  await page.getByRole('button', { name: 'Add manually' }).click()
  const review = page.getByRole('dialog', { name: 'Review receipt' })
  await review.getByLabel('Merchant', { exact: true }).fill('Farm stand')
  await review.getByLabel('Receipt date', { exact: true }).fill('2026-11-10')
  await review.getByLabel('Tax treatment').selectOption('inclusive')
  await review.getByLabel('Receipt tax ($)', { exact: true }).fill('0')
  await review.getByRole('button', { name: 'Add line', exact: true }).click()
  await review.getByLabel('Description', { exact: true }).fill('Paper supplies')
  await review
    .getByLabel('Direct line amount ($)', { exact: true })
    .fill('4.25')
  await review.getByLabel('What is this for?').selectOption('expense')
  await review.getByLabel('Expense category').selectOption('Supplies expense')
  await review.getByRole('button', { name: 'Add line', exact: true }).click()
  await review
    .getByLabel('Description', { exact: true })
    .fill('Personal add-on')
  await review
    .getByLabel('Direct line amount ($)', { exact: true })
    .fill('0.75')
  await review.getByLabel('What is this for?').selectOption('personal')
  await expect(
    review.getByRole('region', { name: 'Automatic receipt totals' }),
  ).toContainText('$5.00')
  await review
    .getByRole('button', { name: 'Remove line 2', exact: true })
    .click()
  await expect(
    review.getByRole('region', { name: 'Automatic receipt totals' }),
  ).toContainText('$4.25')
  await review.getByRole('button', { name: 'Review confirmation' }).click()
  await expect(
    review.getByRole('button', { name: 'Confirm & post' }),
  ).toBeEnabled()
})
