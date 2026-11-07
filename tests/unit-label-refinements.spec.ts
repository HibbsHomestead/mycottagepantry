import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { recipeLineCost } from '../src/lib/recipe-line-cost'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`shows the four artwork samples in the picker and actual label renderer at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.route('**/artwork-style-fixture', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:'DM Sans';src:url('/label-fonts/dm-sans.ttf')}</style></head><body><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import('/src/test/capture-artwork-review.tsx').then(m=>m.mountArtworkReview())</script></body></html>`,
      }),
    )
    await page.goto('/artwork-style-fixture')
    const picker = page.getByRole('region', { name: 'Sample artwork picker' })
    await expect(picker.getByRole('button')).toHaveCount(4)
    await picker
      .getByRole('button', { name: 'Spiced orange', exact: true })
      .click()
    await expect(
      picker.getByRole('button', { name: 'Spiced orange', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await picker.getByRole('textbox').fill('swirl')
    await expect(picker.getByRole('button')).toHaveCount(1)
    await picker.getByRole('textbox').fill('')
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.images].map((i) => i.decode()))
    })
    await expect(page.locator('.review-paper > svg')).toHaveCount(4)
    await expect(
      page.getByText('Net Wt. 9.5oz (269g)', { exact: true }),
    ).toHaveCount(4)
    const paper = await page.locator('.review-paper').first().boundingBox()
    expect(paper!.width).toBe(288)
    expect(paper!.height).toBe(192)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: `docs/previews/artwork-style-review-${width}.png`,
      fullPage: true,
    })
    await page.emulateMedia({ media: 'print' })
    const printed = await page.locator('.review-paper').first().boundingBox()
    expect(printed!.width).toBe(paper!.width)
    expect(printed!.height).toBe(paper!.height)
  })

  test(`updates compact ingredient costs in create and edit recipe at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    let writes = 0
    await page.route('**/api/workspace*', (route) => {
      if (route.request().method() === 'POST') writes++
      return route.fulfill({ json: { workspace, role: 'Owner', demo: true } })
    })
    await page.goto(workspaceFixtureUrl('Recipes'))
    await page
      .getByRole('button', { name: 'Create recipe', exact: true })
      .first()
      .click()
    let dialog = page.getByRole('dialog')
    const row = dialog.locator('.recipe-line-editor').first()
    await expect(row.locator('.recipe-line-cost')).toBeVisible()
    await row.getByLabel('Ingredient quantity').fill('100')
    const ingredientId = await row
      .getByLabel('Ingredient 1', { exact: true })
      .inputValue()
    const unit = await row
      .getByLabel('Recipe unit', { exact: true })
      .inputValue()
    await expect(row.locator('.recipe-line-cost')).toHaveText(
      recipeLineCost(
        { ingredientId, quantity: 100, unit },
        workspace.ingredients,
      ).text,
    )
    await row.getByLabel('Recipe unit').selectOption('cup')
    await expect(row.locator('.recipe-line-cost')).toContainText(
      'Cost unavailable',
    )
    await row.getByLabel('Recipe unit').selectOption('g')
    await row.getByLabel('Ingredient quantity').fill('0.001')
    await expect(row.locator('.recipe-line-cost')).toHaveText('<$0.01')
    await row.getByLabel('Ingredient quantity').fill('200')
    await page.screenshot({
      path: `docs/previews/recipe-line-cost-create-${width}.png`,
    })
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true)
    // A fresh fixture navigation leaves the unsaved create form without posting it.
    page.on('dialog', (message) => message.accept())
    await page.goto(workspaceFixtureUrl('Recipes'))
    await page
      .locator('.recipe-card')
      .filter({
        has: page.getByRole('heading', {
          name: workspace.recipes[0].name,
          exact: true,
        }),
      })
      .click()
    await page.getByRole('button', { name: 'Edit Recipe', exact: true }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.locator('.recipe-line-cost')).toHaveCount(
      workspace.recipes[0].lines.length,
    )
    await dialog.locator('.recipe-line-editor').first().scrollIntoViewIfNeeded()
    await page.screenshot({
      path: `docs/previews/recipe-line-cost-edit-${width}.png`,
    })
    expect(writes).toBe(0)
  })
}
