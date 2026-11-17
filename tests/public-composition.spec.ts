import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { installMarketingPhotos } from './marketing-photo-fixture'
import { installPublicPlanFixture } from './public-plan-fixture'

const directory = 'docs/reviews/public-composition'
test('refresh hero from current populated products, desktop and phone', async ({
  page,
}) => {
  mkdirSync(directory, { recursive: true })
  const workspace = demoData()
  Object.assign(workspace.settings[0], {
    name: 'Cottage Pantry Demo Kitchen',
    owner: 'Demonstration business',
    email: 'demo@example.invalid',
    address: 'Demonstration address',
  })
  await installWorkspaceFixture(page)
  await installMarketingPhotos(page, workspace)
  await page.route('**/api/workspace*', (r) =>
    r.fulfill({ json: { workspace, role: 'Owner', demo: true } }),
  )
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await page.goto(workspaceFixtureUrl('Products & Pricing'))
    await expect(page.locator('.app-shell')).toBeVisible()
    await expect(
      page.locator('.product-card img.photo-foreground').first(),
    ).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(
        Array.from(document.images).map((i) => i.decode().catch(() => {})),
      )
    })
    await page
      .locator('.product-card')
      .first()
      .evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.evaluate(() => scrollBy(0, -90))
    const image = await page.screenshot({ animations: 'disabled' })
    await sharp(image)
      .webp({ quality: 88 })
      .toFile(
        `public/screenshots/home-products${width === 390 ? '-mobile' : ''}.webp`,
      )
  }
})

test('public composition stays fixed, readable and navigable without preview parameters', async ({
  page,
}) => {
  test.setTimeout(180000)
  page.setDefaultTimeout(10000)
  await installPublicPlanFixture(page)
  // A private business preference must not recolor the public website.
  await page.addInitScript(() =>
    localStorage.setItem(
      'cottage-pantry.appearance.v1',
      JSON.stringify({ theme: 'orchard', mode: 'dark' }),
    ),
  )
  for (const width of [1440, 1100, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const path of ['/', '/features', '/pricing', '/help', '/login']) {
      console.log('Checking public layout', width, path)
      await page.goto(path)
      const site = page.locator('.public-site')
      await expect(site).toBeVisible()
      const art = site.locator('.workspace-background')
      await expect(art).toBeVisible()
      const before = await art.boundingBox()
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight))
      expect(await art.boundingBox()).toEqual(before)
      expect(await art.evaluate((el) => getComputedStyle(el).position)).toBe(
        'fixed',
      )
      expect(
        await site.evaluate((el) =>
          getComputedStyle(el).getPropertyValue('--primary'),
        ),
      ).toBe('#5c3a83')
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      for (const img of await page.locator('main img').all()) {
        await img.scrollIntoViewIfNeeded()
        await expect
          .poll(() =>
            img.evaluate(
              (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
            ),
          )
          .toBe(true)
      }
      await page.evaluate(() => scrollTo(0, 0))
      if (path === '/') {
        await page.locator('.public-story').scrollIntoViewIfNeeded()
        await page.screenshot({
          path: `${directory}/scrolled-story-${width}.webp`,
        })
        await page.evaluate(() => {
          scrollTo(0, 0)
          return document.fonts.ready
        })
        await page.screenshot({
          path: `${directory}/home-${width}.webp`,
          fullPage: true,
        })
        if (width === 390) {
          const menu = page.locator('.public-menu')
          await expect
            .poll(() =>
              menu.evaluate((el) =>
                Object.keys(el).some((key) => key.startsWith('__reactProps')),
              ),
            )
            .toBe(true)
          await menu.click()
          await expect(menu).toHaveAttribute('aria-expanded', 'true')
        }
        await page
          .getByRole('navigation', { name: 'Main navigation' })
          .getByRole('link', { name: 'Features', exact: true })
          .click()
        await expect(page).toHaveURL(/\/features$/)
      }
      await page.emulateMedia({ media: 'print' })
      await expect(art).toBeHidden()
      await page.emulateMedia({ media: 'screen' })
    }
  }
})
