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

async function fixture(
  page: import('@playwright/test').Page,
  beforeAction?: (action: string) => Promise<string | void>,
) {
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
      const failure = await beforeAction?.(action)
      if (failure)
        return route.fulfill({ status: 503, json: { error: failure } })
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
async function openManualReceipt(page: import('@playwright/test').Page) {
  await page.goto(workspaceFixtureUrl('Purchasing/Purchases & Receipts'))
  await page
    .getByRole('button', { name: 'Upload receipt', exact: true })
    .click()
  await page.getByRole('button', { name: 'Add manually' }).click()
  return page.getByRole('dialog', { name: 'Review receipt' })
}

function deferred() {
  let release!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return { wait, release }
}

const postingRecords = (w: ReturnType<typeof demoData>) =>
  structuredClone({
    finance: w.finance_transactions,
    ledger: w.ledger,
    journals: w.journals,
    ingredients: w.ingredients,
    products: w.products,
    packaging: w.packaging,
  })

test('manual receipt calculates a total and excludes a line before review', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await fixture(page)
  const review = await openManualReceipt(page)
  await review.getByLabel('Merchant', { exact: true }).fill('Farm stand')
  await review.getByLabel('Receipt date', { exact: true }).fill('2026-11-10')
  await review.getByLabel('Tax treatment').selectOption('inclusive')
  await review.getByLabel('Receipt tax ($)', { exact: true }).fill('0')
  const add = review.getByRole('button', { name: 'Insert new line' })
  await add.click()
  await review.getByLabel('Line 1 description').fill('Paper supplies')
  await review.getByLabel('Line 1 subtotal').fill('4.25')
  await review.getByLabel('Line 1 allocation').selectOption('business')
  await review.getByRole('button', { name: /Edit details/ }).click()
  await review.getByLabel('Expense category').selectOption('Supplies expense')
  await review.locator('.receipt-row-summary').click()
  await add.click()
  await review.getByLabel('Line 2 description').fill('Personal add-on')
  await review.getByLabel('Line 2 subtotal').fill('0.75')
  const totals = review.locator('.receipt-table-total')
  await expect(totals).toContainText('$5.00')
  const first = await review.getByLabel('Line 1 description').elementHandle()
  await review
    .locator('.receipt-compact-row')
    .nth(1)
    .getByRole('button', { name: /Edit details/ })
    .click()
  await review
    .getByRole('button', { name: 'Remove line 2', exact: true })
    .click()
  await expect(review.getByLabel('Line 2 description')).toHaveCount(0)
  await expect(totals).toContainText('$5.00') // The excluded item remains on the receipt.
  expect(await first!.evaluate((el) => el.isConnected)).toBe(true)
  await review.getByLabel('Receipt total (from receipt)').fill('5.00')
  await review.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(
    review.getByRole('button', { name: 'Confirm & post' }),
  ).toBeEnabled()
})

test('manual receipt keeps focus and newer edits through slow draft responses', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const firstSave = deferred()
  const secondSave = deferred()
  let drafts = 0
  const { w, actions } = await fixture(page, async (action) => {
    if (action !== 'receiptDraft') return
    drafts++
    await (drafts === 1 ? firstSave.wait : secondSave.wait)
  })
  const before = postingRecords(w)
  try {
    const review = await openManualReceipt(page)
    const merchant = review.getByLabel('Merchant', { exact: true })
    const date = review.getByLabel('Receipt date', { exact: true })
    await review.evaluate((dialog) => {
      for (const event of ['submit', 'reset']) {
        dialog.addEventListener(
          event,
          () => dialog.setAttribute('data-unexpected-event', event),
          true,
        )
      }
    })
    await merchant.fill('Fixture orchard')
    await merchant.press('Tab')
    await expect(date).toBeFocused()
    await date.press('Shift+Tab')
    await expect(merchant).toBeFocused()
    await date.click()
    await expect(date).toBeFocused()
    await date.fill('2026-11-10')
    await review.getByRole('button', { name: 'Insert new line' }).click()
    const description = review.getByLabel('Line 1 description')
    await description.click()
    await expect(description).toBeFocused()
    await expect
      .poll(() => actions)
      .toEqual(['receiptManual', 'receiptDraft'])
    await expect(description).toBeFocused()
    await expect(description).toBeEnabled()
    await expect(
      review.getByRole('button', { name: 'Processing…' }),
    ).toHaveCount(0)

    await description.pressSequentially('Paper bags')
    await merchant.fill('Fixture orchard updated')
    await review.getByLabel('Tax treatment').selectOption('exclusive')
    const tax = review.getByLabel('Receipt tax ($)')
    await tax.click()
    await tax.pressSequentially('0.50')
    await expect(tax).toBeFocused()
    await review.getByRole('button', { name: 'Details & history' }).click()
    await review
      .getByText('Discounts, fees & more details', { exact: true })
      .click()
    const number = review.getByLabel('Receipt / invoice number')
    await number.fill('FIX-02')
    await expect(number).toBeFocused()
    await review.getByRole('button', { name: 'Back to editing' }).click()
    await review.getByRole('button', { name: /Edit details/ }).click()
    await review
      .getByLabel('How to enter the amount')
      .selectOption('quantity')
    const quantity = review.getByLabel('Quantity purchased')
    const price = review.getByLabel('Unit price ($)', { exact: true })
    await quantity.fill('2')
    await quantity.press('Tab')
    await expect(price).toBeFocused()
    await price.pressSequentially('3.25')
    const node = await price.elementHandle()
    firstSave.release()
    await expect.poll(() => drafts).toBe(2)
    expect(w.receipt_extractions.at(-1)?.vendor).toBe('Fixture orchard')
    await expect(price).toBeFocused()
    await expect(price).toHaveValue('3.25')
    await expect(merchant).toHaveValue('Fixture orchard updated')
    await expect(description).toHaveValue('Paper bags')
    secondSave.release()
    await expect(review.getByText(/Saving draft/)).toHaveCount(0)
    await expect(price).toBeFocused()
    expect(
      await node!.evaluate(
        (el) => el.isConnected && document.activeElement === el,
      ),
    ).toBe(true)
    await expect(price).toHaveValue('3.25')
    expect(w.receipt_extractions.at(-1)?.receiptNumber).toBe('FIX-02')
    expect(w.receipt_extractions.at(-1)?.total).toBe(7)
    await expect(review.getByLabel('Line 1 total')).toHaveValue('7')
    await expect(review).not.toHaveAttribute('data-unexpected-event')
    expect(actions).toEqual(['receiptManual', 'receiptDraft', 'receiptDraft'])
    expect(postingRecords(w)).toEqual(before)
  } finally {
    firstSave.release()
    secondSave.release()
  }
})

