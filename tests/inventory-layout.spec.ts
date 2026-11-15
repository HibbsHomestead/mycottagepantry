import { demoData } from '../src/lib/demo'
import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`inventory layout ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    await page.route('**/api/workspace*', (r) =>
      r.fulfill({ json: { workspace: demoData(), role: 'Owner', demo: true } }),
    )
    await page.goto(workspaceFixtureUrl('Inventory/Overview'))
    const main = page.locator('main.inventory-layout-page')
    const summary = main.locator('.pantry-summary')
    await expect(summary).toBeVisible()
    const nav = main.getByRole('navigation', { name: 'Inventory sections' })
    const boxes = await Promise.all([
      summary.boundingBox(),
      nav.boundingBox(),
      main.locator('.section-workspace').boundingBox(),
    ])
    expect(boxes[1]!.y).toBeGreaterThanOrEqual(boxes[0]!.y + boxes[0]!.height)
    expect(boxes[0]!.x).toBeCloseTo(boxes[2]!.x, 0)
    expect(boxes[0]!.width).toBeCloseTo(boxes[2]!.width, 0)
    const actions = main.locator('.inventory-primary-actions')
    for (const name of ['Add item', 'Receive stock']) {
      const button = actions.getByRole('button', { name, exact: true })
      await expect(button).toHaveCount(1)
      await button.focus()
      await expect(
        page.getByRole('tooltip', { name, exact: true }),
      ).toContainText(name)
      await page.keyboard.press('Escape')
      await button.click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
    }
    if (width >= 1000) {
      const category = await main
        .getByRole('combobox', { name: 'Filter by category' })
        .boundingBox()
      const sorting = await main
        .getByRole('combobox', { name: 'Sort by', exact: true })
        .boundingBox()
      expect(category!.y).toBeCloseTo(sorting!.y, 0)
    }
    for (const status of [
      'Low stock',
      'Needs review',
      'Expiring soon',
      'All items',
    ]) {
      const button = main
        .locator('.inventory-tabs')
        .getByRole('button', { name: new RegExp('^' + status) })
      await button.click()
      await expect(button).toHaveAttribute('aria-pressed', 'true')
    }
    await main
      .getByRole('textbox', { name: 'Search pantry' })
      .fill('Bread flour')
    await expect(main.locator('.pantry-card-grid')).toContainText('Bread flour')
    await main.getByRole('textbox', { name: 'Search pantry' }).fill('')
    await main.getByRole('button', { name: 'Category actions' }).click()
    await expect(
      page.getByRole('menuitem', { name: 'Add category', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('menuitem', { name: 'Manage categories', exact: true }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await main
      .getByRole('combobox', { name: 'Filter by category' })
      .selectOption('uncategorized')
    await main
      .getByRole('combobox', { name: 'Sort by', exact: true })
      .selectOption('quantity')
    await main.getByRole('button', { name: 'Reverse sort direction' }).click()
    await expect(
      main.getByRole('combobox', { name: 'Filter by category' }),
    ).toHaveValue('uncategorized')
    await expect(
      main.getByRole('combobox', { name: 'Sort by', exact: true }),
    ).toHaveValue('quantity')
    await main
      .getByRole('combobox', { name: 'Filter by category' })
      .selectOption('all')
    for (const tab of [
      'Overview',
      'Ingredients',
      'Craft Materials',
      'Packaging',
      'Supplies',
      'Finished Goods',
      'Movements',
      'Counts',
      'Overview',
    ]) {
      if (width < 1000)
        await nav.getByRole('button', { name: /^Inventory ·/ }).click()
      await nav.getByRole('link', { name: tab, exact: true }).click()
      await expect(
        nav.getByRole('link', { name: tab, exact: true, includeHidden: true }),
      ).toHaveAttribute('aria-current', 'page')
    }
    await main.getByRole('button', { name: 'All items', exact: true }).click()
    await expect(
      main.getByRole('textbox', { name: 'Search pantry' }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    mkdirSync('docs/reviews/inventory-layout', { recursive: true })
    await page.screenshot({
      path: `docs/reviews/inventory-layout/inventory-${width}.png`,
      fullPage: false,
    })
    await main.getByRole('button', { name: 'Table', exact: true }).click()
    await expect(main.locator('.pantry-table')).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/inventory-layout/table-${width}.png`,
      fullPage: false,
    })
  })
}
