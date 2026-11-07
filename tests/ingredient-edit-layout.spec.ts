import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

// The requested name is absent from the demo seed. Use a synthetic record,
// never a customer's ingredient or stock, in the real rendered editor.
for (const viewport of [
  { width: 1044, height: 1177 },
  { width: 390, height: 844 },
]) {
  test(`edit ingredient flows without reserved space at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const ingredient = workspace.ingredients.find((i) => i.id === 'sugar')!
    Object.assign(ingredient, {
      name: 'Spiced Orange Finishing Sugar',
      purchaseQuantity: 16,
      purchaseUnit: 'oz',
      packagePrice: 8.75,
      storageUnit: 'g',
      recipeUnit: 'g',
      storageLocation: 'Dry pantry',
      notes: 'Demonstration ingredient for layout review.',
      statement: 'Spiced orange finishing sugar',
      subingredients: 'Sugar, orange peel, cinnamon.',
      sourceContains: '',
      sourceMayContain: '',
      conversions: [],
    })
    const writes: { action: string; data: Record<string, unknown> }[] = []
    await page.route('**/api/workspace*', (route) => {
      if (route.request().method() === 'POST')
        writes.push(route.request().postDataJSON())
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page
      .getByRole('textbox', { name: 'Search pantry' })
      .fill(ingredient.name)
    await page
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    const modal = page.getByRole('dialog')
    await modal
      .getByRole('button', { name: 'Edit Ingredient', exact: true })
      .click()
    await expect(modal.getByLabel('Name', { exact: true })).toHaveValue(
      ingredient.name,
    )
    const body = modal.locator('.ingredient-detail-body')
    const purchase = modal.locator('section').filter({
      has: page.getByRole('heading', {
        name: 'Purchase & costing',
        exact: true,
      }),
    })
    const label = modal
      .locator('summary')
      .filter({ hasText: /^Label information & notes$/ })
    const conversions = modal
      .locator('summary')
      .filter({ hasText: /^Ingredient-specific conversions$/ })
    const phase = process.env.CAPTURE_PHASE || 'after'
    const capture = async (state: string) => {
      await page.screenshot({
        path: `docs/previews/ingredient-edit-${phase}-${state}-${viewport.width}.png`,
        animations: 'disabled',
      })
    }
    await purchase.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await capture('groups')
    const metrics = {
      viewport,
      phase,
      collapsed: { height: 0, scroll: 0 },
      expanded: { height: 0, scroll: 0 },
    }
    metrics.collapsed = await body.evaluate((el) => ({
      height: el.clientHeight,
      scroll: el.scrollHeight,
    }))
    await label.click()
    await label.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await capture('labels')
    await expect(
      modal.getByRole('textbox', { name: 'Subingredients text', exact: true }),
    ).toHaveValue(ingredient.subingredients)
    await label.click()
    await conversions.click()
    // Before this revision the conversion editor has an extra nested disclosure.
    const nested = modal
      .locator('details.calculation-box > summary')
      .filter({ hasText: 'conversion' })
    if (phase === 'before' && (await nested.count())) await nested.click()
    await conversions.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await capture('conversions')
    metrics.expanded = await body.evaluate((el) => ({
      height: el.clientHeight,
      scroll: el.scrollHeight,
    }))
    await test.info().attach('layout measurements', {
      body: JSON.stringify(metrics, null, 2),
      contentType: 'application/json',
    })
    if (phase === 'before') return
    expect(
      await modal.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    await expect(
      modal.getByRole('button', { name: 'Save changes', exact: true }),
    ).toBeVisible()
    expect(
      await modal.evaluate((el) =>
        Array.from(el.querySelectorAll('*'))
          .filter((node) => {
            const css = getComputedStyle(node)
            return (
              node.clientHeight > 0 &&
              node.scrollHeight > node.clientHeight + 1 &&
              /auto|scroll/.test(css.overflowY)
            )
          })
          .map((node) => node.className),
      ),
    ).toEqual(['ingredient-detail-body'])
    if (viewport.width > 760) {
      const geometry = await modal.evaluate((el) => {
        const left = el
          .querySelector('.ingredient-edit-primary')!
          .getBoundingClientRect()
        const right = el
          .querySelector('.ingredient-edit-secondary')!
          .getBoundingClientRect()
        const groups = Array.from(
          el.querySelector('.ingredient-edit-secondary')!.children,
        ).map((node) => node.getBoundingClientRect())
        return {
          left: left.x,
          right: right.x,
          gaps: groups.slice(1).map((r, i) => r.top - groups[i].bottom),
        }
      })
      expect(geometry.right).toBeGreaterThan(geometry.left)
      expect(geometry.gaps.every((gap) => gap <= 20)).toBe(true)
    }
    await conversions.click()
    await modal.getByLabel('Package price', { exact: true }).fill('8.751234')
    await label.click()
    await modal
      .getByRole('textbox', { name: 'Notes', exact: true })
      .fill('Reviewed layout; shared draft retained.')
    await expect(
      modal.getByLabel('Package price', { exact: true }),
    ).toHaveValue('8.751234')
    await modal
      .getByRole('button', { name: 'Save changes', exact: true })
      .click()
    await expect.poll(() => writes.length).toBe(1)
    expect(writes[0].action).toBe('ingredientUpdate')
    expect(writes[0].data.packagePrice).toBe('8.751234')
    expect(writes[0].data.notes).toBe('Reviewed layout; shared draft retained.')
  })
}
