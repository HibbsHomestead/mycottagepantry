import { test, expect } from '@playwright/test'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import {
  SettingsWorkspace,
  settingsSections,
} from '../src/components/settings-workspace'
import { demoData } from '../src/lib/demo'

// Static component fixtures: no app session, API requests, or customer data.
const css = ['src/styles.css', 'src/workspace.css']
  .map((file) => readFileSync(file, 'utf8').replace(/^@import.*$/gm, ''))
  .join('\n')
for (const width of [1440, 768, 390, 320]) {
  test(`all Settings sections fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.route('**/*', (route) => route.abort())
    for (const section of settingsSections) {
      const markup = renderToStaticMarkup(
        <SettingsWorkspace
          workspace={demoData()}
          section={section}
          go={() => {}}
          open={() => {}}
          appearance={{ theme: 'plum', mode: 'light' }}
          preview={() => {}}
          saveAppearance={async () => {}}
          saveBusiness={async () => {}}
          exportData={() => {}}
          backup={() => {}}
          busy={false}
          canSave
          isOwner
        />,
      )
      await page.setContent(
        `<style>${css}\n*{box-sizing:border-box}body{margin:0;padding:16px} .fixture{max-width:1100px;margin:auto}</style><div class="fixture">${markup}</div>`,
      )
      const nav = page.getByRole('navigation', { name: 'Settings sections' })
      await expect(
        nav.getByRole('link', { name: 'Plan & billing' }),
      ).toBeVisible()
      const panel = await page.locator('.settings-content').boundingBox()
      const navigation = await nav.boundingBox()
      expect(panel).not.toBeNull()
      expect(navigation).not.toBeNull()
      if (width === 1440) {
        expect(panel!.x).toBeGreaterThan(navigation!.x + navigation!.width)
        expect(panel!.width).toBeGreaterThan(700)
        expect(Math.abs(panel!.y - navigation!.y)).toBeLessThan(2)
      } else if (width <= 390) {
        expect(panel!.y).toBeGreaterThanOrEqual(
          navigation!.y + navigation!.height,
        )
        expect(panel!.width).toBeGreaterThanOrEqual(width - 34)
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      const clipped = await page
        .locator(
          '.settings-content input, .settings-content select, .settings-content button',
        )
        .evaluateAll(
          (elements) =>
            elements.filter((el) => {
              const box = el.getBoundingClientRect()
              return box.width > 0 && (box.left < 0 || box.right > innerWidth)
            }).length,
        )
      expect(clipped).toBe(0)
      if (section === 'Units & Costing Defaults')
        await page.screenshot({
          path: `/tmp/settings-${width}.png`,
          fullPage: true,
        })
    }
  })
}
