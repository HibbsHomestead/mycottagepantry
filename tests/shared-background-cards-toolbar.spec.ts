import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

for (const width of [1440, 1100, 390]) {
  test(`shared stationary artwork, card photos and recipe toolbar (${width})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.settings[0].appearance = { theme: 'cottage', mode: 'light' }
    const shapes = [
      [120, 300],
      [400, 140],
      [240, 240],
      [240, 240],
      [300, 300],
    ]
    workspace.graphic_assets = shapes.map((shape, i) => ({
      id: `image-${i}`,
      name: `Image ${i}`,
      fileUrl: `/card-fixture-${i}.svg`,
      widthPx: shape[0],
      heightPx: shape[1],
    }))
    workspace.graphic_assets.push({
      id: 'broken',
      name: 'Broken',
      fileUrl: '/card-fixture-broken.svg',
    })
    workspace.products = Array.from({ length: 7 }, (_, i) => ({
      ...workspace.products[0],
      id: `product-${i}`,
      name: `Photo sample ${i}`,
      imageAssetId: i === 5 ? 'broken' : i === 6 ? undefined : `image-${i}`,
    }))
    workspace.ingredients[0].imageAssetId = 'image-0'
    await page.route('**/card-fixture-*.svg', (route) => {
      const n = Number(
        route
          .request()
          .url()
          .match(/fixture-(\d+)/)?.[1],
      )
      if (!Number.isFinite(n)) return route.fulfill({ status: 404, body: '' })
      const [w, h] = shapes[n]
      return route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${n === 3 ? '' : `<rect width="100%" height="100%" fill="white"/>`}<rect x="${w * 0.2}" y="${h * 0.1}" width="${w * 0.6}" height="${h * 0.8}" rx="12" fill="#ad7951"/></svg>`,
      })
    })
    await page.route('**/api/workspace*', (route) =>
      route.fulfill({ json: { workspace, role: 'Owner', demo: true } }),
    )
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    const background = page.locator('.workspace-background')
    await expect(background).toBeVisible()
    await expect(background).toHaveAttribute('aria-hidden', 'true')
    await background.evaluate((el) =>
      el.setAttribute('data-persistent-test', 'yes'),
    )
    const before = await background.boundingBox()
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0)
    expect(await background.boundingBox()).toEqual(before)
    expect(
      await background.evaluate((el) => getComputedStyle(el).position),
    ).toBe('fixed')
    expect(
      await background.evaluate((el) => getComputedStyle(el).pointerEvents),
    ).toBe('none')
    await page.evaluate(() => window.scrollTo(0, 0))
    if (width === 390) {
      await page
        .getByRole('button', { name: 'Open navigation', exact: true })
        .click()
      expect(await background.boundingBox()).toEqual(before)
      await page
        .getByRole('button', { name: 'Close navigation', exact: true })
        .click()
      await expect
        .poll(async () => {
          const box = await page.locator('.sidebar').boundingBox()
          return box ? box.x + box.width : 0
        })
        .toBeLessThanOrEqual(0)
    }
    await page
      .locator('.pantry-card:has(.ingredient-card img)')
      .first()
      .scrollIntoViewIfNeeded()
    expect(
      await page
        .locator('.ingredient-card img')
        .first()
        .evaluate((el) => getComputedStyle(el).objectFit),
    ).toBe('contain')
    await page.screenshot({
      path: `docs/reviews/shared-app/ingredients-${width}.png`,
    })
    await page.evaluate(() => {
      location.hash = '#Recipes'
    })
    await expect(
      page.getByRole('button', { name: 'Create recipe', exact: true }),
    ).toBeVisible()
    await expect(background).toHaveAttribute('data-persistent-test', 'yes')
    await page
      .getByRole('textbox', { name: 'Search recipes', exact: true })
      .fill('no matching recipe')
    await expect(page.locator('.recipe-grid .recipe-card')).toHaveCount(0)
    await page
      .getByRole('textbox', { name: 'Search recipes', exact: true })
      .fill('')
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({
      path: `docs/reviews/shared-app/recipes-${width}.png`,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    if (width === 1100) {
      await page.evaluate(() => {
        document.documentElement.style.setProperty(
          '--interface-text-min',
          '20px',
        )
        const option = document.querySelector('.recipe-toolbar select option')
        if (option)
          option.textContent =
            'Seasonal celebration recipes and preparations with a very long category name'
      })
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: 'docs/reviews/shared-app/recipes-large-text-1100.png',
      })
      await page.evaluate(() =>
        document.documentElement.style.removeProperty('--interface-text-min'),
      )
    }
    await page.evaluate(() => {
      location.hash = '#Products%20%26%20Pricing'
    })
    const foreground = page.locator('.product-photo-grid .photo-foreground')
    await expect(foreground.first()).toBeVisible()
    await page
      .locator('.product-card-photo-first')
      .last()
      .scrollIntoViewIfNeeded()
    await expect(page.locator('.product-photo-extension')).toHaveCount(4)
    await expect(
      page.locator(
        '.product-photo-grid .pantry-photo[data-photo-state="missing"]',
      ),
    ).toHaveCount(2)
    expect(
      await foreground.first().evaluate((el) => getComputedStyle(el).objectFit),
    ).toBe('contain')
    expect(
      await page
        .locator('.product-photo-extension')
        .first()
        .evaluate((el) => getComputedStyle(el).filter),
    ).toBe('blur(18px)')
    workspace.settings[0].appearance = { theme: 'cottage', mode: 'dark' }
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')
    await page
      .locator('.product-card-photo-first')
      .first()
      .scrollIntoViewIfNeeded()
    await page.screenshot({
      path: `docs/reviews/shared-app/products-dark-${width}.png`,
    })
    await page
      .getByRole('button', { name: 'View details', exact: true })
      .first()
      .click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(
      await page
        .getByRole('dialog')
        .locator('.product-photo-extension')
        .count(),
    ).toBe(0)
    await page.keyboard.press('Escape')
    await page.emulateMedia({ media: 'print' })
    await expect(background).toBeHidden()
  })
}
