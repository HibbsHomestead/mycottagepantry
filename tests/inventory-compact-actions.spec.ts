import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [320, 390, 430, 820]) {
  test(`compact inventory actions ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.ingredients[0].storageLocation = 'Pantry shelf 1'
    workspace.ingredients.push({
      id: 'craft-preview',
      name: 'Cotton fabric',
      usedAs: 'material',
      materialType: 'fabric',
      quantity: 3,
      unit: 'yd',
      cost: 4,
      storageLocation: 'Craft shelf',
    })
    await page.route('**/api/workspace*', (r) =>
      r.fulfill({ json: { workspace, role: 'Owner', demo: false } }),
    )
    await page.goto(workspaceFixtureUrl('Inventory/Craft Materials'))
    const actions = page.locator('.inventory-primary-actions')
    await expect(actions.locator(':scope > .btn')).toHaveCount(6)
    await expect(
      actions.getByRole('button', {
        name: 'Print shelf/bin labels (0)',
        exact: true,
      }),
    ).toBeDisabled()
    const checkGrid = async () => {
      const boxes = await actions
        .locator(':scope > .btn')
        .evaluateAll((elements) =>
          elements.map((el) => {
            const r = el.getBoundingClientRect()
            return {
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              fits:
                el.scrollWidth <= el.clientWidth &&
                el.scrollHeight <= el.clientHeight,
            }
          }),
        )
      if (width <= 700) {
        expect(boxes[0].y).toBe(boxes[2].y)
        expect(boxes[3].y).toBe(boxes[5].y)
        expect(boxes[3].y).toBeGreaterThan(boxes[0].y)
        for (const b of boxes) {
          expect(b.width).toBeCloseTo(boxes[0].width, 0)
          expect(b.height).toBeGreaterThanOrEqual(44)
          expect(b.fits).toBe(true)
        }
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
    await checkGrid()
    await actions.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: `docs/reviews/inventory-actions/craft-${width}.png`,
    })
    for (const name of [
      'Scan barcode',
      'Scan to receive',
      'Inventory count sessions',
      'Location labels',
    ]) {
      await actions.getByRole('button', { name, exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(
        dialog.getByRole('heading', {
          name: name.includes('Scan')
            ? 'Scan barcode'
            : name === 'Inventory count sessions'
              ? 'Inventory count session'
              : 'Shelf / bin / location labels',
          exact: true,
        }),
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }
    await actions.getByRole('link', { name: 'Rapid barcode counts' }).click()
    await expect(page).toHaveURL(/Inventory\/Counts/)
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page
      .getByText('Select inventory items for shelf/bin labels', { exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Select up to 100', exact: true })
      .click()
    const shelf = actions.getByRole('button', {
      name: /^Print shelf\/bin labels/,
    })
    await expect(shelf).toBeEnabled()
    await expect(actions.locator('.inventory-action-badge')).not.toHaveText('0')
    await page
      .getByText('Select inventory items for shelf/bin labels', { exact: true })
      .click()
    await actions.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: `docs/reviews/inventory-actions/selected-${width}.png`,
    })
    if (width <= 700) {
      await page.addStyleTag({
        content:
          '.inventory-primary-actions > .btn {font-size: 26px !important}',
      })
      await checkGrid()
      await page.screenshot({
        path: `docs/reviews/inventory-actions/large-text-${width}.png`,
      })
    } else {
      await expect(
        actions.locator('.inventory-action-short').first(),
      ).toBeHidden()
      await expect(
        actions.locator('.inventory-action-icon').first(),
      ).toBeHidden()
    }
    await shelf.click()
    await expect(
      page.getByRole('heading', {
        name: 'Shelf / bin / location labels',
        exact: true,
      }),
    ).toBeVisible()
  })
}
