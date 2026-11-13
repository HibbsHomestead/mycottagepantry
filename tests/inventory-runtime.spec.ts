import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { accessFixture } from './account-access-fixture'

// Use deployed JavaScript and the real /oven route, with synthetic API records.
// This never reads or writes a customer's workspace or bypasses server auth.
const origin = process.env.INVENTORY_TEST_ORIGIN || 'http://localhost:8889'

for (const width of [390, 1440])
  for (const view of ['cards', 'table'] as const) {
    test(`Inventory runtime ${width}px, saved ${view} view`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 })
      const workspace = demoData()
      workspace.settings[0].currentPantryView = view
      workspace.settings[0].currentPantrySort = {
        key: 'quantity',
        direction: 'desc',
      }
      workspace.ingredients[0].storageLocation = 'Fixture shelf'
      workspace.ingredients.push({
        id: 'fabric-fixture',
        name: 'Fixture fabric',
        usedAs: 'material',
        materialType: 'fabric',
        fabricTracking: 'length',
        unit: 'yd',
        quantity: 3.25,
        cost: 4.5,
        fabricWidth: 44,
        widthUnit: 'in',
        threshold: 1,
      })
      const originalRecords = JSON.stringify(workspace)
      let writes = 0
      const member = {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Runtime fixture',
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
      await page.route('**/api/workspace*', (route) => {
        if (route.request().method() !== 'GET') {
          writes++
          return route.fulfill({
            status: 405,
            json: { error: 'Read-only runtime fixture' },
          })
        }
        return route.fulfill({
          json: { workspace, role: 'Owner', demo: false },
        })
      })
      page.on('console', (message) => {
        if (message.type() === 'error')
          console.log('BROWSER_CONSOLE', message.text())
      })
      page.on('pageerror', (error) =>
        console.log('BROWSER_EXCEPTION', error.stack),
      )
      page.on('response', (response) => {
        if (response.status() >= 400)
          console.log(
            'HTTP_FAILURE',
            response.status(),
            new URL(response.url()).pathname,
          )
      })
      await page.goto(origin + '/oven#Dashboard')
      await expect(
        page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ }),
      ).toBeVisible()
      if (width === 390)
        await page
          .getByRole('button', { name: 'Open navigation', exact: true })
          .click()
      await page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Inventory', exact: true })
        .click()
      await expect(
        page.getByRole('heading', { name: 'Inventory', exact: true }),
      ).toBeVisible()
      await page.reload()
      await expect(
        page.getByRole('heading', { name: 'Inventory', exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole('button', {
          name: view === 'cards' ? 'Cards' : 'Table',
          exact: true,
        }),
      ).toHaveAttribute('aria-pressed', 'true')
      await page.screenshot({
        path: testInfo.outputPath(`published-inventory-${width}-${view}.png`),
        fullPage: true,
      })
      for (const tab of [
        'Ingredients',
        'Craft Materials',
        'Packaging',
        'Supplies',
        'Finished Goods',
        'Movements',
        'Counts',
        'Overview',
      ]) {
        await page
          .getByRole('navigation', { name: 'Inventory tabs' })
          .getByRole('link', { name: tab, exact: true })
          .click()
        await expect(
          page.getByRole('heading', { name: 'Inventory', exact: true }),
        ).toBeVisible()
        await expect(
          page.getByText('This page couldn’t load', { exact: true }),
        ).toHaveCount(0)
      }
      await page
        .getByRole('button', { name: 'Add Item', exact: true })
        .first()
        .click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(writes).toBe(0)
      expect(JSON.stringify(workspace)).toBe(originalRecords)
    })
  }
