import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

test('quick actions retain targets, names, tooltips and theme styling', async ({
  page,
}) => {
  test.setTimeout(180000)
  await installWorkspaceFixture(page)
  const w = demoData()
  await page.route('**/api/workspace*', (route) =>
    route.fulfill({ json: { workspace: w, role: 'Owner', demo: true } }),
  )
  const names = [
    'Add Item',
    'Add product',
    'Receive stock',
    'Start production',
    'Open Label Studio',
  ]
  for (const mode of ['light', 'dark'] as const) {
    w.settings[0].appearance = { theme: 'cottage', mode }
    for (const width of [1440, 390, 375, 320, 280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('about:blank')
      await page.goto(workspaceFixtureUrl())
      const group = page.locator('.dashboard-quick-actions')
      await expect(group.getByRole('button')).toHaveCount(5)
      await expect(page.locator('html')).toHaveAttribute('data-mode', mode)
      const boxes = []
      for (const name of names) {
        const button = group.getByRole('button', { name, exact: true })
        await expect(button).toBeVisible()
        expect(await button.textContent()).toBe('')
        const box = (await button.boundingBox())!
        expect(box.width).toBe(48)
        expect(box.height).toBe(48)
        boxes.push(box)
      }
      if (width >= 375) expect(new Set(boxes.map((b) => b.y)).size).toBe(1)
      expect(
        await group.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true)
      await group.getByRole('button', { name: names[1], exact: true }).hover()
      await expect(
        page.getByRole('tooltip', { name: names[1], exact: true }),
      ).toBeVisible()
      await page.mouse.move(0, 0)
      await group.getByRole('button', { name: names[0], exact: true }).focus()
      for (const name of names) {
        const button = group.getByRole('button', { name, exact: true })
        await expect(button).toBeFocused()
        await expect(
          page.getByRole('tooltip', { name, exact: true }),
        ).toBeVisible()
        expect(
          await button.evaluate((el) => getComputedStyle(el).outlineStyle),
        ).toBe('solid')
        await page.keyboard.press('Escape')
        await page.keyboard.press('Tab')
      }
      await expect(page.getByRole('tooltip')).toHaveCount(0)
      if (width === 390 || width === 1440)
        await page.screenshot({
          path: `/tmp/quick-actions-${mode}-${width}.png`,
        })
      await page.evaluate(
        () => (document.documentElement.style.fontSize = '32px'),
      )
      for (const button of await group.getByRole('button').all()) {
        const box = (await button.boundingBox())!
        expect(box.width).toBe(48)
        expect(box.height).toBe(48)
      }
      expect(
        await group.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true)
    }
  }
  await page.goto('about:blank')
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
