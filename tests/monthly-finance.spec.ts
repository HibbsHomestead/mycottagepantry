import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
for (const [width, mode] of [
  [1440, 'light'],
  [390, 'light'],
  [1024, 'dark'],
] as const) {
  test(`monthly finance and shared accent ${width} ${mode}`, async ({
    page,
  }) => {
    await installWorkspaceFixture(page)
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/workspace*', (route) => {
      const workspace = demoData()
      workspace.settings[0].appearance = { theme: 'cottage', mode }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: true } })
    })
    await page.goto(workspaceFixtureUrl(), { waitUntil: 'domcontentloaded' })
    const card = page.locator('.monthly-finance')
    await expect(
      card.getByRole('heading', { name: 'Your month in the making' }),
    ).toBeVisible()
    await expect(card).toHaveAttribute('aria-busy', 'false')
    await card.scrollIntoViewIfNeeded()
    expect(
      await card.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: `/tmp/monthly-${width}-${mode}.png`,
      fullPage: true,
    })
    await card.getByRole('button', { name: 'View finances' }).click()
    await expect(page).toHaveURL(/#Finances/)
    for (const section of ['Pantry', 'Recipes', 'Settings']) {
      await page.goto(workspaceFixtureUrl(section))
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.locator('body')).toContainText(section)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1)
    }
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--brand-purple')
          .trim(),
      ),
    ).toBe('#5c3a83')
    if (width === 1440) {
      await page.goto(workspaceFixtureUrl('Pantry'))
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page
        .getByRole('button', { name: 'Add ingredient', exact: true })
        .first()
        .click()
      await expect(page.getByRole('dialog')).toBeVisible()
      expect(
        await page
          .getByRole('dialog')
          .evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1)
    }
  })
}
