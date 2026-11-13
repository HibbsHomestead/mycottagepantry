import { test, expect } from '@playwright/test'
import { accessFixture } from './account-access-fixture'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [390, 820, 1440])
  for (const view of ['cards', 'table']) {
    test(`ingredient details and editor ${width} ${view}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width, height: 844 })
      await installWorkspaceFixture(page)
      const member = {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Fixture',
        role: 'Owner',
      }
      await page.route('**/api/account-access*', (route) =>
        route.fulfill({
          json: accessFixture('workspace', {
            membership: member,
            memberships: [member],
          }),
        }),
      )
      const workspace = demoData()
      workspace.settings[0].currentPantryView = view
      const pumpkin = {
        id: 'pumpkin-fixture',
        name: 'Pumpkin fixture',
        usedAs: 'ingredient',
        unit: 'each',
        storageUnit: 'can',
        recipeUnit: 'can',
        quantity: 7,
        cost: 1.25,
        currentCost: 1.5,
        threshold: 2,
        reorderQuantity: 3,
        conversions: [],
      }
      workspace.ingredients.push(pumpkin)
      const original = JSON.stringify(workspace)
      let writes = 0
      await page.route('**/api/workspace*', (route) => {
        if (route.request().method() !== 'GET') writes++
        return route.fulfill({
          json: { workspace, role: 'Owner', demo: false },
        })
      })
      await page.goto(
        process.env.INGREDIENT_TEST_ORIGIN
          ? process.env.INGREDIENT_TEST_ORIGIN + '/oven#Inventory/Overview'
          : workspaceFixtureUrl('Inventory/Overview').replace(
              'localhost:8889',
              'localhost:3000',
            ),
        {
          waitUntil: 'domcontentloaded',
        },
      )
      const dialog = page.getByRole('dialog')
      for (const tab of ['Overview', 'Ingredients']) {
        await page
          .getByRole('navigation', { name: 'Inventory tabs' })
          .getByRole('link', { name: tab, exact: true })
          .click()
        const totals = await page.locator('.pantry-summary').innerText()
        for (const name of ['All-purpose flour', 'Pumpkin fixture']) {
          // Demo flour name is read from the fixture to keep the entry point exact.
          const itemName =
            name === 'All-purpose flour'
              ? workspace.ingredients.find(
                  (i) => i.name === 'All-purpose flour',
                )!.name
              : name
          for (let repeat = 0; repeat < 2; repeat++) {
            const row =
              view === 'cards'
                ? page.getByRole('article', { name: itemName, exact: true })
                : page
                    .getByRole('row')
                    .filter({ has: page.getByText(itemName, { exact: true }) })
            await row.getByText(itemName, { exact: true }).click()
            await expect(dialog).toBeVisible()
            const box = (await dialog.boundingBox())!
            await expect(dialog).not.toHaveClass(/translate-[xy]-/)
            expect(box.x).toBeGreaterThanOrEqual(0)
            expect(box.y).toBeGreaterThanOrEqual(0)
            expect(box.x + box.width).toBeLessThanOrEqual(width)
            expect(box.y + box.height).toBeLessThanOrEqual(845)
            if (repeat === 0 && tab === 'Overview')
              await page.screenshot({
                path: testInfo.outputPath(`${width}-${view}-${name}.png`),
              })
            await expect(
              dialog.getByRole('heading', { name: itemName, exact: true }),
            ).toBeVisible()
            if (name === 'Pumpkin fixture') {
              await dialog
                .getByRole('button', { name: 'Edit Ingredient', exact: true })
                .click()
              await expect(
                dialog.getByLabel('Name', { exact: true }),
              ).toHaveValue(itemName)
              await expect(
                dialog.getByText(/Conversion required\./),
              ).toBeVisible()
              await dialog
                .getByRole('button', {
                  name: 'Stock & Other Details',
                  exact: true,
                })
                .click()
              await expect(
                dialog.getByLabel('Reorder threshold (each)', { exact: true }),
              ).toHaveValue('2')
              await expect(
                dialog.getByLabel('Reorder quantity (each)', { exact: true }),
              ).toHaveValue('3')
              await expect(
                dialog.getByText(/Current balance: 7 each/),
              ).toBeVisible()
              await dialog
                .getByRole('button', { name: 'Cancel', exact: true })
                .click()
            }
            await dialog.evaluate((el) => {
              el.scrollTop = el.scrollHeight
            })
            const scrolled = (await dialog.boundingBox())!
            expect(scrolled.x).toBeGreaterThanOrEqual(0)
            expect(scrolled.y).toBeGreaterThanOrEqual(0)
            await dialog
              .getByRole('button', { name: 'Close ingredient details' })
              .click()
            await expect(dialog).toHaveCount(0)
          }
        }
        expect(await page.locator('.pantry-summary').innerText()).toBe(totals)
      }
      expect(writes).toBe(0)
      expect(JSON.stringify(workspace)).toBe(original)
    })
  }
