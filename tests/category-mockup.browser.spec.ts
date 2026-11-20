import { demoData } from '../src/lib/demo'
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
for (const width of [1440, 820, 390])
  test(`mockup confirmation and layered category draft ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.route('http://localhost:8889/**', async (route) => {
      const response = await route.fetch({
        url: route.request().url().replace('localhost:8889', 'localhost:3000'),
      })
      await route.fulfill({ response })
    })
    await page.route('**/category-mockup-review', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import("/src/test/capture-category-mockup.tsx").then(m=>m.mountReview())</script></body></html>',
      }),
    )
    await page.route('**/api/workspace*', (route) =>
      route.fulfill({
        status: route.request().url().includes('deleteMockup') ? 409 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          route.request().url().includes('deleteMockup')
            ? { error: 'Fixture failure. Retry deletion.' }
            : {
                categories: [
                  {
                    id: 'current',
                    name: 'Disposable category',
                    active: true,
                    icon: 'other',
                  },
                ],
                revision: 1,
              },
        ),
      }),
    )
    await page.goto('/category-mockup-review')
    await page
      .getByRole('button', { name: 'Delete mockup', exact: true })
      .click()
    const confirmation = page.getByRole('dialog')
    await expect(
      confirmation.getByRole('button', { name: 'Delete mockup', exact: true }),
    ).toHaveCSS('background-color', 'rgb(180, 35, 24)')
    await expect(confirmation).toContainText('Disposable front view')
    await expect(confirmation).toContainText(
      'removed without selecting a replacement',
    )
    await confirmation
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    await expect(
      page.getByText('Disposable front view', { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Delete mockup', exact: true })
      .click()
    await confirmation
      .getByRole('button', { name: 'Delete mockup', exact: true })
      .click()
    await expect(confirmation.getByRole('alert')).toContainText(
      'Retry deletion',
    )
    await confirmation
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    await page.route('**/api/workspace?deleteMockup=1', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          workspace: { ...demoData(), graphic_assets: [] },
        }),
      }),
    )
    await page
      .getByRole('button', { name: 'Delete mockup', exact: true })
      .click()
    await confirmation
      .getByRole('button', { name: 'Delete mockup', exact: true })
      .click()
    await expect(
      page.getByText('Disposable front view', { exact: true }),
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Edit recipe', exact: true }).click()
    await page
      .getByRole('textbox', { name: 'Recipe name' })
      .fill('Unsaved survives')
    await page
      .getByRole('combobox', { name: 'Category', exact: true })
      .selectOption('current')
    await page
      .getByRole('button', { name: 'Add category', exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Add recipe category', exact: true }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('textbox', { name: 'Recipe name' }),
    ).toHaveValue('Unsaved survives')
    await expect(
      page.getByRole('combobox', { name: 'Category', exact: true }),
    ).toHaveValue('current')
    await expect(
      page.getByRole('button', { name: 'Add category', exact: true }),
    ).toBeFocused()
    await mkdir('docs/reviews/category-mockup', { recursive: true })
    await page.screenshot({
      path: `docs/reviews/category-mockup/compact-${width}.png`,
      fullPage: true,
    })
  })
