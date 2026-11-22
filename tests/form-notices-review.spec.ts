import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

const folder = 'docs/reviews/form-notices'
const viewports = [
  [1440, 900],
  [1024, 480],
  [390, 700],
]
for (const kind of ['ingredient', 'packaging', 'material', 'fabric'])
  for (const [width, height] of viewports) {
    test(`planner layout ${kind} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await installWorkspaceFixture(page)
      const workspace = demoData()
      const item = workspace.ingredients.find((i) => i.id === 'yeast')!
      item.name =
        'Isolated inventory layout record with a long descriptive name'
      item.notes = 'Long recorded notes for verification. '.repeat(30)
      item.usedAs = kind === 'fabric' ? 'material' : kind
      if (kind === 'fabric')
        Object.assign(item, {
          materialType: 'fabric',
          fabricTracking: 'length',
          fabricWidth: 44,
          widthUnit: 'in',
          unit: 'yd',
          storageUnit: 'yd',
          recipeUnit: 'yd',
          quantity: 12,
          cost: 2,
          threshold: 2,
          reorderQuantity: 3,
          conversions: [],
        })
      item.categoryId = ''
      item.category = ''
      item.trackInventory = true
      if (kind === 'packaging') {
        item.foodContact = true
      }
      if (kind !== 'material') {
        item.imageAssetId = 'review-photo'
        workspace.graphic_assets = [
          {
            id: 'review-photo',
            name: 'Isolated review photo',
            fileUrl: '/src/test/fixtures/photos/bread.jpg',
          },
        ]
      }
      workspace.recipes = Array.from({ length: 20 }, (_, index) => ({
        ...workspace.recipes[0],
        id: `review-use-${index}`,
        name: `Linked recipe ${index + 1}`,
        lines: [{ ingredientId: item.id, quantity: 1, unit: item.unit }],
      }))
      let writes = 0
      await page.route('**/api/workspace*', (route) => {
        if (route.request().method() !== 'GET') writes++
        return route.fulfill({
          json: { workspace, role: 'Owner', demo: false },
        })
      })
      await page.goto(
        workspaceFixtureUrl(
          `Inventory/${kind === 'ingredient' ? 'Ingredients' : kind === 'packaging' ? 'Packaging' : 'Craft Materials'}`,
        ),
      )
      await page
        .getByRole('textbox', { name: 'Search pantry' })
        .fill('Isolated inventory')
      await page
        .getByRole('button', { name: /^View details for Isolated/ })
        .click()
      const dialog = page.getByRole('dialog').last()
      await expect(dialog).toBeVisible()
      const phase = process.env.CAPTURE_PHASE || 'after'
      await page.screenshot({
        path: `${folder}/${phase}-${kind}-${width}.png`,
        animations: 'disabled',
      })
      if (phase === 'before') return
      const media = dialog.locator('.ingredient-detail-media')
      await expect(
        media.getByRole('heading', { name: 'Current stock' }),
      ).toBeVisible()
      expect(
        await media.evaluate((el) => {
          const photo = el
            .querySelector('.product-detail-photo')!
            .getBoundingClientRect()
          const stock = el
            .querySelector('[aria-label="Current stock"]')!
            .getBoundingClientRect()
          return stock.top - photo.bottom
        }),
      ).toBeLessThanOrEqual(20)
      const tabs = dialog.getByRole('tab')
      await expect(tabs).toHaveCount(4)
      for (let index = 0; index < 4; index++) {
        await tabs.nth(index).click()
        await expect(tabs.nth(index)).toHaveAttribute('aria-selected', 'true')
        if (index === 3 && kind !== 'fabric')
          await expect(
            dialog.getByRole('heading', { name: 'Recipe usage', exact: true }),
          ).toBeVisible()
        await page.screenshot({
          path: `${folder}/after-${kind}-${width}-tab-${index}.png`,
          animations: 'disabled',
        })
      }
      await tabs.first().click()
      for (const summary of [
        'Inventory ledger & purchase history',
        'Cost history',
      ])
        await dialog.locator('summary').filter({ hasText: summary }).click()
      expect(
        await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1)
      const scrolls = await dialog.evaluate((el) =>
        [el, ...el.querySelectorAll('*')]
          .filter(
            (child) =>
              ['auto', 'scroll'].includes(getComputedStyle(child).overflowY) &&
              child.scrollHeight > child.clientHeight + 1,
          )
          .map((child) => child.className),
      )
      expect(scrolls).toEqual(scrolls.length ? ['ingredient-detail-body'] : [])
      expect(writes).toBe(0)
    })
  }

for (const sticky of [true, false])
  for (const failure of ['server', 'network', 'permission', 'long']) {
    test(`submission ${sticky ? 'sticky' : 'ordinary'} ${failure} recovery`, async ({
      page,
    }) => {
      await page.setViewportSize(
        sticky ? { width: 390, height: 560 } : { width: 1024, height: 480 },
      )
      await installWorkspaceFixture(page)
      await page.route('**/notice-review', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import('/src/test/capture-form-notices.tsx').then(m=>m.mountFormNoticeReview(${sticky}))</script></body></html>`,
        }),
      )
      let requests = 0
      await page.route('**/api/review-submit', (route) => {
        requests++
        if (requests > 1) return route.fulfill({ json: { saved: true } })
        if (failure === 'network') return route.abort('failed')
        return route.fulfill({
          status: failure === 'permission' ? 403 : 409,
          json: {
            error:
              failure === 'permission'
                ? '403 Forbidden'
                : failure === 'long'
                  ? 'The name is already in use. Choose a unique name. '.repeat(
                      35,
                    )
                  : 'That name is already in use. Choose another name.',
          },
        })
      })
      await page.goto('http://localhost:8889/notice-review')
      if (sticky)
        await page.getByRole('tab', { name: /^Identification/ }).click()
      await page
        .getByRole('textbox', { name: 'Record name' })
        .fill('Preserved review record')
      await page
        .getByRole('textbox', { name: 'Notes', exact: true })
        .fill('Unsaved notes survive failure')
      await page
        .getByRole('button', { name: 'Save changes', exact: true })
        .click()
      const alert = page.getByRole('alert')
      await expect(alert).toBeVisible()
      await expect(
        page.getByRole('textbox', { name: 'Record name' }),
      ).toHaveValue('Preserved review record')
      await expect(
        page.getByRole('textbox', { name: 'Notes', exact: true }),
      ).toHaveValue('Unsaved notes survive failure')
      const save = page.getByRole('button', {
        name: 'Save changes',
        exact: true,
      })
      await expect(save).toBeEnabled()
      expect(
        (await save.boundingBox())!.y + (await save.boundingBox())!.height,
      ).toBeLessThanOrEqual(sticky ? 560 : 480)
      const geometry = await alert.evaluate((el) => {
        const style = getComputedStyle(el)
        return {
          background: style.backgroundColor,
          color: style.color,
          overflow: el.scrollWidth - el.clientWidth,
        }
      })
      expect(geometry.background).toBe('rgb(255, 241, 240)')
      expect(geometry.color).toBe('rgb(133, 35, 35)')
      expect(geometry.overflow).toBeLessThanOrEqual(1)
      await page.screenshot({
        path: `${folder}/error-${sticky ? 'sticky' : 'ordinary'}-${failure}.png`,
        animations: 'disabled',
      })
      await save.click()
      await expect(page.getByRole('status')).toHaveText('Saved successfully.')
      await expect(page.getByRole('alert')).toHaveCount(0)
      expect(requests).toBe(2)
    })
  }

