import { test, expect } from '@playwright/test'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { demoData } from '../src/lib/demo'
for (const width of [1440, 390]) {
  test(`finance overview actual graphs and refresh ${width}`, async ({
    page,
  }) => {
    await installWorkspaceFixture(page)
    await page.setViewportSize({ width, height: 1000 })
    const w = demoData()
    for (const key of Object.keys(w))
      if (key !== 'settings') w[key] = []
    w.sales = [
      {
        id: 'sale',
        name: 'Fixture sale',
        date: '2026-11-01',
        amount: 100,
        tax: 0,
        fees: 3,
      },
    ]
    w.finance_transactions = [
      {
        id: 'legacy',
        name: 'Fixture legacy expense',
        kind: 'expense',
        date: '2026-11-02',
        status: 'posted',
        amount: 25,
        category: 'Supplies expense',
      },
    ]
    await page.route('**/api/workspace*', (route) =>
      route.fulfill({
        json: { workspace: w, role: 'Owner', demo: true },
      }),
    )
    await page.goto(workspaceFixtureUrl('Finances/Overview'))
    const dashboard = page.locator('.finance-dashboard')
    await expect(dashboard).toBeVisible()
    await dashboard
      .getByRole('combobox', { name: 'Date range', exact: true })
      .selectOption('All time')
    await expect(
      dashboard.locator('.finance-summary-card.income strong'),
    ).toHaveText('$100.00')
    await expect(
      dashboard.locator('.finance-summary-card.expenses strong'),
    ).toHaveText('$28.00')
    await expect(dashboard.locator('.finance-category')).toHaveCount(2)
    const bar = dashboard.locator('.finance-bar-pair .in').first()
    expect((await bar.boundingBox())!.height).toBeGreaterThan(20)
    await dashboard.locator('.finance-month').first().focus()
    await expect(dashboard.getByRole('status')).toContainText('$100.00')
    expect(
      await dashboard.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: `docs/reviews/finance-overview/fixture-${width}.png`,
      fullPage: true,
    })
    await dashboard
      .getByRole('button', { name: 'Add expense', exact: true })
      .click()
    await page
      .getByRole('textbox', { name: /Vendor|Description/ })
      .first()
      .fill('Fixture refreshed expense')
    await page
      .getByRole('spinbutton', { name: 'Amount ($)', exact: true })
      .fill('10')
    await page
      .getByRole('button', { name: 'Review', exact: true })
      .click()
    w.expenses = [
      {
        id: 'new',
        name: 'Fixture refreshed expense',
        date: '2026-11-03',
        amount: 10,
        category: 'Supplies expense',
      },
    ]
    await page
      .getByRole('button', { name: 'Confirm & post', exact: true })
      .click()
    await expect(
      dashboard.locator('.finance-summary-card.expenses strong'),
    ).toHaveText('$38.00')
  })
}
