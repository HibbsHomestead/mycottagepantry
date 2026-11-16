import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { demoData } from '../src/lib/demo'
import { accentThemes } from '../src/lib/appearance'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
const directory = 'docs/reviews/theme-tax'
test('palette and product summary review', async ({ page }) => {
  test.setTimeout(180000)
  mkdirSync(directory, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await installWorkspaceFixture(page)
  const w = demoData()
  w.ingredients.push({ id: 'review-fabric', name: 'Review fabric', usedAs: 'material', unit: 'yd', quantity: 10, cost: 5 })
  const product = {
    id: 'review-tote',
    name: 'Handmade market tote',
    workflow: 'handmade',
    price: 35,
    priceTaxMode: 'before',
    taxSource: 'category',
    productCategoryId: 'craft',
    quantity: 4,
    bom: {
      id: 'review-bom',
      version: 1,
      output: 1,
      scrapPercent: 0,
      laborMinutes: 20,
      laborRate: 15,
      overhead: 2,
      lines: [{ ingredientId: 'review-fabric', quantity: 1, unit: 'yd' }],
    },
  }
  w.products.push(product)
  w.settings[0].productCategories = [
    { id: 'craft', name: 'Handmade', classification: 'non_food' },
  ]
  w.settings[0].categoryTaxMappings = { non_food: ['review-tax'] }
  w.settings[0].taxRates = [
    {
      id: 'review-tax',
      name: 'Synthetic review tax',
      jurisdiction: 'Fixture only',
      ratePercent: 5,
      behavior: 'exclusive',
      active: true,
    },
  ]
  await page.route('**/api/workspace*', (r) => {
    expect(r.request().method()).toBe('GET')
    return r.fulfill({ json: { workspace: w, role: 'Owner', demo: true } })
  })
  for (const theme of accentThemes) {
    for (const mode of ['light', 'dark'] as const) {
      w.settings[0].appearance = { theme: theme.id, mode }
      await page.goto('about:blank')
      await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
      await expect(page.locator('main.app-page')).toBeVisible()
      await expect(page.locator('.pantry-card').first()).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-mode', mode)
      const contrast = await page.evaluate(() => {
        const luminance = (color: string) => {
          const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
          return values[0] * .2126 + values[1] * .7152 + values[2] * .0722
        }
        return ['.internal-section-links > [aria-current="page"]', '.assistant-launcher'].map(selector => {
          const style = getComputedStyle(document.querySelector(selector)!)
          const a = luminance(style.color), b = luminance(style.backgroundColor)
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
        })
      })
      expect(Math.min(...contrast)).toBeGreaterThanOrEqual(4.5)
      await page.screenshot({
        path: `${directory}/inventory-${theme.id}-${mode}.png`,
      })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
  }
  w.settings[0].appearance = { theme: 'cottage', mode: 'light' }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const [name, section] of Object.entries({
      inventory: 'Inventory/Ingredients',
      finance: 'Finance/Register',
      purchasing: 'Purchasing/Purchases & Receipts',
      settings: 'Settings/Business Profile',
    })) {
      await page.goto(workspaceFixtureUrl(section))
      await expect(page.locator('main.app-page')).toBeVisible()
      await page.screenshot({
        path: `${directory}/${name}-${width}.png`,
        fullPage: true,
      })
    }
    for (const missing of [false, true]) {
      w.settings[0].categoryTaxMappings = {
        non_food: missing ? [] : ['review-tax'],
      }
      await page.goto('about:blank')
      await page.goto(
        workspaceFixtureUrl('Products/Handmade'),
      )
      await page
        .getByRole('button', { name: product.name, exact: true })
        .click()
      const dialog = page.getByRole('dialog')
      await expect(
        dialog.getByText('Cost to make', { exact: true }),
      ).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: 'Create mockup' }),
      ).toBeVisible()
      if (missing) {
        await expect(
          dialog.getByText('Tax setup needs attention'),
        ).toBeVisible()
        await expect(
          dialog.getByText('Gross profit', { exact: true }),
        ).toHaveCount(0)
      }
      await page.screenshot({
        path: `${directory}/product-${missing ? 'missing-tax' : 'valid-tax'}-${width}.png`,
        fullPage: true,
      })
      await dialog.screenshot({ path: `${directory}/dialog-${missing ? 'missing-tax' : 'valid-tax'}-${width}.png` })
      if (missing) {
        await dialog.getByRole('button', { name: 'Create mockup' }).click()
        await expect(
          page.getByText(
            'Mockup preview. Actual placement, size, and colors may vary.',
          ),
        ).toBeVisible()
      }
    }
    await page.goto('about:blank')
    await page.goto(workspaceFixtureUrl('Handmade/Products & Bills of Materials'))
    await page.getByRole('button', { name: product.name, exact: true }).click()
    const handmade = page.getByRole('dialog')
    await expect(handmade.getByText('Tax setup needs attention')).toBeVisible()
    await expect(handmade.getByText('Cost per finished unit', { exact: true })).toBeVisible()
    await expect(handmade.getByRole('button', { name: 'Create mockup' })).toBeVisible()
    await handmade.screenshot({ path: `${directory}/handmade-missing-tax-${width}.png` })
  }
})
test('public theme review', async ({ page }) => {
  test.setTimeout(120000)
  mkdirSync(directory, { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const [name, route] of Object.entries({
      home: '/',
      pricing: '/pricing',
      login: '/login',
      signup: '/signup',
      admin: '/admin',
    })) {
      await page.goto(route)
      await expect(page.locator('body')).toBeVisible()
      await page.screenshot({
        path: `${directory}/${name}-${width}.png`,
        fullPage: true,
      })
    }
  }
})