test('invalid field in another tab and reset isolation', async ({ page }) => {
  await installWorkspaceFixture(page)
  await page.route('**/notice-review', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import('/src/test/capture-form-notices.tsx').then(m=>m.mountFormNoticeReview(true))</script></body></html>`,
    }),
  )
  await page.goto('http://localhost:8889/notice-review')
  await page.getByRole('tab', { name: /^Identification/ }).click()
  await page.getByRole('textbox', { name: 'Record name' }).fill('')
  await page.getByRole('tab', { name: 'Details', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(
    page.getByRole('tab', { name: /^Identification/ }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('textbox', { name: 'Record name' })).toBeFocused()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('tab', { name: /^Identification/ }).click()
  await expect(page.getByRole('textbox', { name: 'Record name' })).toHaveValue(
    'Different review record',
  )
})

test('stock flow cancel preserves the actual inventory detail tab', async ({
  page,
}) => {
  await installWorkspaceFixture(page)
  const workspace = demoData()
  await page.route('**/api/workspace*', (route) =>
    route.fulfill({ json: { workspace, role: 'Owner', demo: false } }),
  )
  await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
  await page.getByRole('textbox', { name: 'Search pantry' }).fill('yeast')
  await page
    .getByRole('button', {
      name: 'View details for Instant yeast',
      exact: true,
    })
    .click()
  const detail = page.locator('.ingredient-detail-view')
  await detail.getByRole('tab', { name: 'Purchasing', exact: true }).click()
  for (const name of ['Receive stock', 'Adjust stock']) {
    await detail.getByRole('button', { name, exact: true }).click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(detail).toBeVisible()
    await expect(
      detail.getByRole('tab', { name: 'Purchasing', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
  }
})
