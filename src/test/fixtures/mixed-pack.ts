import type { Item } from '../../lib/domain'
import { assortmentFixture } from './assortment'
import { confirmFixtureAllergens } from './label-ingredient-review'

export function mixedPackFixture() {
  const { workspace } = assortmentFixture()
  Object.assign(workspace.settings[0], { name: 'Fixture Bakery', address: '100 Example Lane · Fixture address' })
  const flour: Item = { id: 'mixed-flour', name: 'Muffin flour', unit: 'g', quantity: 10000, cost: 0.01, reviewed: true, allergens: ['Wheat'] }
  const berries: Item[] = ['Blueberry', 'Cranberry'].map((name, index) => ({ id: `mixed-berries-${index}`, name: name.toLowerCase() + ' fruit', unit: 'g', quantity: 10000, cost: 0.03 + index * 0.01, reviewed: true, allergens: index === 1 ? ['Milk'] : [] }))
  const container: Item = { id: 'mixed-container', name: 'six-count container', usedAs: 'packaging', unit: 'each', quantity: 25, cost: 0.6 }
  const labels: Item = { id: 'mixed-labels', name: 'Mixed pack labels', usedAs: 'packaging', unit: 'each', quantity: 25, cost: 0.1 }
  const wrap: Item = { id: 'mixed-wrap', name: 'Individual wrapper', usedAs: 'packaging', unit: 'each', quantity: 100, cost: 0.25 }
  const recipes: Item[] = ['Blueberry', 'Cranberry'].map((flavor, index) => ({
    id: `mixed-recipe-${index}`, name: `${flavor} muffin recipe`, yield: 12, yieldUnit: 'muffin', laborMinutes: 12, laborRate: 15, overhead: 1.2, packagingCost: index ? 0 : 1.2,
    lines: [{ ingredientId: flour.id, unit: 'g', quantity: 120 }, { ingredientId: berries[index].id, unit: 'g', quantity: 60 }],
  }))
  const outputs: Item[] = recipes.map((recipe, index) => ({
    id: `mixed-output-${index}`, name: index ? 'Cranberry muffins' : 'Blueberry muffins', workflow: 'food', unpackagedOutput: true,
    recipeId: recipe.id, unitsPerPackage: 1, contentUnit: 'muffin', packagingLines: [], quantity: 0, cost: 0, price: 0,
  }))
  const wrapped: Item = { ...outputs[0], id: 'mixed-wrapped', name: 'Wrapped blueberry muffin', unpackagedOutput: false, price: 5, packagingLines: [{ ingredientId: wrap.id, quantity: 1, unit: 'each' }] }
  const ingredients = [flour, ...berries, container, labels, wrap]
  const template = workspace.label_templates[0]
  const pack: Item = {
    id: 'mixed-six-pack-fixture', name: 'Blueberry + Cranberry Six-Pack', workflow: 'kit', assemblyType: 'mixed-pack',
    price: 18, quantity: 0, cost: 0, status: 'active', expectedContents: 6, sellingUnit: 'pack', assemblyMinutes: 1, assemblyRate: 12,
    kitComponents: outputs.map((output) => ({ productId: output.id, basis: 'unpackaged', contentUnit: 'muffin', quantity: 3 })),
    packagingLines: [{ ingredientId: container.id, unit: 'each', quantity: 1 }, { ingredientId: labels.id, unit: 'each', quantity: 2 }],
    mixedLabelStockId: labels.id, mixedLabelTemplateId: template.id,
  }
  workspace.ingredients.push(...ingredients)
  workspace.recipes.push(...recipes)
  workspace.products.push(...outputs, wrapped, pack)
  confirmFixtureAllergens(workspace, outputs[0], ['Wheat'])
  confirmFixtureAllergens(workspace, outputs[1], ['Wheat', 'Milk'])
  confirmFixtureAllergens(workspace, wrapped, ['Wheat'])
  return { workspace, pack, outputs, wrapped, ingredients, recipes, flour, container, labels, wrap, template }
}
