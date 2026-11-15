import { test, expect } from '@playwright/test'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { demoData } from '../src/lib/demo'
import { bookSummary } from '../src/lib/checkbook'
for (const width of [1440, 2560, 390])
  test(`Purchasing and linked records ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const w = demoData()
    w.receipt_extractions = [
      {
        id: 'receipt-link',
        name: 'Meadow Supply',
        vendor: 'Meadow Supply',
        date: '2025-01-10',
        status: 'posted',
        transactionId: 'payment-link',
        lines: [],
        total: 42,
        subtotal: 40,
        tax: 2,
      },
    ]
    w.ledger.push({
      id: 'purchase-link',
      name: 'Bread flour received',
      type: 'purchase_receipt',
      date: '2025-01-10',
      receivedDate: '2025-01-10',
      quantity: 5,
      unit: 'lb',
      amount: 42,
      receiptId: 'receipt-link',
      transactionId: 'payment-link',
    })
    w.finance_transactions = [
      {
        id: 'payment-link',
        name: 'Meadow Supply',
        kind: 'receipt',
        amount: 42,
        date: '2025-01-10',
        receiptId: 'receipt-link',
        account: 'Business checking',
      },
      {
        id: 'refund-link',
        name: 'Meadow Supply correction',
        kind: 'reversal',
        amount: -2,
        date: '2025-01-11',
        receiptId: 'receipt-link',
      },
    ]
    let mutations = 0
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') mutations++
      w.bookkeeping = [bookSummary(w, '2026-11-01', '2026-11-30')]
      await route.fulfill({ json: { workspace: w, role: 'Owner', demo: true } })
    })
    await page.goto(workspaceFixtureUrl('Purchasing/Purchases & Receipts'))
    await expect(
      page.getByRole('complementary', { name: 'Purchasing sections' }),
    ).toBeVisible()
    await expect(page.locator('.section-tabs')).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy()
    await page.screenshot({
      path: `docs/reviews/purchasing/purchasing-${width}.png`,
      fullPage: true,
    })
    if (width === 390) {
      await page.getByRole('button', { name: /^Purchasing ·/ }).click()
      await expect(
        page.getByRole('button', { name: 'Suppliers', exact: true }),
      ).toBeVisible()
      await page.screenshot({
        path: 'docs/reviews/purchasing/mobile-navigation.png',
        fullPage: true,
      })
      await page.getByRole('button', { name: /^Purchasing ·/ }).click()
    }
    await page.getByLabel('Search receipts').fill('Meadow')
    await page.getByLabel('From', { exact: true }).fill('2026-11-01')
    await page.getByLabel('To', { exact: true }).fill('2026-11-30')
    await page
      .getByRole('button', { name: 'Upload receipt', exact: true })
      .click()
    await expect(
      page.getByRole('dialog', { name: 'Upload receipt', exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/purchasing/receipt-popup-${width}.png`,
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByLabel('Search receipts')).toHaveValue('Meadow')
    const purchaseLink = page
      .getByRole('button', { name: 'View purchase', exact: true })
      .last()
    await purchaseLink.scrollIntoViewIfNeeded()
    const sourceScroll = await page.evaluate(() => window.scrollY)
    await purchaseLink.click()
    await expect(
      page.getByRole('dialog', { name: 'Purchase details' }),
    ).toBeVisible()
    await expect(page.getByText('2 linked financial entries')).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/purchasing/purchase-detail-${width}.png`,
      fullPage: true,
    })
    await page
      .getByRole('button', { name: /View in Finance/ })
      .first()
      .click()
    await expect(
      page.getByRole('dialog', { name: 'Finance entry' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /View purchase · Bread flour/ }),
    ).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/purchasing/finance-detail-${width}.png`,
      fullPage: true,
    })
    await page.goBack()
    await expect(
      page.getByRole('dialog', { name: 'Purchase details' }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Back to Purchasing', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByLabel('Search receipts')).toHaveValue('Meadow')
    await expect(page.getByLabel('From', { exact: true })).toHaveValue(
      '2026-11-01',
    )
    await expect(page.getByLabel('To', { exact: true })).toHaveValue(
      '2026-11-30',
    )
    await expect.poll(async () =>
      Math.abs((await page.evaluate(() => window.scrollY)) - sourceScroll),
    ).toBeLessThan(4)
    await page
      .getByRole('button', { name: 'View purchase', exact: true })
      .last()
      .click()
    await page
      .getByRole('button', { name: /View in Finance/ })
      .first()
      .click()
    await page.reload()
    await expect(page.getByLabel('Search receipts')).toHaveValue('Meadow')
    await expect(page.getByLabel('From', { exact: true })).toHaveValue(
      '2026-11-01',
    )
    await expect(page.getByLabel('To', { exact: true })).toHaveValue(
      '2026-11-30',
    )
    await expect(
      page.getByRole('dialog', { name: 'Finance entry' }),
    ).toBeVisible()
    await page.goto(
      workspaceFixtureUrl('Finance/Register') +
        '?linked=finance&record=payment-link',
    )
    await expect(
      page.getByRole('dialog', { name: 'Finance entry' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /View purchase · Bread flour/ }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Back to Finance', exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/purchasing/finance-detail-${width}.png`,
      fullPage: true,
    })
    await page
      .getByRole('button', { name: 'Back to Finance', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const unlinked = w.ledger.find(
      (l) => l.type === 'purchase_receipt' && !l.transactionId && !l.receiptId,
    )!
    await page.goto(
      workspaceFixtureUrl('Purchasing/Purchases & Receipts') +
        '?linked=purchase&record=' +
        unlinked.id,
    )
    await expect(page.getByText('No financial entry linked')).toBeVisible()
    await page.goto(
      workspaceFixtureUrl('Finance/Register') +
        '?linked=finance&record=unavailable-business-record',
    )
    await expect(
      page.getByText(
        'This record is unavailable or you do not have access to it.',
      ),
    ).toBeVisible()
    expect(mutations).toBe(0)
  })

for (const section of ['Purchasing/Purchases & Receipts', 'Finance/Overview'])
  test(`shared upload from ${section}`, async ({ page }) => {
    await installWorkspaceFixture(page)
    const w = demoData(),
      actions: string[] = []
    w.receipt_extractions = []
    await page.route('**/api/workspace*', async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.has('receiptUpload')) {
        const receipt = {
          id: 'uploaded-fixture',
          name: 'Uploaded receipt',
          status: 'draft',
          vendor: 'Meadow Supply',
          date: '2026-11-01',
          extractionStatus: 'queued',
          fileHash: 'fixture',
          originalMime: 'image/png',
          previewMime: 'image/png',
          lines: [],
          history: [],
        }
        w.receipt_extractions = [receipt]
        return route.fulfill({ json: { receipt } })
      }
      if (url.searchParams.has('receiptFile'))
        return route.fulfill({
          contentType: 'image/png',
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSmkAAAAASUVORK5CYII=',
            'base64',
          ),
        })
      if (route.request().method() === 'POST') {
        const { action } = route.request().postDataJSON()
        actions.push(action)
        if (action === 'receiptExtract')
          Object.assign(w.receipt_extractions[0], {
            extractionStatus: 'partial',
            subtotal: 10,
            tax: 0.5,
            printedTotal: 10.5,
            total: 10.5,
            currency: 'USD',
            lines: [
              {
                description: 'Packing tape',
                amount: 10,
                allocation: 'unreviewed',
                decision: '',
                quantity: 1,
                unit: 'each',
              },
            ],
          })
      }
      w.bookkeeping = [bookSummary(w, '2026-11-01', '2026-11-30')]
      return route.fulfill({
        json: { workspace: w, role: 'Owner', demo: true },
      })
    })
    await page.goto(workspaceFixtureUrl(section))
    await page
      .getByRole('button', { name: 'Upload receipt', exact: true })
      .click()
    await page
      .locator('input[type=file][aria-label="Upload receipt"]')
      .setInputFiles({
        name: 'receipt.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSmkAAAAASUVORK5CYII=',
          'base64',
        ),
      })
    await expect(page.locator('.receipt-review-dialog')).toBeVisible()
    await expect(
      page.getByLabel('Line 1 description', { exact: true }),
    ).toHaveValue('Packing tape')
    await expect(page).toHaveURL(
      new RegExp(
        '#' + section.split('/').map(encodeURIComponent).join('/') + '$',
      ),
    )
    expect(actions).toContain('receiptExtract')
    expect(actions).not.toContain('receiptPost')
    await page.screenshot({
      path: `docs/reviews/purchasing/upload-review-${section.startsWith('Finance') ? 'finance' : 'purchasing'}.png`,
      fullPage: true,
    })
  })
