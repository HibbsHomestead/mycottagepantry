import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

// All records are synthetic. These previews never write customer business data.
for (const width of [1440, 390]) {
  test(`shared design review at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    await page.route('**/api/workspace*', (route) =>
      route.fulfill({ json: { workspace, role: 'Owner', demo: true } }),
    )
    const phase = process.env.CAPTURE_DESIGN_PHASE || 'after'
    for (const [section, name] of [
      ['Dashboard', 'dashboard'],
      ['Pantry', 'ingredients'],
    ]) {
      await page.goto(workspaceFixtureUrl(section))
      await expect(page.locator('.sidebar')).toBeAttached()
      await expect(page.locator('.page-heading')).toBeVisible()
      if (phase === 'after') {
        expect(
          await page.evaluate(
            () => getComputedStyle(document.body).backgroundColor,
          ),
        ).toBe('rgb(245, 246, 250)')
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        ).toBeLessThanOrEqual(1)
      }
      await page.screenshot({
        path: `docs/previews/${phase}-${name}-${width}.png`,
        fullPage: true,
        animations: 'disabled',
      })
    }
    await page.goto(workspaceFixtureUrl('Dashboard'))
    await page
      .getByRole('button', { name: 'Add ingredient', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByLabel('Ingredient / item name', { exact: true }),
    ).toBeVisible()
    if (phase === 'after') {
      expect(
        await dialog.evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe('rgb(255, 255, 255)')
      expect(
        await dialog.evaluate((el) => el.getBoundingClientRect().width),
      ).toBeLessThanOrEqual(width)
    }
    await page.screenshot({
      path: `docs/previews/${phase}-ingredient-form-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  })
}
