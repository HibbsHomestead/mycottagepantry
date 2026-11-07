import { expect, test } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

// Adapter/review unit tests remain internal. Release UI exposes no AI operation.
for (const width of [1440, 390])
  test(`deferred providers stay absent while manual entry works at ${width}px`, async ({
    page,
  }) => {
    await installWorkspaceFixture(page)
    await page.setViewportSize({ width, height: 900 })
    let requests = 0
    await page.route('**/api/workspace*', (route) => {
      requests++
      expect(route.request().method()).toBe('GET')
      expect(route.request().url()).not.toMatch(/assistant|priceSearch/)
      return route.fulfill({
        json: { workspace: demoData(), role: 'Owner', demo: false },
      })
    })
    await page.goto(workspaceFixtureUrl('Pantry'))
    await page
      .getByRole('button', { name: 'Add ingredient', exact: true })
      .first()
      .click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Ingredient / item name').fill('Manual flour')
    await expect(dialog.getByLabel('Ingredient / item name')).toHaveValue(
      'Manual flour',
    )
    await expect(
      dialog.getByText(
        /Cottage Pantry Assistant|Suggest ingredient fields|Research product|Compare store prices|SerpApi/,
      ),
    ).toHaveCount(0)
    await expect(dialog.getByLabel('Product URL')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.goto(workspaceFixtureUrl('Settings/Integrations'))
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Square sales', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Tax reports & exports', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(
        /Cottage Pantry Assistant|Shopping price comparison|SERPAPI_API_KEY/,
      ),
    ).toHaveCount(0)
    expect(requests).toBeGreaterThan(0)
  })
