import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { mkdirSync } from 'node:fs'
for (const width of [1440, 820])
  for (const incomplete of [false, true])
    test(`planned kit costs remain visible without stock at ${width}, incomplete=${incomplete}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 })
      await installWorkspaceFixture(page)
      const workspace = demoData()
      const component = workspace.products[0]
      component.quantity = 0
      component.stockCostKnown = false
      workspace.products.push({
        id: 'review-kit',
        name: 'Isolated planned cost review kit',
        workflow: 'kit',
        status: 'active',
        quantity: 0,
        price: 35,
        assemblyMinutes: 6,
        assemblyRate: 10,
        kitComponents: [
          { productId: component.id, quantity: 2, basis: 'package' },
        ],
        packagingLines: [],
      })
      if (incomplete) {
        workspace.products.push({
          id: 'review-missing',
          name: 'Isolated missing purchase cost',
          workflow: 'resale',
          status: 'active',
          quantity: 0,
        })
        workspace.products
          .find((p) => p.id === 'review-kit')!
          .kitComponents.push({
            productId: 'review-missing',
            quantity: 1,
            basis: 'package',
          })
      }
      let writes = 0
      await page.route('**/api/workspace', (r) => {
        if (r.request().method() !== 'GET') writes++
        return r.fulfill({ json: { workspace, role: 'Owner', demo: false } })
      })
      await page.goto(workspaceFixtureUrl('Dashboard'))
      await page
        .getByRole('button', { name: 'Start production', exact: true })
        .first()
        .click()
      const dialog = page.getByRole('dialog')
      await dialog
        .getByRole('combobox', { name: 'Product', exact: true })
        .selectOption('review-kit')
      await expect(
        dialog.getByRole('cell', { name: /Current product estimate/ }),
      ).toBeVisible()
      await expect(
        dialog.getByRole('cell', { name: 'Shortage', exact: true }).first(),
      ).toBeVisible()
      await expect(
        dialog.getByText('Needs cost setup', { exact: true }),
      ).toHaveCount(0)
      if (incomplete) {
        await expect(
          dialog.getByText(/Incomplete · Known estimated subtotal:/),
        ).toBeVisible()
        await expect(
          dialog.getByRole('cell', { name: 'Unavailable', exact: true }),
        ).toBeVisible()
      }
      mkdirSync('docs/reviews/production-costs', { recursive: true })
      await dialog
        .getByRole('cell', { name: /Current product estimate/ })
        .scrollIntoViewIfNeeded()
      await page.screenshot({
        path: `docs/reviews/production-costs/planned-kit-${width}-${incomplete ? 'incomplete' : 'complete'}.png`,
        fullPage: true,
      })
      expect(writes).toBe(0)
      await page.unrouteAll({ behavior: 'ignoreErrors' })
    })
