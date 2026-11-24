import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
for (const width of [1440, 820, 390])
  test(`shared product copy actions ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const w = demoData()
    w.products = ['food', 'handmade', 'resale', 'kit'].map((workflow) => ({
      id: `fixture-${workflow}`,
      name: `Disposable ${workflow} with a long product name`,
      workflow,
      price: 18,
      quantity: 12,
      cost: 2,
      unitsPerPackage: 1,
      recipeId: workflow === 'food' ? w.recipes[0].id : '',
      bom:
        workflow === 'handmade'
          ? {
              id: 'owned-bom',
              name: 'Design',
              output: 1,
              lines: [],
              laborMinutes: 0,
              laborRate: 0,
              overhead: 0,
              scrapPercent: 0,
            }
          : undefined,
      kitComponents: [],
      packagingLines: [],
      status: 'active',
      taxStatus: 'exempt',
    }))
    let writes = 0
    await page.route('**/api/workspace*', (route) => {
      if (route.request().method() === 'POST') {
        writes++
        const body = route.request().postDataJSON()
        if (body.action === 'save' && body.table === 'products') {
          const index = w.products.findIndex(p => p.id === body.data.id)
          if (index < 0) w.products.push(body.data)
          else w.products[index] = body.data
        }
      }
      return route.fulfill({
        json: { workspace: w, role: 'Owner', demo: false },
      })
    })
    await page.goto(workspaceFixtureUrl('Products'))
    for (const product of w.products) {
      const card = page.getByRole('article', {
        name: product.name,
        exact: true,
      })
      await expect(card).toBeVisible()
      const actions = card.locator('.item-record-actions')
      await expect(actions.getByRole('button')).toHaveCount(4)
      const names = await actions
        .getByRole('button')
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute('aria-label')),
        )
      await expect(actions.getByRole('button', {name:`Delete ${product.name}`,exact:true})).toHaveCSS('background-color', 'rgb(255, 248, 247)')
      expect(names).toEqual([
        `View details for ${product.name}`,
        `Edit ${product.name}`,
        `Copy ${product.name}`,
        `Delete ${product.name}`,
      ])
      await card
        .getByRole('button', { name: `Copy ${product.name}`, exact: true })
        .click()
      const dialog = page.getByRole('dialog')
      await expect(
        dialog.getByRole('textbox', {
          name: product.workflow === 'kit' ? 'Basket name' : 'Product name',
          exact: true,
        }),
      ).toHaveValue(`${product.name} — Copy`)
      await expect(
        dialog.getByRole('button', {
          name: `Delete ${product.name} — Copy`,
          exact: true,
        }),
      ).toHaveCount(0)
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      expect(writes).toBe(0)
    }
    await mkdir('docs/reviews/recipe-actions', { recursive: true })
    await page.screenshot({
      path: `docs/reviews/recipe-actions/product-actions-${width}.png`,
      fullPage: true,
    })
    const first = w.products[0]
    await page
      .getByRole('button', {
        name: `View details for ${first.name}`,
        exact: true,
      })
      .click()
    await expect(
      page
        .getByRole('dialog')
        .getByRole('button', { name: `Copy ${first.name}`, exact: true }),
    ).toBeVisible()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: `Copy ${first.name}`, exact: true })
      .click()
    await expect(
      page
        .getByRole('dialog')
        .getByRole('textbox', { name: 'Product name', exact: true }),
    ).toHaveValue(`${first.name} — Copy`)
    await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click()
    await page.getByRole('button',{name:'Table',exact:true}).click()
    for (const product of w.products) {
      await expect(page.locator('td .item-record-actions').getByRole('button',{name:`Copy ${product.name}`,exact:true})).toBeVisible()
    }
    await page.screenshot({path:`docs/reviews/recipe-actions/product-table-${width}.png`,fullPage:true})
    await page.locator('td .item-record-actions').getByRole('button',{name:`Copy ${first.name}`,exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Create Product',exact:true}).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(w.products).toHaveLength(5)
    const copy = w.products.find(p => p.name === `${first.name} — Copy`)!
    expect(copy.id).not.toBe(first.id)
    expect(copy.quantity).toBe(0)
    expect(copy).not.toHaveProperty('stockCostKnown')
    await page.getByRole('button',{name:`Edit ${copy.name}`,exact:true}).click()
    await page.getByRole('dialog').getByRole('textbox',{name:'Product name',exact:true}).fill('Independent edited copy')
    await page.getByRole('dialog').getByRole('button',{name:'Save Changes',exact:true}).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(w.products.find(p => p.id === first.id)?.name).toBe(first.name)
    expect(w.products.find(p => p.id === copy.id)?.name).toBe('Independent edited copy')


  })
