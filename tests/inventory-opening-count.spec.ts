import { test, expect } from '@playwright/test'
import { inventoryPackageExamples } from './inventory-package-examples'
import { installInventoryPackageFixture } from './inventory-package-fixture'
import { workspaceFixtureUrl } from './workspace-fixture'

for (const width of [1440, 390]) {
  for (const example of inventoryPackageExamples) {
    test(`${example.name} opening count at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
      const workspace = await installInventoryPackageFixture(page)
      await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
      await page.getByRole('button', { name: 'Add Item', exact: true }).click()
      const editor = page.getByRole('dialog')
      await editor
        .getByLabel('Item Type', { exact: true })
        .selectOption(example.usedAs)
      await editor
        .getByLabel('Item name', { exact: true })
        .fill('Example ' + example.name)
      if (example.usedAs === 'material')
        await editor
          .getByLabel('Material Subtype')
          .selectOption(example.materialType)
      if (example.usedAs === 'material' && example.materialType === 'fabric') {
        await editor.getByRole('tab', { name: 'Fabric', exact: true }).click()
        await editor
          .getByLabel('Fabric tracking')
          .selectOption(example.fabricTracking)
        await editor.getByLabel('Fabric width', { exact: true }).fill('44')
      }
      await editor
        .getByRole('tab', { name: 'Purchase & Stock', exact: true })
        .click()
      if (example.usedAs === 'resale') {
        await editor.getByLabel('Sellable unit').selectOption(example.sellUnit)
        await editor
          .getByLabel('What’s inside one sealed pack? (optional)')
          .fill(example.packContents)
      }
      await editor
        .getByLabel('Purchase unit', { exact: true })
        .selectOption(example.purchaseUnit)
      await editor
        .getByLabel('Stock unit', { exact: true })
        .selectOption(example.unit)
      await editor
        .getByLabel('Amount in each package', { exact: true })
        .fill(String(example.amountPerPackage))
      await editor
        .getByLabel('Cost per package', { exact: true })
        .fill(String(example.packagePrice))
      await editor.getByLabel('Add what I already have on hand').check()
      await editor
        .getByLabel('Opening count', { exact: true })
        .fill(String(example.openingCount))
      await editor
        .getByLabel('Count unit', { exact: true })
        .selectOption(example.openingCountUnit)
      await expect(
        editor.getByText(
          `You’re adding ${example.stock} ${example.unit} to stock.`,
          { exact: true },
        ),
      ).toBeVisible()
      await expect(
        editor.getByText(
          `Suggested opening stock value: $${example.value.toFixed(2)}`,
          { exact: true },
        ),
      ).toBeVisible()
      await editor.getByRole('tab', { name: 'More', exact: true }).click()
      await editor
        .getByRole('tab', { name: 'Purchase & Stock', exact: true })
        .click()
      await expect(
        editor.getByLabel('Count unit', { exact: true }),
      ).toHaveValue(example.openingCountUnit)
      await expect(
        editor.getByLabel('Purchase unit', { exact: true }),
      ).toHaveValue(example.purchaseUnit)
      await expect(
        editor.getByLabel('Stock unit', { exact: true }),
      ).toHaveValue(example.unit)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1)
      const countBox = await editor
        .getByLabel('Opening count', { exact: true })
        .boundingBox()
      const unitBox = await editor
        .getByLabel('Count unit', { exact: true })
        .boundingBox()
      expect(Math.abs(countBox!.y - unitBox!.y)).toBeLessThan(1)
      await editor.screenshot({
        path: `docs/previews/inventory-${example.name}-${width}.png`,
      })
      await editor
        .getByRole('button', { name: 'Save item', exact: true })
        .click()
      await expect(editor).toHaveCount(0)
      const item = workspace[
        example.usedAs === 'resale' ? 'products' : 'ingredients'
      ].find((i) => i.name === 'Example ' + example.name)!
      expect(item.quantity).toBeCloseTo(example.base)
      expect(item.quantity * item.cost).toBeCloseTo(example.value)
      expect(
        workspace.ledger.filter(
          (l) => l.ingredientId === item.id || l.productId === item.id,
        ),
      ).toHaveLength(1)
      expect(
        workspace.journals.filter((j) => j.sourceId === item.id),
      ).toHaveLength(1)
    })
  }
}
