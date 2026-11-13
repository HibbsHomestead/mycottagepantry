import { test, expect, type Page } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { accessFixture } from './account-access-fixture'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

async function bounds(page: Page) {
  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toBeVisible()
  await expect
    .poll(async () => {
      const b = (await dialog.boundingBox())!
      const v = page.viewportSize()!
      return (
        b.x >= 0 &&
        b.y >= 0 &&
        b.x + b.width <= v.width + 1 &&
        b.y + b.height <= v.height + 1
      )
    })
    .toBe(true)
  // Inspect settled geometry as well as the initial position.
  for (const delay of [0, 300]) {
    if (delay) await page.waitForTimeout(delay)
    const b = (await dialog.boundingBox())!
    const v = page.viewportSize()!
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.y).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(v.width + 1)
    expect(b.y + b.height).toBeLessThanOrEqual(v.height + 1)
  }
  await expect(dialog).not.toHaveClass(/translate-[xy]-|zoom-in|zoom-out/)
  expect(
    await page.evaluate(() => document.body.hasAttribute('data-scroll-locked')),
  ).toBe(true)
  expect(
    await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1)
  // Scroll each control into view: bounds of the shell alone cannot prove reachability.
  for (const control of await dialog
    .locator('button:visible, input:visible, select:visible, textarea:visible')
    .all()) {
    await control.scrollIntoViewIfNeeded()
    const b = (await control.boundingBox())!
    const v = page.viewportSize()!
    expect(b.y).toBeGreaterThanOrEqual(-1)
    expect(b.y + b.height).toBeLessThanOrEqual(v.height + 1)
  }
  return dialog
}

for (const [width, height] of [
  [390, 844],
  [844, 390],
  [820, 1180],
  [1440, 900],
]) {
  test(`Quick Add popup families ${width}x${height}`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width, height })
    await installWorkspaceFixture(page)
    const workspace = demoData(),
      original = JSON.stringify(workspace)
    const member = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Fixture',
      role: 'Owner',
    }
    await page.route('**/api/account-access*', (r) =>
      r.fulfill({
        json: accessFixture('workspace', {
          membership: member,
          memberships: [member],
        }),
      }),
    )
    let writes = 0
    await page.route('**/api/workspace*', (r) => {
      if (r.request().method() !== 'GET') writes++
      return r.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(
      process.env.POPUP_TEST_ORIGIN
        ? process.env.POPUP_TEST_ORIGIN + '/oven#Dashboard'
        : workspaceFixtureUrl('Dashboard'),
    )
    for (const name of [
      'Start batch run',
      'Receive stock',
      'Create recipe',
      'Create product',
      'Record a sale',
      'Record an expense',
      'Create purchase order',
      'Add Item',
      'Import recipe',
    ]) {
      for (let repeat = 0; repeat < 2; repeat++) {
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight),
        )
        await page
          .getByRole('button', { name: 'Quick Add', exact: true })
          .click()
        await page.getByRole('menuitem', { name, exact: true }).click()
        const dialog = await bounds(page)
        if (name === 'Start batch run') {
          await dialog
            .getByRole('button', { name: 'Save batch', exact: true })
            .scrollIntoViewIfNeeded()
          await expect(
            dialog.getByRole('button', { name: 'Save batch', exact: true }),
          ).toBeVisible()
        }
        const field = dialog
          .locator('input:visible:not([type=checkbox]):not([type=radio])')
          .first()
        if (await field.count()) {
          await field.focus()
          if (width <= 844) {
            // Resize models available viewport loss; it is not a physical keyboard test.
            await page.setViewportSize({
              width,
              height: Math.max(300, height - 240),
            })
            await bounds(page)
            await field.blur()
            await page.setViewportSize({ width, height })
            await bounds(page)
          }
        }
        await dialog
          .getByRole('button', { name: 'Close', exact: true })
          .last()
          .click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }
    }
    await page.getByRole('button', { name: 'Profile menu' }).click()
    await page.getByRole('menuitem', { name: 'Account & sign in' }).click()
    const confirmation = await bounds(page)
    await expect(
      confirmation.getByRole('heading', { name: 'Log out of Cottage Pantry?' }),
    ).toBeVisible()
    await confirmation
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(writes).toBe(0)
    expect(JSON.stringify(workspace)).toBe(original)
  })
}
