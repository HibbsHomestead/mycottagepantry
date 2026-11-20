import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const [width, height] of [
  [1440, 900],
  [1280, 640],
  [820, 900],
  [390, 844],
]) {
  test(`ingredient detail tabs and calculation help ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const ingredient = workspace.ingredients.find((i) => i.id === 'yeast')!
    ingredient.name =
      'Yeast with a deliberately long ingredient name for layout verification'
    if (width === 820) {
      ingredient.unit = 'each'
      ingredient.storageUnit = 'each'
      ingredient.recipeUnit = 'each'
      ingredient.conversions = []
    }
    ingredient.notes = 'Recorded internal notes. '.repeat(100)
    let writes = 0
    await page.route('**/api/workspace*', (route) => {
      if (route.request().method() === 'POST') writes++
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page.getByRole('textbox', { name: 'Search pantry' }).fill('Yeast')
    await page
      .getByRole('button', { name: /^View details for Yeast/ })
      .click()
    const detail = page.locator('.ingredient-detail-view')
    const tabs = detail.getByRole('tab')
    await expect(tabs).toHaveText([
      'Inventory',
      'Purchasing',
      'Ingredients & Allergens',
      'Identification & Notes',
    ])
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
    for (let index = 0; index < 4; index++) {
      await tabs.nth(index).click()
      await expect(detail.getByRole('tabpanel')).toBeVisible()
    }
    const body = detail.locator('.ingredient-detail-body')
    await detail.getByRole('button', { name: 'How this is calculated', exact: true }).scrollIntoViewIfNeeded()
    const scroll = await body.evaluate((el) => el.scrollTop)
    await detail
      .getByRole('button', { name: 'How this is calculated', exact: true })
      .click()
    const help = page
      .getByRole('dialog')
      .filter({
        has: page.getByRole('heading', {
          name: 'How this is calculated',
          exact: true,
        }),
      })
    await expect(help).toContainText(
      'Current unit costs use the saved inventory cost reference',
    )
    await expect(help).toContainText('USD')
    await expect(help).toContainText(width === 820 ? 'Cost per each' : 'Cost per oz')
    await page.screenshot({ path: `docs/reviews/ingredient-detail-tabs/help-${width}.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(help).toHaveCount(0)
    await expect(detail).toBeVisible()
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true')
    await expect(
      detail.getByRole('button', {
        name: 'How this is calculated',
        exact: true,
      }),
    ).toBeFocused()
    expect(await body.evaluate((el) => el.scrollTop)).toBe(scroll)
    const geometry = await detail.evaluate((el) => ({
      scrolls: [el, ...el.querySelectorAll('*')]
        .filter(
          (child) =>
            ['auto', 'scroll'].includes(getComputedStyle(child).overflowY) &&
            child.scrollHeight > child.clientHeight + 1,
        )
        .map((child) => child.className),
      overflow: document.documentElement.scrollWidth - innerWidth,
      tabOverflow:
        el.querySelector('[role=tablist]')!.scrollWidth -
        el.querySelector('[role=tablist]')!.clientWidth,
      bottom: el.getBoundingClientRect().bottom,
      locked: document.body.hasAttribute('data-scroll-locked'),
    }))
    console.log(width, geometry)
    expect(geometry.scrolls).toEqual(['ingredient-detail-body'])
    expect(geometry.overflow).toBeLessThanOrEqual(1)
    expect(geometry.tabOverflow).toBeLessThanOrEqual(1)
    expect(geometry.bottom).toBeLessThanOrEqual(height)
    expect(geometry.locked).toBe(true)
    await tabs.last().scrollIntoViewIfNeeded()
    await page.screenshot({
      path: `docs/reviews/ingredient-detail-tabs/details-${width}.png`,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page
      .getByRole('button', { name: /^View details for Yeast/ })
      .click()
    await expect(
      page.getByRole('tab', { name: 'Inventory', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: 'Inventory', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'Purchasing', exact: true })).toHaveAttribute('aria-selected', 'true')
    expect(writes).toBe(0)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
}
