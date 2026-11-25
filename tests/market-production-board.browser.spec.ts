import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { breadBaseFixture } from '../src/test/fixtures/bread-base'
import { productionDefinition } from '../src/lib/production'
import { basketChecklist } from '../src/lib/production-checklist'
import type { Item } from '../src/lib/domain'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

const screenshots = process.env.PRODUCTION_SCREENSHOTS || 'docs/reviews/market-production-board'

for (const width of [1440, 390]) {
  test.describe(`${width}px production board`, () => {
    test.use({ viewport: { width, height: 1000 }, hasTouch: width === 390 })
    test('shows consolidated market demand and records distinct basket checks', async ({
      page,
      context,
    }) => {
      test.setTimeout(25_000)
      await installWorkspaceFixture(page)
      const workspace = breadBaseFixture()
      const eventId = 'orchard-market'
      const basketId = 'orchard-basket-run'
      const date = '2026-11-24'
      const loaf = Object.assign(workspace.products[0], {
        quantity: 4,
        cost: 4,
        stockCostKnown: true,
        sku: 'LOAF-01',
      })
      const buns: Item = {
        id: 'apple-buns',
        name: 'Apple buns · four pack',
        unitsPerPackage: 4,
        quantity: 1,
        cost: 6,
        stockCostKnown: true,
        sku: 'BUN-04',
      }
      const basket: Item = {
        id: 'orchard-basket',
        name: 'Orchard breakfast basket',
        workflow: 'kit',
        kitComponents: [
          { productId: loaf.id, quantity: 1, basis: 'package' },
          { productId: buns.id, quantity: 2, basis: 'package' },
        ],
        packagingLines: [
          { ingredientId: 'orchard-box', quantity: 1, unit: 'each' },
        ],
      }
      workspace.products.push(buns, basket)
      workspace.ingredients.push({
        id: 'orchard-box',
        name: 'Kraft basket box',
        unit: 'each',
        quantity: 12,
        cost: 1,
        usedAs: 'packaging',
      })
      workspace.events = [{ id: eventId, name: 'Orchard Saturday Market' }]
      workspace.finance_transactions = [
        { id: 'sample-order', name: 'Sample customer order', kind: 'invoice' },
      ]
      workspace.event_batch_links = []
      const mapping = { quantity: 1, unit: 'loaves', verified: true }
      const basketLine: Item = {
        id: 'orchard-basket-line',
        name: basket.name,
        productId: basket.id,
        quantity: 2,
        output: 2,
        definition: productionDefinition(basket, workspace, {}),
      }
      const loafLine: Item = {
        id: 'orchard-loaf-line',
        name: loaf.name,
        productId: loaf.id,
        quantity: 6,
        mapping,
        definition: productionDefinition(loaf, workspace, mapping),
        basketAssignments: [{ runId: basketId, quantity: 2 }],
      }
      const basketRun: Item = {
        id: basketId,
        name: basket.name,
        date,
        dueDate: date,
        eventId,
        status: 'scheduled',
        revision: 1,
        productionVersion: 2,
        lines: [basketLine],
      }
      workspace.batches = [
        {
          id: 'orchard-loaf-run',
          name: 'Spinach loaves for market',
          date,
          dueDate: date,
          eventId,
          status: 'draft',
          revision: 1,
          productionVersion: 2,
          lines: [loafLine],
        },
        basketRun,
        {
          id: 'orchard-stock-run',
          name: 'Freezer replenishment',
          date,
          status: 'draft',
          revision: 1,
          productionVersion: 2,
          lines: [{ ...loafLine, basketAssignments: [] }],
        },
        {
          id: 'orchard-order-run',
          name: 'Customer batch',
          date,
          orderId: 'sample-order',
          status: 'draft',
          revision: 1,
          productionVersion: 2,
          lines: [{ ...loafLine, basketAssignments: [] }],
        },
      ]
      let mutations = 0
      await page.route('**/api/workspace*', async (route) => {
        if (route.request().url().includes('recipeCategories'))
          return route.fulfill({ json: { categories: [], revision: 1 } })
        if (route.request().method() === 'POST') {
          const { action, data } = route.request().postDataJSON()
          if (action !== 'productionChecklist')
            return route.fulfill({
              status: 400,
              json: { error: 'Read-only fixture outside of checklist actions' },
            })
          expect(data.expectedRevision).toBe(basketRun.revision)
          const item = basketChecklist(basketLine, workspace, data.stage).find(
            (entry) => entry.key === data.key,
          )!
          basketLine.checklist = {
            ...basketLine.checklist,
            [data.stage]: {
              ...basketLine.checklist?.[data.stage],
              [data.key]: {
                signature: item.signature,
                quantity: data.checked ? item.required : Number(data.quantity),
                checked: data.checked,
              },
            },
          }
          basketRun.revision++
          mutations++
        }
        return route.fulfill({
          json: { workspace, role: 'Owner', demo: false },
        })
      })
      await page.goto(workspaceFixtureUrl('Production/Production Runs'))
      const board = page.getByLabel('Production board', { exact: true })
      await board.getByText('Additional filters and layout').click()
      await board
        .getByLabel('Production type')
        .selectOption('Stock replenishment')
      await expect(
        board.getByRole('button', { name: 'Freezer replenishment' }),
      ).toBeVisible()
      await board.getByLabel('Production type').selectOption('Customer order')
      await expect(
        board.getByText('Order: Sample customer order'),
      ).toBeVisible()
      await board.getByLabel('Production type').selectOption('')
      await board
        .getByLabel('Market, event, or order')
        .selectOption(`event:${eventId}`)
      const summary = board.getByRole('region', {
        name: 'Orchard Saturday Market production plan',
      })
      await expect(
        summary.getByText('6 planned · 0 completed · 6 remaining'),
      ).toBeVisible()
      await expect(
        summary.getByText(
          '2 needed for open baskets · 2 assigned from production',
        ),
      ).toBeVisible()
      await expect(
        summary.getByText(/Apple buns · four pack: 3 .* short/),
      ).toBeVisible()
      await mkdir(screenshots, { recursive: true })
      if (width === 1440) {
        await board.screenshot({
          path: `${screenshots}/market-board.png`,
          animations: 'disabled',
        })
      } else {
        const grip = board
          .getByRole('article')
          .filter({ hasText: 'Spinach loaves for market' })
          .locator('.production-board-grip')
        await grip.evaluate((element) =>
          element.scrollIntoView({ block: 'center' }),
        )
        const location = (await grip.boundingBox())!
        const cdp = await context.newCDPSession(page)
        const point = {
          x: Math.round(location.x + 20),
          y: Math.round(location.y + 20),
        }
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [point],
        })
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ ...point, y: point.y + 28 }],
        })
        const target = page.locator('[data-touch-drop="In Progress"]')
        await expect(target).toBeVisible()
        const drop = (await target.boundingBox())!
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            { x: drop.x + drop.width / 2, y: drop.y + drop.height / 2 },
          ],
        })
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        })
        await expect(page.getByRole('dialog')).toBeVisible()
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Close', exact: true })
          .click()
        await expect(
          board.getByRole('button', { name: 'Spinach loaves for market' }),
        ).toBeVisible()
        expect(mutations).toBe(0)
      }
      async function openChecklist() {
        if (width === 390)
          await board
            .getByRole('group', { name: 'Production stage' })
            .getByRole('button', { name: /^In Progress/ })
            .click()
        const card = board.getByRole('article').filter({
          has: page.getByRole('button', { name: basket.name, exact: true }),
        })
        if (width === 390 && !mutations) {
          await board
            .getByRole('group', { name: 'Production stage' })
            .evaluate((element) => element.scrollIntoView({ block: 'start' }))
          await page.screenshot({
            path: `${screenshots}/phone-stage.png`,
            animations: 'disabled',
          })
        }
        await card
          .getByText(`Basket checklist · ${basket.name}`, { exact: true })
          .click()
        return card
      }
      let card = await openChecklist()
      const check = () =>
        card.getByRole('checkbox', { name: /Spinach Parmesan loaf/ })
      await card.getByRole('button', { name: 'Reviewed', exact: true }).click()
      await card.getByText(loaf.name, { exact: true }).click()
      await expect(check()).toBeChecked()
      await check().press('Space')
      await expect(check()).not.toBeChecked()
      await check().click()
      await expect(check()).toBeChecked()
      await card.getByRole('button', { name: 'Picked', exact: true }).click()
      await expect(check()).not.toBeChecked()
      const partial = card.getByRole('spinbutton', {
        name: 'Actual picked · Apple buns · four pack',
      })
      await partial.fill('1')
      await partial
        .locator('xpath=ancestor::form')
        .getByRole('button', { name: 'Save quantity' })
        .click()
      await expect
        .poll(
          () => basketLine.checklist?.picked['product:apple-buns']?.quantity,
        )
        .toBe(1)
      await expect(
        card.getByRole('checkbox', { name: /Apple buns/ }),
      ).toBeDisabled()
      await check().click()
      await expect(check()).toBeChecked()
      await card.getByRole('button', { name: 'Packed & verified' }).click()
      await expect(check()).not.toBeChecked()
      await check().click()
      await expect(check()).toBeChecked()
      await expect(
        card.getByRole('button', { name: 'Make contents' }),
      ).toBeVisible()
      if (width === 390) {
        await card.screenshot({
          path: `${screenshots}/expanded-basket.png`,
          animations: 'disabled',
          style: '[data-sonner-toaster] { visibility: hidden }',
        })
        await card
          .getByText(`Basket checklist · ${basket.name}`, { exact: true })
          .click()
        await card
          .locator('.production-board-warning > summary')
          .click()
        await card.screenshot({
          path: `${screenshots}/basket-shortage.png`,
          animations: 'disabled',
          style: '[data-sonner-toaster] { visibility: hidden }',
        })
        const layout = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          outliers: [...document.querySelectorAll('body *')]
            .filter(
              (element) =>
                element instanceof HTMLElement &&
                !element.closest('.workspace-background'),
            )
            .map((element) => ({
              tag: element.tagName,
              name: element.getAttribute('class'),
              right: element.getBoundingClientRect().right + window.scrollX,
            }))
            .filter((entry) => entry.right > window.innerWidth + 1)
            .slice(0, 18),
        }))
        expect(
          layout.width,
          JSON.stringify(layout.outliers),
        ).toBeLessThanOrEqual(width)
      }
      await page.reload()
      card = await openChecklist()
      await expect(check()).toBeChecked()
      await card.getByRole('button', { name: 'Picked', exact: true }).click()
      await expect(
        card.getByRole('spinbutton', {
          name: 'Actual picked · Apple buns · four pack',
        }),
      ).toHaveValue('1')
      expect(workspace.ledger).toEqual([])
    })
  })
}
