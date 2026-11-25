import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { handleProduction } from '../netlify/lib/production-handler'
import type { Item } from '../src/lib/domain'
import { breadBaseFixture } from '../src/test/fixtures/bread-base'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

const directory = 'docs/reviews/basket-production-journey'

for (const phone of [false, true]) {
  test.describe(phone ? 'phone' : 'desktop', () => {
    test.use({
      viewport: { width: phone ? 390 : 1440, height: 1000 },
      hasTouch: phone,
    })
    test('plans, makes, packs and posts a linked market basket', async ({
      page,
    }) => {
      page.setDefaultTimeout(12_000)
      await installWorkspaceFixture(page)
      const today = '2026-11-24'
      let workspace = breadBaseFixture()
      const loaf = Object.assign(workspace.products[0], { quantity: 0 })
      const tea = {
        id: 'fixture-tea',
        name: 'Apple tea tins',
        workflow: 'resale',
        quantity: 3,
        cost: 3,
        stockCostKnown: true,
      }
      const basket = {
        id: 'fixture-basket',
        name: 'Orchard Breakfast Basket',
        workflow: 'kit',
        quantity: 0,
        cost: 0,
        kitComponents: [
          { productId: loaf.id, quantity: 1, basis: 'package' },
          { productId: tea.id, quantity: 1, basis: 'package' },
        ],
        packagingLines: [
          { ingredientId: 'fixture-carton', unit: 'each', quantity: 1 },
        ],
      }
      workspace.products.push(tea, basket)
      workspace.ingredients.push({
        id: 'fixture-carton',
        name: 'Kraft basket carton',
        unit: 'each',
        usedAs: 'packaging',
        quantity: 10,
        cost: 1,
        currentCost: 1,
      })
      workspace.events = [
        {
          id: 'fixture-market',
          name: 'Orchard Saturday Market',
          status: 'Scheduled',
        },
      ]
      let failed = false
      await page.route('**/api/workspace*', async (route) => {
        if (route.request().method() === 'POST') {
          const { action, table, data } = route.request().postDataJSON()
          const next = structuredClone(workspace)
          try {
            if (
              action === 'productionComplete' &&
              data.id ===
                next.batches.find((run) => run.productId === basket.id)?.id &&
              !failed
            ) {
              failed = true
              throw new Error(
                'Temporary fixture interruption; retry finalization.',
              )
            }
            const handled = await handleProduction(action, table, data, {
              state: next,
              audit: async () => {},
              today,
              actor: 'Fixture baker',
              save: async (target, item) => {
                const items: Item[] = (next[target] ||= [])
                next[target] = [
                  ...items.filter((entry) => entry.id !== item.id),
                  structuredClone(item),
                ]
              },
            })
            if (!handled) throw new Error('Unsupported fixture operation.')
            workspace = next
          } catch (error) {
            return route.fulfill({
              status: 400,
              json: { error: (error as Error).message },
            })
          }
        }
        return route.fulfill({
          json: { workspace, role: 'Owner', demo: false },
        })
      })
      await mkdir(directory, { recursive: true })
      const screenshot = (step: string) =>
        page.screenshot({
          path: `${directory}/${phone ? 'phone' : 'desktop'}-${step}.png`,
          animations: 'disabled',
          style: '[data-sonner-toaster] { visibility: hidden }',
        })
      await page.goto(workspaceFixtureUrl('Production/Production Runs'))
      const board = page.getByRole('region', { name: 'Production board' })
      await board
        .getByLabel('Market, event, or order')
        .selectOption('event:fixture-market')
      await board.getByRole('button', { name: 'Plan production' }).click()
      const dialog = page.getByRole('dialog')
      await dialog
        .getByRole('combobox', { name: 'Product', exact: true })
        .selectOption(basket.id)
      await dialog
        .getByRole('spinbutton', { name: 'Planned baskets' })
        .fill('2')
      const contents = dialog.getByRole('region', {
        name: 'Basket component production',
      })
      await contents.getByText(/Spinach Parmesan loaf ·/).click()
      await contents.getByLabel('Round up to whole recipe batches').check()
      await expect(
        contents.getByText(/3 packages · 2 for this basket · 1 extra/),
      ).toBeVisible()
      await contents.getByText(/Apple tea tins ·/).click()
      await contents.getByLabel('Packages to use from stock').last().fill('2')
      await screenshot('01-plan')
      await dialog
        .getByRole('button', { name: 'Save basket & component plan' })
        .click()
      await expect(
        dialog.getByRole('heading', { name: 'Start the saved plan' }),
      ).toBeVisible()
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(
        board.getByRole('button', { name: 'Review & start basket' }),
      ).toBeVisible()
      await screenshot('00-market-board')
      await board.getByRole('button', { name: 'List', exact: true }).click()
      await expect(board.getByLabel('Market, event, or order')).toHaveValue(
        'event:fixture-market',
      )
      await board.getByRole('button', { name: 'Board', exact: true }).click()
      await board.getByRole('button', { name: 'Review & start basket' }).click()
      const checklist = dialog.locator('.basket-board-checklist')
      await checklist.locator('summary').click()
      async function checkAll() {
        for (const control of await checklist.getByRole('checkbox').all()) {
          if (phone) await control.tap()
          else await control.click()
          await expect(control).toBeChecked()
        }
      }
      await checkAll()
      await dialog.getByRole('button', { name: 'Start basket plan' }).click()
      await expect(
        dialog.getByRole('heading', { name: 'Make contents' }),
      ).toBeVisible()
      const componentSummary = contents
        .locator('summary')
        .filter({ hasText: /Spinach Parmesan loaf ·/ })
      if (
        !(await contents
          .getByRole('button', { name: 'Open component run' })
          .isVisible())
      )
        await componentSummary.click()
      await screenshot('02-make')
      await contents.getByRole('button', { name: 'Open component run' }).click()
      await dialog
        .getByRole('button', { name: 'Start run', exact: true })
        .click()
      await dialog.getByLabel('Actual good output').fill('3')
      await dialog.getByRole('button', { name: 'Save output' }).click()
      await dialog
        .getByRole('button', { name: 'Review & finalize', exact: true })
        .click()
      await dialog
        .getByRole('button', { name: 'Finalize production', exact: true })
        .click()
      await expect(
        dialog.getByRole('heading', { name: 'Recorded result' }),
      ).toBeVisible()
      await dialog.getByRole('button', { name: 'Back to basket' }).click()
      await expect(
        dialog.getByRole('heading', { name: 'Pack baskets' }),
      ).toBeVisible()
      await dialog.getByLabel('Actual completed baskets').fill('2')
      await dialog.getByRole('button', { name: 'Save actual baskets' }).click()
      await checklist.locator('summary').click()
      await checklist
        .getByRole('button', { name: 'Picked', exact: true })
        .click()
      await checkAll()
      await checklist.getByRole('button', { name: 'Packed & verified' }).click()
      await checkAll()
      await screenshot('03-pack')
      await dialog
        .getByRole('button', { name: 'Review & finalize', exact: true })
        .click()
      await expect(
        dialog.getByRole('region', { name: 'Finalization review' }),
      ).toBeVisible()
      await screenshot('04-review')
      await dialog
        .getByRole('button', { name: 'Finalize production', exact: true })
        .click()
      await expect(
        dialog.getByText(/Temporary fixture interruption/),
      ).toBeVisible()
      expect(
        workspace.products.find((product) => product.id === basket.id)
          ?.quantity,
      ).toBe(0)
      await dialog
        .getByRole('button', { name: 'Finalize production', exact: true })
        .click()
      await expect(
        dialog.getByRole('heading', { name: 'Recorded result' }),
      ).toBeVisible()
      expect(
        workspace.products.find((product) => product.id === loaf.id)?.quantity,
      ).toBe(1)
      expect(
        workspace.products.find((product) => product.id === basket.id)
          ?.quantity,
      ).toBe(2)
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(board.getByLabel('Market, event, or order')).toHaveValue(
        'event:fixture-market',
      )
      await page.reload()
      await board.getByRole('button', { name: /^Completed/ }).click()
      await expect(board.getByText('Contents ready: 2 of 2')).toBeVisible()
      if (!phone) {
        await screenshot('05-board-100')
        await page.evaluate(() => {
          document.body.style.zoom = '0.8'
        })
        await screenshot('06-board-80')
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
    })
  })
}
