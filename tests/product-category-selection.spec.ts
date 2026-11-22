import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

test.use({ hasTouch: true })

for (const width of [1440, 390]) {
  test(`category selection saves and reopens in the real product modal ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = demoData(),
      product = workspace.products[0]
    const categories = [
      {
        id: 'muffins',
        name: 'Muffins',
        classification: 'food',
        scope: 'food-products',
      },
      { id: 'legacy', name: 'Legacy breads', classification: 'food' },
    ]
    let writes = 0
    await page.route('**/api/workspace*', (route) => {
      if (route.request().url().includes('Categories'))
        return route.fulfill({
          json: {
            categories,
            products: workspace.products,
            recipes: [],
            revision: 1,
            mappings: {},
            rates: [],
          },
        })
      if (route.request().method() === 'POST') {
        const { action, table, data } = route.request().postDataJSON()
        if (action === 'save' && table === 'products') {
          Object.assign(product, data)
          writes++
        }
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Products/Food'))
    const edit = () =>
      page
        .getByRole('button', { name: `Edit ${product.name}`, exact: true })
        .first()
        .click()
    await edit()
    let combo = page.getByRole('combobox', {
      name: 'Product category',
      exact: true,
    })
    await combo.click()
    await page
      .getByRole('option', { name: 'Muffins · Food', exact: true })
      .tap()
    await expect(combo).toHaveValue('Muffins · Food')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await page
      .getByRole('button', { name: 'Save Changes', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(product.productCategoryId).toBe('muffins')
    expect(writes).toBe(1)
    await edit()
    combo = page.getByRole('combobox', {
      name: 'Product category',
      exact: true,
    })
    await expect(combo).toHaveValue('Muffins · Food')
    await combo.fill('Legacy')
    await combo.press('ArrowDown')
    await combo.press('ArrowUp')
    await combo.press('Enter')
    await expect(combo).toHaveValue('Legacy breads · Food')
    await combo.click()
    await page
      .getByRole('option', { name: 'Not assigned', exact: true })
      .click()
    await expect(combo).toHaveValue('Not assigned')
    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(writes).toBe(1)
    expect(product.productCategoryId).toBe('muffins')
  })
}
