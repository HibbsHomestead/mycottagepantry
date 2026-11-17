import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { installPublicPlanFixture } from './public-plan-fixture'
test('public screenshots and enlarged previews retain their complete aspect ratio', async ({
  page,
}) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(10000)
  await installPublicPlanFixture(page)
  mkdirSync('docs/reviews/scoped-release', { recursive: true })
  for (const width of [1440, 1100, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/features')
    for (const title of ['Costing', 'Inventory', 'Recipes', 'Labels']) {
      const trigger = page.getByRole('button', {
        name: `Expand ${title} screenshot`,
      })
      if (!(await trigger.count())) continue
      await expect
        .poll(() =>
          trigger.evaluate((el) =>
            Object.keys(el).some((k) => k.startsWith('__reactProps')),
          ),
        )
        .toBe(true)
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: title, exact: true })
      await expect(dialog).toBeVisible()
      const img = dialog.locator('img')
      await expect
        .poll(() =>
          img.evaluate(
            (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
          ),
        )
        .toBe(true)
      const dimensions = await img.evaluate((el: HTMLImageElement) => ({
        width: el.clientWidth,
        height: el.clientHeight,
        nw: el.naturalWidth,
        nh: el.naturalHeight,
      }))
      expect(
        Math.abs(
          dimensions.width / dimensions.height - dimensions.nw / dimensions.nh,
        ),
      ).toBeLessThan(0.01)
      const box = await img.boundingBox()
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height).toBeLessThanOrEqual(1000)
      await page.screenshot({
        path: `docs/reviews/scoped-release/${title.toLowerCase()}-viewer-${width}.webp`,
      })
      await page.keyboard.press('Escape')
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.goto('/')
    const hero = page.locator('img[src="/screenshots/home-products.webp"]')
    await expect(hero).toBeVisible()
    await expect
      .poll(() =>
        hero.evaluate(
          (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
        ),
      )
      .toBe(true)
    await page.screenshot({
      path: `docs/reviews/scoped-release/home-${width}.webp`,
    })
  }
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
