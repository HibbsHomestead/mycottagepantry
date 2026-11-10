import { test, expect, type Page } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { mkdir, copyFile } from 'node:fs/promises'

// Netlify may discover a generated server function from prior platform validation.
// Resolve development modules from Vite while keeping the test page on port 8889.
async function developmentAssets(page: Page) {
  await page.route(
    /\/(?:@|src\/|node_modules\/|netlify\/lib\/)/,
    async (route) => {
      const url = new URL(route.request().url())
      url.port = '3000'
      const response = await route.fetch({ url: url.href })
      await route.fulfill({
        response,
        ...(url.pathname === '/src/test/capture-workspace.tsx'
          ? {
              body:
                'import "/src/components/public-site.css";\n' +
                (await response.text()),
            }
          : {}),
      })
    },
  )
}

for (const width of [1440, 390]) {
  test(`pending oven animation and failure recovery ${width}`, async ({
    page,
    browser,
  }) => {
    await mkdir('docs/reviews/opening-oven', { recursive: true })
    const context = await browser.newContext({
      viewport: { width, height: 850 },
      recordVideo: {
        dir: 'test-results/oven-video',
        size: { width, height: 850 },
      },
    })
    const recorded = await context.newPage()
    await developmentAssets(recorded)
    await installWorkspaceFixture(recorded)
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    await recorded.route('**/api/workspace*', async (route) => {
      await pending
      await route.fulfill({
        status: 503,
        json: { error: 'Oven connection failed. Please retry.' },
      })
    })
    await recorded.goto(workspaceFixtureUrl())
    await expect(
      recorded.getByRole('heading', { name: 'Opening your oven…' }),
    ).toBeVisible()
    await expect(recorded.getByRole('status')).toHaveText(
      'Loading your private business records.',
    )
    const oven = recorded.locator('.opening-oven')
    await expect(oven).toHaveAttribute('aria-hidden', 'true')
    // Sample the real CSS timeline: the door opens once, while steam continues.
    const door = recorded.locator('.opening-oven-door')
    const closed = await door.evaluate((el) => getComputedStyle(el).transform)
    await recorded.waitForTimeout(2700)
    const open = await door.evaluate((el) => getComputedStyle(el).transform)
    expect(open).not.toBe(closed)
    await recorded.screenshot({
      path: `docs/reviews/opening-oven/loading-${width}.png`,
    })
    for (const name of ['Retry oven access', 'Log in again', 'Need help?']) {
      await expect(
        recorded.getByRole(name === 'Retry oven access' ? 'button' : 'link', {
          name,
        }),
      ).toBeInViewport()
    }
    await recorded.waitForTimeout(3200)
    expect(await door.evaluate((el) => getComputedStyle(el).transform)).toBe(
      open,
    )
    release()
    await expect(
      recorded.getByRole('heading', { name: 'Oven unavailable' }),
    ).toBeVisible()
    await expect(recorded.getByRole('alert')).toContainText(
      'Oven connection failed',
    )
    await expect(oven).toHaveCount(0)
    await recorded.screenshot({
      path: `docs/reviews/opening-oven/failed-${width}.png`,
    })
    const video = recorded.video()!
    await context.close()
    await copyFile(
      await video.path(),
      `docs/reviews/opening-oven/animation-${width}.webm`,
    )
    await page.setViewportSize({ width, height: 850 })
  })
}

test('reduced motion stays open without moving steam', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 850 })
  await developmentAssets(page)
  await installWorkspaceFixture(page)
  await page.route('**/api/workspace*', () => {})
  await page.goto(workspaceFixtureUrl())
  await expect(page.locator('.opening-oven')).toBeVisible()
  expect(
    await page
      .locator('.opening-oven-door')
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none')
  for (const steam of await page.locator('.oven-steam').all()) {
    expect(
      await steam.evaluate((el) => [
        getComputedStyle(el).animationName,
        getComputedStyle(el).opacity,
      ]),
    ).toEqual(['none', '0'])
  }
  await page.screenshot({
    path: 'docs/reviews/opening-oven/reduced-motion-390.png',
  })
})

test('immediate records replace the illustration without an animation delay', async ({
  page,
}) => {
  await developmentAssets(page)
  await installWorkspaceFixture(page)
  await page.route('**/api/workspace*', (route) =>
    route.fulfill({
      json: { workspace: demoData(), role: 'Owner', demo: false },
    }),
  )
  await page.goto(workspaceFixtureUrl())
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 2000 })
  await expect(page.locator('.opening-oven')).toHaveCount(0)
})
