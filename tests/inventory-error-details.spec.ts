import { test, expect } from '@playwright/test'
import { installWorkspaceFixture } from './workspace-fixture'

for (const width of [390, 1440]) {
  test(`Inventory fallback copy control ${width}px (controlled error)`, async ({
    page,
    context,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await installWorkspaceFixture(page)
    await page.route('**/api/workspace*', (route) =>
      route.fulfill({
        status: 503,
        headers: { 'x-nf-request-id': '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
        json: { error: 'PRIVATE_RESPONSE_SENTINEL' },
      }),
    )
    await page.route('**/oven?*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import("/src/test/capture-inventory-error.tsx").then(m=>m.mountInventoryErrorFixture())</script></body></html>',
      }),
    )
    await page.goto(
      'http://localhost:8889/oven?fixture=PRIVATE_QUERY_SENTINEL#Inventory/Overview?filter=PRIVATE_FILTER_SENTINEL',
    )
    await expect(
      page.getByRole('heading', { name: 'This page couldn’t load' }),
    ).toBeVisible()
    const details = page.locator('details')
    await expect(details).not.toHaveAttribute('open')
    await expect(
      page.getByRole('button', { name: 'Copy error details' }),
    ).toBeHidden()
    await page.screenshot({
      path: testInfo.outputPath(`collapsed-${width}.png`),
    })
    await page.locator('summary').click()
    await page.getByRole('button', { name: 'Copy error details' }).click()
    await expect(page.getByRole('status')).toHaveText('Error details copied.')
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    const report = JSON.parse(copied)
    expect(report.appVersion).toMatch(/^[a-f0-9]{64}$/)
    expect(report.pathname).toBe('/oven')
    expect(report.error.message).toBe(
      'A verified unit conversion from ml to lb is required.',
    )
    expect(report.error.stack).toContain(
      '/src/components/pantry-inventory.tsx:',
    )
    expect(report.error.componentStack).toContain('PantryInventory')
    expect(report.request).toEqual({
      path: '/api/workspace',
      status: 503,
      message: 'HTTP request failed (body omitted).',
      correlationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    })
    expect(copied).not.toMatch(
      /PRIVATE_|localhost|fixture-only|\?fixture|\?filter/,
    )
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`expanded-${width}.png`),
    })
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Go home' })).toBeVisible()
  })
}
