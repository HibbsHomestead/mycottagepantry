import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { demoData } from '../src/lib/demo'
import { rapidCountCommand } from '../src/lib/rapid-count'
import { convert, type Item } from '../src/lib/domain'
async function reachable(page: Page, dialog: Locator) {
  const view = await page.evaluate(() => ({
    top: visualViewport!.offsetTop,
    left: visualViewport!.offsetLeft,
    width: visualViewport!.width,
    height: visualViewport!.height,
  }))
  const bounds = (await dialog.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(view.left - 1)
  expect(bounds.y).toBeGreaterThanOrEqual(view.top - 1)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    view.left + view.width + 1,
  )
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(
    view.top + view.height + 1,
  )
  expect(
    await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1)
  for (const control of await dialog
    .locator('button:visible, input:visible, select:visible')
    .all()) {
    await control.scrollIntoViewIfNeeded()
    const box = (await control.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(view.left - 1)
    expect(box.x + box.width).toBeLessThanOrEqual(view.left + view.width + 1)
    expect(box.y).toBeGreaterThanOrEqual(view.top - 1)
    expect(box.y + box.height).toBeLessThanOrEqual(view.top + view.height + 1)
  }
  const close = dialog.getByRole('button', { name: 'Close', exact: true })
  await expect(close).toBeInViewport({ ratio: 1 })
}

for (const width of [320, 375, 390, 430, 820, 844, 1440])
  test(`rapid inventory scanning, review and applied report ${width}`, async ({
    page,
  }) => {
    await installWorkspaceFixture(page)
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 })
    const w = demoData()
    for (const key of Object.keys(w)) if (key !== 'settings') w[key] = []
    w.inventory_counts = []
    w.journals = []
    w.ingredients = [
      {
        id: 'sugar',
        name: 'Powdered sugar',
        unit: 'g',
        storageUnit: 'lb',
        quantity: 4535.9237,
        cost: 2 / 453.59237,
        trackInventory: true,
        barcode: '000007',
        purchaseQuantity: 7,
        purchaseUnit: 'lb',
        usedAs: 'ingredient',
      },
      {
        id: 'twine',
        name: 'Twine',
        unit: 'each',
        quantity: 20,
        cost: 1,
        usedAs: 'supply',
      },
    ]
    const revision = (item: Item) =>
      JSON.stringify([
        item.quantity,
        item.unit,
        w.ledger
          .filter((l) => l.ingredientId === item.id)
          .map((l) => [l.id, l.quantity]),
      ])
    const response = () => ({
      ...w,
      ingredients: w.ingredients.map((i) => ({
        ...i,
        inventoryRevision: revision(i),
      })),
    })
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        try {
          const effects = rapidCountCommand(w, body.data, {
            actor: 'test-counter',
            role: 'Owner',
            now: new Date().toISOString(),
            businessName: 'Disposable count fixture',
            revision,
          })
          for (const e of effects)
            w[e.table] = [
              ...(w[e.table] || []).filter((i) => i.id !== e.item.id),
              e.item,
            ]
        } catch (error) {
          return route.fulfill({
            status: 400,
            json: { error: (error as Error).message },
          })
        }
      }
      return route.fulfill({
        json: { workspace: response(), role: 'Owner', demo: true },
      })
    })
    await page.goto(workspaceFixtureUrl('Inventory/Counts'))
    const counts = page.locator('.inventory-counts')
    await expect(
      counts.getByRole('heading', {
        name: 'Inventory counts',
        exact: true,
      }),
    ).toBeVisible()
    await counts
      .getByRole('button', { name: 'Start count', exact: true })
      .click()
    await counts.getByRole('button', { name: 'Save & start counting' }).click()
    await expect(
      counts.getByRole('heading', {
        name: 'Quarterly inventory count',
        exact: true,
      }),
    ).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
    const scannerTrigger = counts.getByRole('button', {
      name: 'Open rapid scanner',
    })
    await scannerTrigger.click()
    const dialog = page.getByRole('dialog')
    await reachable(page, dialog)
    const bounds = await dialog.boundingBox()
    if (width <= 700 || width === 844) {
      expect(bounds!.x).toBe(0)
      expect(bounds!.y).toBe(0)
      expect(bounds!.width).toBe(width)
      expect(bounds!.height).toBe(width === 844 ? 390 : 844)
    }
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(scannerTrigger).toBeFocused()
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await scannerTrigger.click()
    await reachable(page, dialog)
    await dialog.getByRole('textbox').focus()
    await page.evaluate(() => {
      Object.defineProperties(visualViewport, {
        height: { configurable: true, value: 280 },
        offsetTop: { configurable: true, value: 24 },
      })
      visualViewport!.dispatchEvent(new Event('resize'))
    })
    await expect
      .poll(async () => {
        const b = (await dialog.boundingBox())!
        return b.y + b.height
      })
      .toBeLessThanOrEqual(304)
    await reachable(page, dialog)
    await page.evaluate(() => {
      delete (visualViewport as unknown as Record<string, unknown>).height
      delete (visualViewport as unknown as Record<string, unknown>).offsetTop
      visualViewport!.dispatchEvent(new Event('resize'))
    })
    await expect
      .poll(async () => (await dialog.boundingBox())!.height)
      .toBeGreaterThan(280)
    // Pinch zoom / horizontally offset visual viewport must also stay bounded,
    // including desktop where the layout viewport remains wider than the view.
    await page.evaluate(() => {
      Object.defineProperties(visualViewport, {
        width: { configurable: true, value: 280 },
        offsetLeft: { configurable: true, value: 16 },
      })
      visualViewport!.dispatchEvent(new Event('resize'))
    })
    await expect
      .poll(async () => {
        const b = (await dialog.boundingBox())!
        return b.x + b.width
      })
      .toBeLessThanOrEqual(296)
    await reachable(page, dialog)
    await page.evaluate(() => {
      delete (visualViewport as unknown as Record<string, unknown>).width
      delete (visualViewport as unknown as Record<string, unknown>).offsetLeft
      visualViewport!.dispatchEvent(new Event('resize'))
    })
    await expect
      .poll(async () => (await dialog.boundingBox())!.width)
      .toBeGreaterThan(280)
    const backgroundScroll = await page.evaluate(() => scrollY)
    await page.mouse.move(2, 2)
    await page.mouse.wheel(0, 500)
    expect(await page.evaluate(() => scrollY)).toBe(backgroundScroll)
    await dialog.getByRole('textbox').fill('000007')
    await dialog.getByRole('button', { name: 'Use entered code' }).click()
    await expect(dialog).toContainText('7 lb')
    await expect(dialog).toContainText('All changes saved')
    await reachable(page, dialog)
    await dialog.locator('.scanner-body').evaluate((el) => (el.scrollTop = 0))
    await page.screenshot({
      path: `docs/previews/rapid-count-scanning-${width}.png`,
      fullPage: false,
    })
    await dialog
      .getByRole('button', { name: 'Partial/open package', exact: true })
      .click()
    await expect(counts.getByLabel('Entry type')).toHaveValue('partial')
    await expect(counts.getByLabel('Actual remaining amount')).toBeVisible()
    await counts.getByLabel('Actual remaining amount').fill('2.5')
    await scannerTrigger.click()
    await expect(dialog).toContainText('7 lb')
    await reachable(page, dialog)
    await dialog.getByRole('textbox').fill('000050')
    await dialog.getByRole('button', { name: 'Use entered code' }).click()
    await expect(dialog).toContainText('unknown barcode')
    await dialog
      .getByRole('button', { name: 'Pause / return to count' })
      .click()
    await expect(counts).toContainText('1 occurrences')
    await counts.getByRole('button', { name: 'Resolve / link' }).click()
    await counts
      .getByRole('combobox', { name: 'Link existing item', exact: true })
      .selectOption('sugar')
    await counts
      .getByRole('textbox', { name: 'Package description', exact: true })
      .fill('Brand B 50 lb bag')
    await counts
      .getByRole('textbox', {
        name: 'Package contents quantity',
        exact: true,
      })
      .fill('50')
    await counts
      .getByRole('textbox', { name: 'Contents unit', exact: true })
      .fill('lb')
    await counts
      .getByRole('button', {
        name: 'Save this barcode/package assignment and count queued packages',
      })
      .click()
    await expect(counts.locator('.count-review-row').first()).toContainText(
      '57',
    )
    // Persisted draft survives an ordinary reload; session is resumed from history.
    await page.reload()
    await counts
      .getByRole('button', {
        name: /Quarterly inventory count.*In progress/,
      })
      .click()
    await expect(counts.locator('.count-review-row').first()).toContainText(
      '57',
    )
    await counts
      .getByRole('checkbox', { name: /Allow an explicitly Partial count/ })
      .check()
    await counts
      .getByRole('button', { name: 'Review & prepare stock update' })
      .click()
    await expect(counts).toContainText('Ready for review')
    await page.screenshot({
      path: `docs/previews/rapid-count-review-${width}.png`,
      fullPage: true,
    })
    await counts
      .getByRole('checkbox', {
        name: /I approve these Partial count differences/,
      })
      .check()
    await counts
      .getByRole('button', { name: 'Confirm & apply stock adjustments' })
      .click()
    await expect(
      counts.getByRole('heading', { name: 'Discrepancy report' }),
    ).toBeVisible()
    expect(
      convert(w.ingredients.find((i) => i.id === 'sugar')!.quantity, 'g', 'lb'),
    ).toBeCloseTo(57)
    expect(w.ingredients.find((i) => i.id === 'twine')!.quantity).toBe(20)
    expect(w.expenses).toHaveLength(0)
    expect(w.ledger).toHaveLength(1)
    await counts
      .getByText('Package evidence, notes & valuation')
      .first()
      .click()
    await expect(counts).toContainText('value difference $94.00')
    const download = page.waitForEvent('download')
    await counts.getByRole('button', { name: 'CSV', exact: true }).click()
    expect((await download).suggestedFilename()).toMatch(/inventory-count-/)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: `docs/previews/rapid-count-report-${width}.png`,
      fullPage: true,
    })
    await page.emulateMedia({ media: 'print' })
    await expect(counts.locator('.count-report')).toBeVisible()
  })
