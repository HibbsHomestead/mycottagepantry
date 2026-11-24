import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

test.use({ hasTouch: true })

for (const width of [390, 1440]) {
  for (const kind of ['Recipes', 'Products'] as const) {
    test(`${kind} card/table toolbar at ${width}px`, async ({ page }) => {
      page.on('dialog', (dialog) => dialog.accept())
      await page.setViewportSize({ width, height: 1000 })
      await installWorkspaceFixture(page)
      const workspace = demoData()
      workspace.settings[0].productCategories = [
        {
          id: 'demo-food',
          name: 'Demo food category',
          scope: 'food-products',
          classification: 'food',
          active: true,
        },
        {
          id: 'demo-craft',
          name: 'Demo craft category',
          scope: 'handmade-products',
          classification: 'non_food',
          active: true,
        },
      ]
      workspace.products[0].productCategoryId = 'demo-food'
      workspace.products[1].productCategoryId = 'demo-craft'

      await page.route('**/api/workspace*', async (route) => {
        if (route.request().url().includes('Categories')) {
          return route.fulfill({
            json: {
              categories:
                kind === 'Products'
                  ? workspace.settings[0].productCategories || []
                  : workspace.settings[0].recipeCategories || [],
              products: workspace.products,
              recipes: workspace.recipes,
              revision: 1,
              mappings: {},
              rates: [],
            },
          })
        }
        if (route.request().method() === 'POST') {
          const body = route.request().postDataJSON()
          if (body.action === 'pantryView')
            workspace.settings[0][
              body.data.page === 'recipes'
                ? 'currentRecipesView'
                : 'currentProductsView'
            ] = body.data.view
        }
        return route.fulfill({
          json: { workspace, role: 'Owner', demo: false },
        })
      })
      await page.goto(
        workspaceFixtureUrl(
          kind === 'Recipes'
            ? 'Production/Recipes & Designs'
            : 'Products/All Products',
        ),
      )
      const toggle = page.getByRole('group', { name: `${kind} display` })
      await expect(toggle).toBeVisible()
      const search = page.getByRole('textbox', {
        name: `Search ${kind.toLowerCase()}`,
      })
      const cards =
        kind === 'Recipes'
          ? page.locator('.recipe-card')
          : page.locator('.product-card-photo-first')
      await expect(cards.first()).toBeVisible()
      const cardNames = await cards
        .locator(kind === 'Recipes' ? 'h2' : '.pantry-card-title')
        .allTextContents()
      const count = await cards.count()
      expect(count).toBeGreaterThan(0)
      await mkdir('docs/reviews/catalog-views', { recursive: true })
      await page.screenshot({
        path: `docs/reviews/catalog-views/${kind.toLowerCase()}-cards-${width}.png`,
        fullPage: true,
      })
      await toggle.getByRole('button', { name: 'Table', exact: true }).click()
      await expect(
        toggle.getByRole('button', { name: 'Table', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true')
      const region = page.getByRole('region', { name: `${kind} table` })

      await expect(region.locator('tbody tr')).toHaveCount(count)
      expect(
        await region
          .locator('tbody tr td:nth-child(2) button')
          .allTextContents(),
      ).toEqual(cardNames)
      expect(
        await region
          .locator('table')
          .evaluate((node) => getComputedStyle(node).display),
      ).toBe('table')
      if (width === 390)
        expect(
          await region.evaluate((node) => node.scrollWidth > node.clientWidth),
        ).toBe(true)
      await page.screenshot({
        path: `docs/reviews/catalog-views/${kind.toLowerCase()}-table-${width}.png`,
        fullPage: true,
      })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      await page.reload()
      await expect(
        toggle.getByRole('button', { name: 'Table', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true')
      const name =
        kind === 'Recipes'
          ? workspace.recipes.find((r) => r.workflow !== 'handmade')!.name
          : workspace.products[0].name
      await search.fill(name)
      const filteredCount = await region.locator('tbody tr').count()
      await toggle.getByRole('button', { name: 'Cards', exact: true }).click()
      await expect(search).toHaveValue(name)
      await expect(cards).toHaveCount(filteredCount)
      await search.fill('')
      const category = page.getByRole('combobox', {
        name:
          kind === 'Recipes'
            ? 'Filter by recipe category'
            : 'Filter by category',
        exact: true,
      })
      if (kind === 'Products') {
        await expect(category.locator('option[value="demo-craft"]')).toHaveText(
          'Demo craft category',
        )
        await category.selectOption('demo-craft')
        await expect(cards).toHaveCount(1)
        await toggle.getByRole('button', { name: 'Table', exact: true }).click()
        await expect(region.locator('tbody tr')).toHaveCount(1)
        await expect(region).toContainText(workspace.products[1].name)
        await toggle.getByRole('button', { name: 'Cards', exact: true }).click()
      }
      await category.selectOption('uncategorized')
      const uncategorized = await cards.count()
      await toggle.getByRole('button', { name: 'Table', exact: true }).click()
      await expect(category).toHaveValue('uncategorized')
      if (uncategorized)
        await expect(region.locator('tbody tr')).toHaveCount(uncategorized)
      else
        await expect(region).toContainText(
          `No ${kind.toLowerCase()} match this view.`,
        )
      await category.selectOption('all')
      await region.locator('tbody .text-button').first().click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      const categoryActions = page
        .locator('.catalog-toolbar')
        .getByRole('button', { name: 'Category actions' })
      await categoryActions.click()
      await expect(
        page.getByRole('menuitem', { name: 'Add category', exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole('menuitem', { name: 'Manage categories', exact: true }),
      ).toBeVisible()
      await page
        .getByRole('menuitem', { name: 'Manage categories', exact: true })
        .click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await categoryActions.click()
      await page
        .getByRole('menuitem', { name: 'Add category', exact: true })
        .click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      const exportAction = page.getByRole('button', {
        name: kind === 'Recipes' ? 'Export recipes' : 'Export products',
        exact: true,
      })
      await exportAction.focus()
      await expect(
        page.getByRole('tooltip', {
          name: `Export ${kind.toLowerCase()}`,
          exact: true,
        }),
      ).toContainText(`Export ${kind.toLowerCase()}`)
      const download = page.waitForEvent('download')
      await exportAction.click()
      expect((await download).suggestedFilename()).toContain('.csv')
      if (kind === 'Products') {
        for (const choice of [
          'Create basket',
          'Create food product',
          'Create handmade product',
          'Create resale product',
        ]) {
          const create = page
            .locator('.catalog-toolbar')
            .getByRole('button', { name: 'Create product', exact: true })
          if (width === 390) await create.tap()
          else {
            await create.focus()
            await page.keyboard.press('Enter')
          }
          await expect(
            page.getByRole('menuitem', { name: choice, exact: true }),
          ).toBeVisible()
          await page
            .getByRole('menuitem', { name: choice, exact: true })
            .click()
          await expect(page.getByRole('dialog')).toBeVisible()
          await page.keyboard.press('Escape')
        }
      } else {
        for (const action of ['Create recipe', 'Import recipe']) {
          await page
            .locator('.catalog-toolbar')
            .getByRole('button', { name: action, exact: true })
            .click()
          await expect(page.getByRole('dialog')).toBeVisible()
          await page.getByRole('dialog').getByRole('button', { name: /^(Cancel|Close)$/ }).last().click()
          await expect(page.getByRole('dialog')).toHaveCount(0)
        }
      }
      await search.fill('')
      await toggle.getByRole('button', { name: 'Table', exact: true }).click()
      const lastName = region.locator('tbody tr td:nth-child(2) button').last()
      await lastName.scrollIntoViewIfNeeded()
      await lastName.click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      if (width === 1440) {
        workspace.settings[0].appearance = { theme: 'orchard', mode: 'dark' }
        await page.reload()
        await expect(page.locator('html')).toHaveClass(/dark/)
        await page.screenshot({
          path: `docs/reviews/catalog-views/${kind.toLowerCase()}-table-dark-${width}.png`,
          fullPage: true,
        })
        await toggle.getByRole('button', { name: 'Cards', exact: true }).click()
        await page.screenshot({
          path: `docs/reviews/catalog-views/${kind.toLowerCase()}-cards-dark-${width}.png`,
          fullPage: true,
        })
      }
    })
  }
}
