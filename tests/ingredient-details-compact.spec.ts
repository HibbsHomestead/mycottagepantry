import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

for (const width of [1440, 1024, 390]) {
  test(`Ingredient Details compact columns and one scroller at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const ingredient = workspace.ingredients.find((i) => i.id === 'yeast')!
    delete ingredient.purchaseQuantity
    delete ingredient.packageQuantity
    delete ingredient.purchaseUnit
    delete ingredient.packagePrice
    const original = structuredClone(ingredient)
    workspace.recipes = [
      {
        ...workspace.recipes[0],
        id: 'linked-recipe',
        name: 'Linked bread recipe',
        lines: [{ ingredientId: ingredient.id, quantity: 2, unit: 'g' }],
      },
    ]
    let writes = 0
    await page.route('**/api/workspace*', (route) => {
      if (route.request().method() === 'POST') writes++
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page.getByRole('textbox', { name: 'Search pantry' }).fill('yeast')
    await page
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    const modal = page.getByRole('dialog')
    await expect(modal.locator('.cost-card')).toHaveCount(6)
    await modal.evaluate((el) =>
      Promise.all(
        el
          .getAnimations({ subtree: true })
          .map((a) => a.finished.catch(() => {})),
      ),
    )
    const phase = process.env.CAPTURE_PHASE || 'after'
    await page.screenshot({
      path: `docs/reviews/divider-and-details/ingredient-${phase}-${width}.png`,
      animations: 'disabled',
    })
    if (phase === 'before') return
    const media = modal.locator('.ingredient-detail-media')
    const notice = media.locator('.ingredient-purchase-notice')
    await expect(
      notice.getByRole('button', { name: 'Add purchase details', exact: true }),
    ).toHaveCount(1)
    await expect(
      modal.getByText('Purchase package details not set.', { exact: true }),
    ).toHaveCount(1)
    const geometry = await modal.evaluate((el) => {
      const rect = (selector: string) =>
        el.querySelector(selector)!.getBoundingClientRect()
      const photo = rect('.product-detail-photo'),
        usage = rect('[aria-label="Recipe usage"]'),
        notice = rect('.ingredient-purchase-notice')
      return {
        photoBottom: photo.bottom,
        usageTop: usage.top,
        usageBottom: usage.bottom,
        noticeTop: notice.top,
        scrolls: [...el.querySelectorAll('*')].filter(
          (child) =>
            ['auto', 'scroll'].includes(getComputedStyle(child).overflowY) &&
            child.scrollHeight > child.clientHeight + 1,
        ).length,
        overflow: el.scrollWidth - el.clientWidth,
      }
    })
    expect(geometry.usageTop - geometry.photoBottom).toBeCloseTo(16, 1)
    expect(geometry.noticeTop).toBeGreaterThanOrEqual(geometry.usageBottom)
    expect(geometry.scrolls).toBeLessThanOrEqual(1)
    if (width === 1440) expect(geometry.scrolls).toBe(0)
    expect(geometry.overflow).toBeLessThanOrEqual(1)
    const calculation = modal.locator('#ingredient-conversions')
    await expect(calculation).not.toHaveAttribute('open', '')
    await calculation.locator('summary').click()
    await expect(calculation).toContainText(
      'Package price ÷ package amount = package unit cost.',
    )
    await expect(
      modal.getByText('Purchase package details not set.', { exact: true }),
    ).toHaveCount(1)
    await expect(
      modal.getByRole('button', { name: 'Add purchase details', exact: true }),
    ).toHaveCount(1)
    await notice
      .getByRole('button', { name: 'Add purchase details', exact: true })
      .click()
    await expect(
      modal.getByRole('button', { name: 'Save changes', exact: true }),
    ).toBeVisible()
    expect(writes).toBe(0)
    expect(ingredient).toEqual(original)
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Linked bread recipe', exact: true })
      .click()
    await expect(
      page
        .getByRole('dialog')
        .getByRole('heading', { name: 'Linked bread recipe', exact: true }),
    ).toBeVisible()
    expect(writes).toBe(0)
  })
}
