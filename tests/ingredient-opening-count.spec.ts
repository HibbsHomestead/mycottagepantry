import { test, expect } from '@playwright/test'
import { convert, type Item } from '../src/lib/domain'
import { workspaceFixtureUrl } from './workspace-fixture'
import { installInventoryPackageFixture } from './inventory-package-fixture'

// Synthetic records only. Exercise the real form and its creation handler.
for (const width of [1440, 390]) {
  for (const example of [
    {
      name: 'unopened-bag',
      count: '1',
      countUnit: 'bag',
      quantity: 2,
      value: 3,
    },
    {
      name: 'opened-bag',
      count: '1',
      countUnit: 'lb',
      quantity: 1,
      value: 1.5,
    },
    {
      name: 'no-opening-stock',
      count: '',
      countUnit: '',
      quantity: 0,
      value: 0,
    },
  ]) {
    test(`${example.name} ingredient example at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 })
      const workspace = await installInventoryPackageFixture(page)
      await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
      await page.getByRole('button', { name: 'Add Item', exact: true }).click()
      const editor = page.getByRole('dialog')
      await editor
        .getByLabel('Item Type', { exact: true })
        .selectOption('ingredient')
      await editor
        .getByLabel('Item name', { exact: true })
        .fill('Example flour')
      await editor
        .getByRole('tab', { name: 'Purchase & Stock', exact: true })
        .click()
      await editor
        .getByLabel('Purchase unit', { exact: true })
        .selectOption('bag')
      await editor.getByLabel('Cost per package', { exact: true }).fill('3.00')
      await editor.getByLabel('Stock unit', { exact: true }).selectOption('lb')
      await editor
        .getByLabel('Amount in each package', { exact: true })
        .fill('2')
      await expect(
        editor.getByText('1 bag = 2 lb', { exact: true }),
      ).toBeVisible()
      await expect(
        editor.getByText('Cost per lb: $1.50', { exact: true }),
      ).toBeVisible()
      if (example.count) {
        await editor.getByLabel('Add what I already have on hand').check()
        await editor
          .getByLabel('Opening count', { exact: true })
          .fill(example.count)
        await editor
          .getByLabel('Count unit', { exact: true })
          .selectOption(example.countUnit)
        await expect(
          editor.getByText(`You’re adding ${example.quantity} lb to stock.`, {
            exact: true,
          }),
        ).toBeVisible()
        await expect(
          editor.getByText(
            `Suggested opening stock value: $${example.value.toFixed(2)}`,
            { exact: true },
          ),
        ).toBeVisible()
      } else {
        await expect(
          editor.getByLabel('Add what I already have on hand'),
        ).not.toBeChecked()
        await expect(
          editor.getByLabel('Opening count', { exact: true }),
        ).toHaveCount(0)
      }
      // Switching tabs preserves all package and count inputs.
      await editor.getByRole('tab', { name: 'Details', exact: true }).click()
      await editor
        .getByRole('tab', { name: 'Purchase & Stock', exact: true })
        .click()
      await expect(
        editor.getByLabel('Purchase unit', { exact: true }),
      ).toHaveValue('bag')
      await expect(
        editor.getByLabel('Stock unit', { exact: true }),
      ).toHaveValue('lb')
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1)
      await editor.screenshot({
        path: `docs/previews/ingredient-${example.name}-${width}.png`,
      })
      await editor
        .getByRole('button', { name: 'Save item', exact: true })
        .click()
      await expect(editor).toHaveCount(0)
      const saved = workspace.ingredients.find(
        (i: Item) => i.name === 'Example flour',
      )!
      expect(saved).toBeDefined()
      expect(
        convert(saved.quantity, saved.unit, 'lb', saved.conversions),
      ).toBeCloseTo(example.quantity)
      expect(saved.quantity * saved.cost).toBeCloseTo(example.value)
      expect(
        workspace.ledger.filter((i: Item) => i.ingredientId === saved.id),
      ).toHaveLength(example.count ? 1 : 0)
      expect(
        workspace.journals.filter((i: Item) => i.sourceId === saved.id),
      ).toHaveLength(example.count ? 1 : 0)
    })
  }
}
