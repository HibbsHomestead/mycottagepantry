import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { updateIngredient } from '../src/lib/ingredients'
import type { Item } from '../src/lib/domain'
import { installWorkspaceFixture, workspaceFixtureUrl } from './workspace-fixture'

const output = 'docs/reviews/inventory-and-basket-editor'
const photo = (id: string, width: number, height: number) => ({
  id: `fixture-${id.toLowerCase().replaceAll(' ', '-')}`, name: id, category: 'product photo',
  fileUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#dce6d0"/><circle cx="50%" cy="50%" r="30%" fill="#be7c45"/><path d="M0 ${height}L${width} 0" stroke="#fff" stroke-width="5"/></svg>`)}`,
})

for (const width of [1440, 390]) {
  test(`inventory photo and restocking draft at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 790 : 960 })
    await installWorkspaceFixture(page)
    await mkdir(output, { recursive: true })
    const workspace = demoData()
    const ingredient = workspace.ingredients.find((item) => item.id === 'sugar')!
    Object.assign(ingredient, {
      name: 'Orange Finishing Sugar', reorderQuantity: 15, storageLocation: 'Dry pantry', imageAssetId: 'fixture-portrait-photo',
      purchaseQuantity: 5, purchaseUnit: 'lb', packagePrice: 4,
    })
    workspace.graphic_assets = [photo('Portrait photo', 200, 360), photo('Landscape photo', 480, 240), photo('Square photo', 300, 300)]
    let uploads = 0
    let saves = 0
    await page.route('**/api/workspace*', (route) => {
      if (route.request().url().includes('ingredientCategories')) return route.fulfill({ json: { categories: [], revision: 1 } })
      if (route.request().url().includes('upload=1')) {
        const asset = photo(`Uploaded photo ${++uploads}`, 260, 180)
        workspace.graphic_assets.push(asset)
        return route.fulfill({ json: { workspace, asset } })
      }
      if (route.request().method() === 'POST') {
        const { action, data } = route.request().postDataJSON()
        expect(action).toBe('ingredientUpdate')
        expect(data).not.toHaveProperty('reorderQuantity')
        Object.assign(ingredient, updateIngredient(ingredient, data))
        saves++
      }
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    await page.getByRole('textbox', { name: 'Search pantry' }).fill(ingredient.name)
    await page.getByRole('button', { name: `Edit ${ingredient.name}`, exact: true }).click()
    const dialog = page.getByRole('dialog')
    const stock = dialog.getByRole('tab', { name: 'Stock & Other Details' })
    await stock.click()
    await expect(dialog.getByLabel(/Reorder quantity/)).toHaveCount(0)
    await expect(dialog.getByLabel('Minimum order quantity', { exact: true })).toBeVisible()
    await dialog.getByLabel('Minimum order quantity', { exact: true }).fill('2')
    await dialog.getByLabel('Reorder when stock reaches').fill('8')
    await dialog.getByLabel('Where it’s stored').fill('Upper pantry')
    if (width === 1440) await dialog.screenshot({ path: `${output}/stock-details.png`, animations: 'disabled' })
    const photos = dialog.getByRole('tab', { name: 'Photos', exact: true })
    await photos.click()
    const preview = dialog.locator('.photo-box-picker').filter({ visible: true })
    const measure = async () => {
      const size = (await preview.boundingBox())!
      const panel = (await dialog.boundingBox())!
      expect(Math.abs(size.width - size.height)).toBeLessThan(1)
      expect(Math.abs(size.x + size.width / 2 - (panel.x + panel.width / 2))).toBeLessThan(12)
      if (width === 1440) expect(Math.abs(size.width - 400)).toBeLessThan(1)
      else expect(size.width).toBeLessThan(width)
    }
    await measure()
    const image = preview.locator('img')
    await expect(image).toHaveCSS('object-fit', 'contain')
    await dialog.screenshot({ path: `${output}/photos-${width}.png`, animations: 'disabled' })
    for (const [name, naturalWidth] of [['Landscape photo', 480], ['Square photo', 300]] as const) {
      await dialog.getByRole('button', { name: 'Photo options', exact: true }).click()
      await page.getByRole('menuitemradio', { name }).click()
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(naturalWidth)
      await measure()
    }
    await dialog.getByRole('button', { name: 'Remove photo', exact: true }).click()
    await expect(image).toHaveCount(0)
    await measure()
    for (const [index, name] of ['first.png', 'replacement.png'].entries()) {
      await dialog.getByLabel('Upload photo', { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from('fixture upload') })
      await expect.poll(() => uploads).toBe(index + 1)
      await expect(image).toHaveAttribute('src', /data:image\/svg/)
    }
    await stock.click()
    await expect(dialog.getByLabel('Where it’s stored')).toHaveValue('Upper pantry')
    await photos.click()
    await expect(image).toBeVisible()
    expect(await dialog.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect.poll(() => saves).toBe(1)
    expect(ingredient.reorderQuantity).toBe(15)
    expect(ingredient.storageLocation).toBe('Upper pantry')
    expect(ingredient.minimumOrderQuantity).toBe(2)
    expect(ingredient.imageAssetId).toBe('fixture-uploaded-photo-2')
    expect(uploads).toBe(2)
  })

  test(`all basket tabs fit and preserve the draft at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 790 : 960 })
    await installWorkspaceFixture(page)
    await mkdir(output, { recursive: true })
    const workspace = demoData()
    const component = workspace.products[0]
    const bag = workspace.ingredients.find((item) => item.id === 'bags')!
    const basket = {
      id: 'basket-editor-fixture', name: 'Market Morning Basket', workflow: 'kit', status: 'active', price: 15,
      kitComponents: [{ productId: component.id, quantity: 1, basis: 'package' }],
      packagingLines: [{ ingredientId: bag.id, quantity: 2, unit: bag.unit }],
    } as Item
    workspace.products.push(basket)
    await page.route('**/api/workspace*', (route) => {
      expect(route.request().method()).not.toBe('POST')
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Products/Kits'))
    await page.getByRole('article', { name: basket.name, exact: true }).getByRole('button', { name: basket.name, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Edit basket', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: /Basket · Market Morning/ })
    const save = dialog.getByRole('button', { name: 'Save basket', exact: true })
    for (const [tab, slug] of [['Contents & details', 'contents'], ['Packaging & cost', 'packaging'], ['Photo', 'photo']]) {
      await dialog.getByRole('tab', { name: tab, exact: true }).click()
      await expect(save).toBeInViewport()
      const rect = (await dialog.boundingBox())!
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1)
      if (width === 1440) expect(Math.abs(rect.width - 950)).toBeLessThan(1)
      expect(await dialog.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
      if (slug === 'packaging') {
        const quantity = dialog.getByRole('spinbutton', { name: /^Quantity/ })
        await expect(dialog.locator('.packaging-line-cost')).toContainText('Line cost')
        const original = await dialog.locator('.packaging-cost-total').textContent()
        await quantity.fill('3')
        await expect(dialog.locator('.packaging-cost-total')).not.toHaveText(original!)
      }
      await dialog.screenshot({ path: `${output}/basket-${slug}-${width}.png`, animations: 'disabled' })
    }
    await dialog.getByRole('tab', { name: 'Packaging & cost', exact: true }).click()
    await expect(dialog.getByRole('spinbutton', { name: /^Quantity/ })).toHaveValue('3')
  })

  test(`product packaging shows live row costs and total at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 790 : 960 })
    await installWorkspaceFixture(page)
    await mkdir(output, { recursive: true })
    const workspace = demoData()
    const bag = workspace.ingredients.find((item) => item.id === 'bags')!
    const product = workspace.products[0]
    Object.assign(bag, { cost: 0.003, currentCost: 0.003, needsCostSetup: false })
    Object.assign(product, { unpacked: false, packagingLines: [{ ingredientId: bag.id, quantity: 2, unit: 'each' }] })
    await page.route('**/api/workspace*', (route) => {
      expect(route.request().method()).not.toBe('POST')
      return route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Products/Food'))
    await page.getByRole('article', { name: product.name, exact: true }).getByRole('button', { name: product.name, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Edit Product', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const section = dialog.locator('.compact-packaging')
    const row = section.locator('.packaging-editor').first()
    await expect(row.locator('.packaging-line-cost')).toContainText('$0.003 / each')
    await row.getByRole('textbox', { name: 'Quantity' }).fill('10')
    await expect(section.locator('.packaging-cost-total')).toContainText('$0.03')
    await row.getByLabel('Unit').selectOption('ft')
    await expect(row.locator('.packaging-line-cost')).toContainText('Needs unit conversion')
    await expect(section.locator('.packaging-cost-total')).toContainText('Incomplete')
    await row.getByLabel('Unit').selectOption('each')
    await section.getByRole('button', { name: 'Add packaging item' }).click()
    const rows = section.locator('.packaging-editor')
    await expect(rows).toHaveCount(2)
    await rows.last().getByRole('button', { name: 'Remove packaging item' }).click()
    await expect(rows).toHaveCount(1)
    await expect(section.locator('.packaging-cost-total')).toContainText('$0.03')
    expect(await section.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
    await section.screenshot({ path: `${output}/product-packaging-${width}.png`, animations: 'disabled' })
  })
}