test('manual receipt retains focus after a failed draft save and retries an explicit save', async ({
  page,
}) => {
  const slowFailure = deferred()
  let drafts = 0
  const { w, actions } = await fixture(page, async (action) => {
    if (action !== 'receiptDraft') return
    drafts++
    if (drafts === 1) {
      await slowFailure.wait
      return 'Fixture background save failed.'
    }
    if (drafts === 2) return 'Fixture explicit save failed.'
  })
  const before = postingRecords(w)
  try {
    const review = await openManualReceipt(page)
    const merchant = review.getByLabel('Merchant', { exact: true })
    const date = review.getByLabel('Receipt date', { exact: true })
    const save = review.getByRole('button', { name: 'Save as draft' })
    await date.fill('2026-11-10')
    await merchant.fill('Fixture retry')
    await merchant.press('Tab')
    await expect.poll(() => drafts).toBe(1)
    await expect(date).toBeFocused()
    slowFailure.release()
    const error = review.locator(
      '.finance-sticky-actions > .form-error-notice',
    )
    await expect(error).toContainText('Draft could not be saved')
    const noticeBounds = await error.boundingBox()
    const saveBounds = await save.boundingBox()
    expect(noticeBounds!.y + noticeBounds!.height).toBeLessThanOrEqual(saveBounds!.y)
    await expect(date).toBeFocused()
    await expect(merchant).toHaveValue('Fixture retry')
    await save.click()
    await expect(error).toContainText('Fixture explicit save failed')
    await expect(merchant).toHaveValue('Fixture retry')
    await expect(date).toHaveValue('2026-11-10')
    await save.click()
    await expect(error).toHaveCount(0)
    await expect
      .poll(() => w.receipt_extractions.at(-1)?.vendor)
      .toBe('Fixture retry')
    expect(actions).toEqual([
      'receiptManual',
      'receiptDraft',
      'receiptDraft',
      'receiptDraft',
    ])
    expect(postingRecords(w)).toEqual(before)
  } finally {
    slowFailure.release()
  }
})


test('manual receipt explicit save queues the newest snapshot behind an in-flight draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const pending = deferred()
  let drafts = 0
  const { w, actions } = await fixture(page, async (action) => {
    if (action === 'receiptDraft' && ++drafts === 1) await pending.wait
  })
  const before = postingRecords(w)
  try {
    const review = await openManualReceipt(page)
    const merchant = review.getByLabel('Merchant', { exact: true })
    const date = review.getByLabel('Receipt date', { exact: true })
    await merchant.fill('Fixture older draft')
    await merchant.press('Tab')
    await expect.poll(() => drafts).toBe(1)
    await expect(date).toBeFocused()
    await merchant.fill('Fixture explicit edit')
    await merchant.press('Tab')
    await expect(date).toBeFocused()
    await review.getByRole('button', { name: 'Save as draft' }).click()
    await expect(review.getByRole('button', { name: 'Processing…' })).toBeVisible()
    expect(drafts).toBe(1)
    pending.release()
    await expect.poll(() => w.receipt_extractions.at(-1)?.vendor).toBe('Fixture explicit edit')
    await expect(merchant).toHaveValue('Fixture explicit edit')
    await expect(merchant).toBeEnabled()
    expect(actions).toEqual(['receiptManual', 'receiptDraft', 'receiptDraft'])
    expect(postingRecords(w)).toEqual(before)
  } finally {
    pending.release()
  }
})
