import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const [width, height] of [
  [1440, 900],
  [1280, 600],
  [390, 650],
]) {
  test(`product scroll and packaging ${width}x${height}`, async ({ page }) => {
    page.setDefaultTimeout(8000)
    await page.setViewportSize({ width, height })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.products[0].packagingLines = []
    workspace.products[0].packagingId = ''
    const packaging = workspace.ingredients.find(
      (i) => i.usedAs === 'packaging',
    )!
    packaging.name =
      'Long packaging item name — compostable bakery bag with window and reusable closure'
    const writes: unknown[] = []
    await page.route('**/api/workspace*', (route) => {
      if (route.request().url().includes('Categories'))
        return route.fulfill({
          json: {
            categories: [],
            products: workspace.products,
            recipes: workspace.recipes,
            revision: 1,
            mappings: {},
            rates: [],
          },
        })
      if (route.request().method() === 'POST')
        writes.push(route.request().postDataJSON())
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Products/Food'))
    await page
      .getByRole('button', { name: /Edit Product/ })
      .first()
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const body = dialog.locator('.food-product-scroll')

    for (let i = 0; i < 6; i++)
      await dialog.getByRole('button', { name: /Add packaging/ }).click()
    const trash = dialog.getByRole('button', {
      name: 'Remove packaging item',
      exact: true,
    })
    await expect(trash).toHaveCount(6)
    await trash.first().focus()
    await expect(trash.first()).toBeFocused()
    await expect(page.getByRole('tooltip')).toContainText(
      'Remove packaging item',
    )
    await expect(trash.first()).toHaveCSS('width', '44px')
    const row = dialog.locator('.packaging-editor').first()
    const requiredBounds = await row.locator('.check-label').boundingBox()
    const actionBounds = await trash.first().boundingBox()
    expect(requiredBounds!.x + requiredBounds!.width).toBeLessThanOrEqual(
      actionBounds!.x,
    )
    await page.keyboard.press('Tab')
    expect(
      await dialog.evaluate((e) => e.contains(document.activeElement)),
    ).toBe(true)
    const lockedY = await page.evaluate(() => window.scrollY)
    await page.mouse.move(5, 5)
    await page.mouse.wheel(0, 300)
    expect(await page.evaluate(() => window.scrollY)).toBe(lockedY)
    await trash.first().click()
    await trash.nth(2).click()
    await trash.last().click()
    await expect(trash).toHaveCount(3)
    for (const name of [
      'Images & Labels',
      'Stock & Other Details',
      'Details & Pricing',
    ]) {
      await dialog.getByRole('tab', { name, exact: true }).click()
      await expect(
        dialog.getByRole('tab', { name, exact: true }),
      ).toHaveAttribute('data-state', 'active')
    }
    const assertBounds = async () => {
      await expect(dialog.getByRole('tab', { name: 'Details & Pricing', exact: true })).toBeInViewport()
      const bounds = await dialog.boundingBox()
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height + 1)
      expect(
        await dialog.evaluate((e) => e.scrollHeight <= e.clientHeight + 1),
      ).toBe(true)
      expect(
        await body.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      ).toBe(true)
      await expect(
        dialog.getByRole('button', { name: 'Cancel', exact: true }),
      ).toBeInViewport()
      await expect(
        dialog.getByRole('button', { name: 'Save Changes', exact: true }),
      ).toBeInViewport()
    }
    await assertBounds()
    await mkdir('docs/reviews/product-modal', { recursive: true })
    await trash.first().scrollIntoViewIfNeeded()
    await page.screenshot({
      path: `docs/reviews/product-modal/packaging-${width}.png`,
    })
    await body.evaluate((e) => {
      e.scrollTop = 0
    })
    await page.screenshot({
      path: `docs/reviews/product-modal/top-${width}.png`,
    })
    await body.evaluate((e) => {
      e.scrollTop = e.scrollHeight
    })
    await assertBounds()
    await page.screenshot({
      path: `docs/reviews/product-modal/bottom-${width}.png`,
    })
    expect(
      await page.locator('body').getAttribute('data-scroll-locked'),
    ).toBeTruthy()
    page.on('dialog', (d) => d.accept())
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('body')).not.toHaveAttribute('data-scroll-locked')
    expect(writes).toEqual([])
    await page.getByRole('button', { name: /Edit Product/ }).first().click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('body')).not.toHaveAttribute('data-scroll-locked')
  })
}
