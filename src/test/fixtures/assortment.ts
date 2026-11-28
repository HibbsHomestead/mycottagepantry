import { demoData } from '../../lib/demo'
import { blankLabel } from '../../lib/label-studio'
import type { AssortmentSpec } from '../../lib/assortment-labels'
import type { Item } from '../../lib/domain'
import { confirmFixtureAllergens } from './label-ingredient-review'

export function assortmentFixture() {
  const workspace = demoData()
  const flavors = ['Blueberry', 'Chocolate', 'Lemon'].map((name, index) => ({
    id: name.toLowerCase(),
    name: `${name} muffins`,
    workflow: 'food',
    recipeId: `recipe-${name}`,
    price: 6,
    unitsPerPackage: 2,
    sellingUnit: 'muffin pack',
    stockCostKnown: true,
    cost: 8,
    quantity: 20,
    packagingLines: [{ ingredientId: 'wrap', quantity: 1, unit: 'each' }],
    ingredient: {
      id: `input-${index}`,
      name: `${name} blend`,
      statement: `${name} blend`,
      subingredients: index === 1 ? 'cocoa, chips (sugar, milk)' : index === 0 ? 'Blueberries, flour' : 'Lemon, flour',
      requiresSubingredients: index === 1,
      allergens: index === 1 ? ['Milk'] : ['Wheat'],
      reviewed: true,
      unit: 'g',
      cost: (index + 1) / 20,
      quantity: 100,
    },
  }))
  const craft: Item = {
    id: 'tea-towel',
    name: 'Tea towel',
    workflow: 'handmade',
    cost: 3,
    price: 9,
    quantity: 10,
    stockCostKnown: true,
    bom: {
      output: 1,
      laborMinutes: 3,
      laborRate: 20,
      overhead: 0.5,
      scrapPercent: 0,
      lines: [{ ingredientId: 'cotton', quantity: 1, unit: 'each' }],
    },
  }
  const tea: Item = {
    id: 'tea',
    name: 'Tea tin',
    workflow: 'resale',
    stockCostKnown: true,
    cost: 2,
    price: 7,
    quantity: 4,
  }
  const basket: Item = {
    id: 'breakfast-fixture',
    name: 'Breakfast Basket (fixture)',
    workflow: 'kit',
    sellingUnit: 'kit',
    status: 'active',
    price: 24,
    assemblyMinutes: 6,
    assemblyRate: 20,
    packagingLines: [{ ingredientId: 'box', quantity: 1, unit: 'each' }],
    kitComponents: [flavors[0], craft, tea].map((product, index) => ({
      productId: product.id,
      quantity: index ? 1 : 2,
      basis: 'package',
    })),
  }
  workspace.ingredients = [
    ...flavors.map((flavor) => flavor.ingredient),
    {
      id: 'wrap',
      name: 'Individual wrap',
      unit: 'each',
      usedAs: 'packaging',
      quantity: 15,
      cost: 0.25,
    },
    {
      id: 'box',
      name: 'Outer box',
      unit: 'each',
      usedAs: 'packaging',
      quantity: 14,
      cost: 1,
    },
    {
      id: 'stock',
      name: 'Paper labels',
      unit: 'each',
      usedAs: 'packaging',
      quantity: 13,
      cost: 0.1,
    },
    {
      id: 'cotton',
      name: 'Cotton blank',
      unit: 'each',
      usedAs: 'material',
      quantity: 12,
      cost: 1.5,
    },
  ]
  workspace.recipes = flavors.map((flavor) => ({
    id: flavor.recipeId,
    name: flavor.name,
    yield: 6,
    yieldUnit: 'muffins',
    laborMinutes: 0,
    laborRate: 0,
    overhead: 0,
    lines: [{ ingredientId: flavor.ingredient.id, quantity: 60, unit: 'g' }],
  }))
  workspace.products = [...flavors, craft, tea, basket]
  flavors.forEach((product, index) => confirmFixtureAllergens(workspace, product, index === 1 ? ['Milk'] : ['Wheat']))
  workspace.batches = [
    {
      id: 'fixture-run',
      productionVersion: 2,
      name: 'Breakfast packing run',
      status: 'scheduled',
      lines: [
        {
          id: 'outer-line',
          productId: basket.id,
          quantity: 5,
          definition: { product: structuredClone(basket) },
        },
      ],
    },
  ]
  workspace.label_templates = [
    {
      ...blankLabel(),
      id: 'larger-stock',
      name: 'Four by six',
      width: 288,
      height: 432,
    },
    {
      ...blankLabel(),
      id: 'small-stock',
      name: 'Tiny stock',
      width: 72,
      height: 54,
    },
  ]
  workspace.label_print_jobs = []
  const spec: AssortmentSpec = {
    name: 'Mixed muffin box',
    batchId: '',
    productId: '',
    group: '',
    templateId: 'larger-stock',
    packagingId: 'stock',
    mode: 'fixed',
    expectedLoose: 6,
    expectedPackages: 0,
    containers: 2,
    copies: 2,
    componentId: '',
    lines: flavors.map((flavor) => ({
      productId: flavor.id,
      quantity: 2,
      unit: 'loose',
    })),
  }
  return { workspace, flavors, craft, tea, basket, spec }
}
