import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
for (const width of [1440, 820, 390])
  test(`blocked deletion and red actions ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('http://localhost:8889/**', async (route) => {
      const response = await route.fetch({
        url: route.request().url().replace('localhost:8889', 'localhost:3000'),
      })
      await route.fulfill({ response })
    })
    await page.route('**/deletion-review', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import("/src/test/capture-deletion.tsx").then(m=>m.mountReview())</script></body></html>',
      }),
    )
    let deletes = 0
    await page.route('**/api/workspace*', async (route) => {
      const body = route.request().postDataJSON()
      if (body.action === 'itemDeleteCheck')
        return route.fulfill({
          json: {
            item: { id: body.data.id, name: body.data.expectedName },
            blockers:
              body.data.id === 'blocked-fixture'
                ? [
                    'This prep is linked to inventory ingredient Disposable output (ID: prep-blocked-fixture). Other recipe uses its prepared stock; historical records must be retained.',
                  ]
                : [],
            ownedOutput:
              body.data.id === 'unused-fixture'
                ? { id: 'prep-unused-fixture', name: 'Disposable output' }
                : null,
            canArchive: false,
          },
        })
      deletes++
      await new Promise((resolve) => setTimeout(resolve, 100))
      return route.fulfill({
        status: 409,
        json: { error: 'Fixture deletion failed. Item preserved.' },
      })
    })
    await page.goto('/deletion-review')
    const action = page.getByRole('button', {
      name: 'Delete Disposable linked prep',
      exact: true,
    })
    await expect(action).toHaveCSS('color', 'rgb(161, 38, 34)')
    await action.click()
    await expect(
      page.getByRole('heading', {
        name: 'Cannot delete Disposable linked prep',
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.getByRole('dialog')).toContainText(
      'ID: prep-blocked-fixture',
    )
    await expect(
      page.getByRole('button', { name: 'Delete', exact: true }),
    ).toBeDisabled()
    await mkdir('docs/reviews/deletion', { recursive: true })
    await page.screenshot({
      path: `docs/reviews/deletion/blocked-${width}.png`,
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(deletes).toBe(0)
    await page
      .getByRole('button', {
        name: 'Delete Disposable unused prep',
        exact: true,
      })
      .click()
    const final = page.getByRole('button', { name: 'Delete', exact: true })
    await expect(final).toBeEnabled()
    await expect(final).toHaveCSS('background-color', 'rgb(180, 35, 24)')
    await expect(final).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(page.getByRole('dialog')).toContainText('Disposable output')
    await final.dblclick()
    await expect(page.getByRole('alert')).toContainText('Item preserved')
    expect(deletes).toBe(1)
  })
