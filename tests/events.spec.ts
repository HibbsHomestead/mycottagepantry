import { expect, test } from '@playwright/test'
import { installWorkspaceFixture } from './workspace-fixture'
import { accentThemes } from '../src/lib/appearance'
async function install(page: import('@playwright/test').Page) {
  await installWorkspaceFixture(page)
  await page.route('**/event-review*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import("/src/test/capture-events.tsx").then(m=>m.mountEventsFixture())</script></body></html>',
    }),
  )
}
for (const width of [1440, 390])
  test(`event views and popup remain usable in all light/dark themes at ${width}`, async ({
    page,
  }) => {
    await install(page)
    await page.setViewportSize({ width, height: 1000 })
    for (const theme of accentThemes)
      for (const mode of ['light', 'dark']) {
        await page.goto(
          `/event-review?theme=${theme.id}&mode=${mode}#Events/Month`,
        )
        await expect(
          page.getByRole('heading', { name: 'Events & Pickup Days' }),
        ).toBeVisible()
        await expect(
          page.locator('.event-chip').filter({ visible: true }).first(),
        ).toBeVisible()
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true)
        await page
          .locator('.event-chip')
          .filter({ visible: true })
          .filter({ hasText: 'Harvest market' })
          .first()
          .click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        const bounds = await dialog.boundingBox()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.width).toBeLessThanOrEqual(width)
        await dialog
          .getByRole('button', { name: 'Sales & financials', exact: true })
          .click()
        await expect(
          dialog.getByRole('heading', { name: 'Event financial results' }),
        ).toBeVisible()
        await expect(
          dialog.getByText('Incomplete financial results'),
        ).toBeVisible()
        expect(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true)
        const font = await dialog
          .locator('dt')
          .first()
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
        expect(font).toBeGreaterThanOrEqual(16)
        if (
          (theme.id === 'cottage' && mode === 'light') ||
          (theme.id === 'orchard' && mode === 'dark')
        )
          await page.screenshot({
            path: `docs/reviews/events/financials-${theme.id}-${mode}-${width}.png`,
            animations: 'disabled',
          })
        await page.keyboard.press('Escape')
        await expect(dialog).not.toBeVisible()
      }
    for (const view of ['List', 'Week', 'Day', 'Month']) {
      await page.getByRole('link', { name: view, exact: true }).click()
      await expect(
        page.getByRole('link', { name: view, exact: true }),
      ).toHaveAttribute('aria-current', 'page')
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
    }
  })
test('event editing, CSV export and print report use the current event records', async ({
  page,
}) => {
  await install(page)
  await page.goto('/event-review?theme=orchard&mode=dark#Events/List')
  await page
    .getByRole('button', {
      name: 'Harvest market and neighborhood pantry gathering',
      exact: true,
    })
    .click()
  await page.getByRole('button', { name: 'Edit event' }).click()
  await page
    .getByRole('textbox', { name: 'Event name' })
    .fill('Revised harvest market')
  await page.getByRole('button', { name: 'Save event' }).click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName(
    'Revised harvest market',
  )
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toBe('event-market.csv')
  await download.saveAs('docs/reviews/events/synthetic-event-report.csv')
  await page.evaluate(() => {
    window.print = () => {}
  })
  await page.getByRole('button', { name: 'Print report' }).click()
  await page.emulateMedia({ media: 'print' })
  await expect(
    page.getByRole('heading', { name: 'Revised harvest market', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Event financial results' }),
  ).toBeVisible()
  await expect(page.locator('.event-financial-report h3').first()).toHaveCSS(
    'color',
    'rgb(34, 34, 34)',
  )
  await page.pdf({
    path: 'docs/reviews/events/synthetic-event-report.pdf',
    format: 'A4',
    printBackground: true,
  })
})
