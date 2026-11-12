import { test, expect, type Page } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

async function navigationFits(page: Page, width: number) {
  const nav = page.getByRole('navigation', { name: 'Mobile navigation' })
  if (width > 700) {
    await expect(nav).toBeHidden()
    return
  }
  await expect(nav).toBeVisible()
  const view = await page.evaluate(() => ({
    height: visualViewport!.height,
    top: visualViewport!.offsetTop,
  }))
  await expect
    .poll(async () => {
      const b = (await nav.boundingBox())!
      return Math.abs(b.y + b.height - view.top - view.height)
    })
    .toBeLessThanOrEqual(1)
  const b = (await nav.boundingBox())!
  const padding = await page
    .locator('.stage-one-shell main')
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))
  expect(padding).toBeGreaterThanOrEqual(b.height + 16)
  for (const button of await nav.getByRole('button').all()) {
    await expect
      .poll(() =>
        button.evaluate((el) => {
          const b = el.getBoundingClientRect()
          return el.contains(
            document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2),
          )
        }),
      )
      .toBe(true)
  }
}
async function fieldsReadable(page: Page) {
  for (const field of await page
    .locator(
      'input:visible:not([type=checkbox]):not([type=radio]):not([type=color]), textarea:visible, select:visible, [contenteditable=true]:visible, [role=combobox]:visible',
    )
    .all()) {
    expect(
      await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16)
    const b = (await field.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(-1)
    expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  }
}
async function keyboard(page: Page, height?: number) {
  await page.evaluate((height) => {
    if (height)
      Object.defineProperty(visualViewport, 'height', {
        configurable: true,
        value: height,
      })
    else delete (visualViewport as unknown as Record<string, unknown>).height
    visualViewport!.dispatchEvent(new Event('resize'))
  }, height)
}
for (const width of [320, 375, 390, 430, 820]) {
  test(`sequential navigation, fields, keyboard, dialogs and Back ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    await installWorkspaceFixture(page)
    let writes = 0
    await page.route('**/api/workspace*', (route) => {
      if (route.request().method() !== 'GET') writes++
      return route.fulfill({
        json: { workspace: demoData(), role: 'Owner', demo: false },
      })
    })
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await navigationFits(page, width)
    for (const section of [
      'Inventory/Ingredients',
      'Inventory/Counts',
      'Recipes',
      'Products/Kits',
      'Finance/Receipts',
      'Finance',
      'Settings',
    ]) {
      // Existing hash routing, in the same mounted application.
      await page.evaluate((section) => {
        location.hash = section
      }, section)
      await expect(page.locator('.app-shell')).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await navigationFits(page, width)
      await fieldsReadable(page)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1)
      const field = page
        .locator(
          'input:visible:not([type=checkbox]):not([type=radio]):not([type=color]), textarea:visible',
        )
        .first()
      if (await field.count()) {
        await field.focus()
        await keyboard(page, 340)
        if (width <= 700)
          await expect(page.locator('.mobile-bottom-nav')).toBeHidden()
        // Blurring before the keyboard finishes closing must not float the nav.
        await field.evaluate((el) => (el as HTMLElement).blur())
        if (width <= 700)
          await expect(page.locator('.mobile-bottom-nav')).toBeHidden()
        await keyboard(page)
        await navigationFits(page, width)
      }
      await page.getByRole('button', { name: 'Profile menu' }).click()
      await page.getByRole('menuitem', { name: 'Account & sign in' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await fieldsReadable(page)
      const b = (await dialog.boundingBox())!
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(width)
      await expect(
        dialog.getByRole('button', { name: 'Log out', exact: true }),
      ).toBeInViewport({ ratio: 1 })
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await navigationFits(page, width)
    }
    await page.goBack()
    await navigationFits(page, width)
    // Browser controls reduce the visual viewport modestly without a keyboard.
    await keyboard(page, 780)
    await navigationFits(page, width)
    await keyboard(page)
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(page.locator('.mobile-bottom-nav')).toBeHidden()
    await page.setViewportSize({ width, height: 844 })
    await navigationFits(page, width)
    expect(writes).toBe(0)
    if (width === 390)
      await page.screenshot({
        path: 'docs/reviews/mobile-session/navigation-390.png',
      })
  })
}
