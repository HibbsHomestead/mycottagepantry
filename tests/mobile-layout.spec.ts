import { test, expect } from '@playwright/test'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { demoData } from '../src/lib/demo'
for (const size of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]) {
  test(`mobile layout ${size.width}x${size.height}`, async ({ page }) => {
    await installWorkspaceFixture(page)
    await page.route('**/api/workspace*', (r) =>
      r.fulfill({ json: { workspace: demoData(), role: 'Owner', demo: true } }),
    )
    await page.setViewportSize(size)
    for (const section of ['Products', 'Recipes']) {
      await page.goto(workspaceFixtureUrl(section))
      await expect(page.locator('.mobile-bottom-nav')).toBeAttached()
      await page.waitForTimeout(700)
      await page.screenshot({
        path: `/tmp/mobile-${process.env.CAPTURE_PHASE || 'after'}-${section}-${size.width}.png`,
      })
      const nav = page.locator('.mobile-bottom-nav')
      if (await nav.isVisible()) {
        const b = await nav.boundingBox()
        expect(Math.abs(b!.y + b!.height - size.height)).toBeLessThan(2)
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight),
        )
        const end = await nav.boundingBox()
        expect(Math.abs(end!.y + end!.height - size.height)).toBeLessThan(2)
      }
      if (section === 'Recipes') {
        await page.locator('.recipe-card').first().click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await page.waitForTimeout(350)
        await page.screenshot({
          path: `/tmp/mobile-${process.env.CAPTURE_PHASE || 'after'}-detail-${size.width}.png`,
        })
        const b = await dialog.boundingBox()
        expect(b!.y).toBeGreaterThanOrEqual(0)
        expect(b!.y + b!.height).toBeLessThanOrEqual(size.height)
        expect(
          await page.locator('body').getAttribute('data-scroll-locked'),
        ).toBeTruthy()
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
      }
    }
  })
}
