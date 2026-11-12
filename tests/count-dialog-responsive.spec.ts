import { test, expect, type Page } from '@playwright/test'
import { installInventoryPackageFixture } from './inventory-package-fixture'
import { workspaceFixtureUrl } from './workspace-fixture'

async function contained(page: Page) {
  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toBeVisible()
  const bounds = await dialog.boundingBox()
  const viewport = page.viewportSize()!
  expect(bounds!.x).toBeGreaterThanOrEqual(11)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 11)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
  expect(
    await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1)
  await expect(
    dialog.getByRole('button', { name: 'Close', exact: true }).last(),
  ).toBeEnabled()
}

test.afterEach(async ({ page }) =>
  page.unrouteAll({ behavior: 'ignoreErrors' }),
)
for (const [width, height] of [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
  [844, 390],
  [820, 1180],
  [1180, 820],
  [1440, 1000],
]) {
  test(`count sessions contained at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    const w = await installInventoryPackageFixture(page)
    const item = w.ingredients[0]
    item.name = 'Long inventory name ' + 'UnbrokenDescription'.repeat(20)
    w.inventory_counts = [
      {
        id: 'layout-session',
        name: 'Layout test session',
        date: '2026-11-12',
        status: 'draft',
        revision: 1,
        lines: [
          {
            ingredientId: item.id,
            name: item.name,
            enteredQuantity: 1,
            enteredUnit: item.unit,
            countedQuantity: 1,
            systemQuantity: 2,
            unit: item.unit,
          },
        ],
      },
    ]
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST')
        return route.fulfill({
          status: 503,
          json: {
            error: 'Connection unavailable ' + 'RetryDetails'.repeat(50),
          },
        })
      return route.fulfill({
        json: { workspace: w, role: 'Owner', demo: false },
      })
    })
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    const trigger = page.getByRole('button', {
      name: 'Inventory count sessions',
      exact: true,
    })
    await trigger.click()
    await contained(page)
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Saved session').selectOption('layout-session')
    await dialog.getByLabel(/^Item/).selectOption(item.id)
    await dialog.getByLabel('Actual quantity on hand').fill('12.5')
    await dialog
      .getByRole('button', { name: 'Start new count', exact: true })
      .click()
    await expect(dialog.getByRole('alert')).toContainText(
      'Connection unavailable',
    )
    await contained(page)
    await dialog
      .getByLabel(
        'I reviewed all differences and their stock/accounting effects.',
      )
      .check()
    await expect(
      dialog.getByRole('button', { name: 'Apply reviewed count adjustments' }),
    ).toBeEnabled()
    await contained(page)
    // Simulate the reduced visual viewport from a keyboard/browser toolbar.
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'height', {
        configurable: true,
        value: 300,
      })
      Object.defineProperty(window.visualViewport, 'offsetTop', {
        configurable: true,
        value: 20,
      })
      window.visualViewport!.dispatchEvent(new Event('resize'))
    })
    if (width <= 1024) {
      await expect
        .poll(async () => (await dialog.boundingBox())!.y)
        .toBeGreaterThanOrEqual(20)
      const bounds = await dialog.boundingBox()
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(320)
    }
    await page.evaluate(() => {
      delete (window.visualViewport as unknown as Record<string, unknown>)
        .height
      delete (window.visualViewport as unknown as Record<string, unknown>)
        .offsetTop
      window.visualViewport!.dispatchEvent(new Event('resize'))
    })
    await dialog
      .getByRole('button', { name: 'Close', exact: true })
      .last()
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(() => document.body.hasAttribute('data-scroll-locked')),
      )
      .toBe(false)
    await trigger.click()
    await expect(dialog.getByLabel('Actual quantity on hand')).toHaveValue(
      '12.5',
    )
    await expect
      .poll(() =>
        page.evaluate(() => document.body.hasAttribute('data-scroll-locked')),
      )
      .toBe(true)
    await contained(page)
    await dialog.getByRole('button', { name: 'Scan barcode for count' }).click()
    await contained(page)
    const scanner = page.getByRole('dialog').last()
    await scanner
      .getByLabel('Barcode or internal QR text')
      .fill('000000123456789')
    await scanner.getByRole('button', { name: 'Use entered code' }).click()
    const assignment = page.getByRole('dialog').last()
    await expect(assignment).toContainText('Unknown barcode')
    await assignment.getByLabel('Link existing item').selectOption(item.id)
    await contained(page)
    await assignment
      .getByRole('button', { name: 'Close', exact: true })
      .last()
      .click()

    await contained(page)
    // Render the complete entry popup without a long fixture report.
    await dialog.getByLabel('Saved session').selectOption('')
    await dialog
      .getByRole('button', { name: 'Close', exact: true })
      .last()
      .click()
    await trigger.click()
    if (width === 390)
      await page.screenshot({
        path: 'docs/previews/count-session-responsive-390.png',
      })
  })
}
