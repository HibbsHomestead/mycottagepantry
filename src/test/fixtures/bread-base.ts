import { demoData, rollup } from '@/lib/demo'
import type { Item } from '@/lib/domain'

/** Synthetic bread quantities for linked-base verification; never customer data. */
export function breadBaseFixture() {
  const w = demoData()
  const raw = (
    id: string,
    name: string,
    quantity: number,
    cost: number,
    unit = 'g',
    extra = {},
  ): Item => ({
    id,
    name,
    quantity,
    cost,
    currentCost: cost,
    unit,
    storageUnit: unit,
    usedAs: 'ingredient',
    threshold: 0,
    reviewed: true,
    statement: name,
    allergens: [],
    conversions: [],
    ...extra,
  })
  w.ingredients = [
    raw('flour', 'Bread flour', 10000, 0.002, 'g', {
      allergens: ['Wheat'],
      subingredients: 'Wheat flour, malted barley flour',
      purchaseQuantity: 1000,
      purchaseUnit: 'g',
      packagePrice: 2,
    }),
    raw('water', 'Water', 10000, 0, 'ml'),
    raw('yeast', 'Yeast', 500, 0.01),
    raw('salt', 'Salt', 1000, 0.002),
    raw('spinach', 'Spinach', 1000, 0.005),
    raw('parmesan', 'Parmesan', 1000, 0.02, 'g', {
      allergens: ['Milk'],
      subingredients: 'Milk, cultures, salt, enzymes',
    }),
  ]
  w.recipes = [
    {
      id: 'bread',
      name: 'Homestyle White Bread',
      category: 'Breads',
      yield: 2,
      yieldUnit: 'loaves',
      laborMinutes: 20,
      laborRate: 18,
      overhead: 1,
      packagingCost: 9,
      lines: [
        { ingredientId: 'flour', quantity: 1000, unit: 'g' },
        { ingredientId: 'water', quantity: 600, unit: 'ml' },
        { ingredientId: 'yeast', quantity: 10, unit: 'g' },
        { ingredientId: 'salt', quantity: 20, unit: 'g' },
      ],
    },
    {
      id: 'spinach-parmesan',
      name: 'Spinach Parmesan',
      category: 'Breads',
      yield: 3,
      yieldUnit: 'loaves',
      laborMinutes: 5,
      laborRate: 18,
      overhead: 0.5,
      baseRecipeId: 'bread',
      baseMultiplier: 1,
      lines: [
        { ingredientId: 'spinach', quantity: 80, unit: 'g' },
        { ingredientId: 'parmesan', quantity: 50, unit: 'g' },
      ],
    },
  ]
  w.products = [
    {
      id: 'spinach-loaf',
      name: 'Spinach Parmesan loaf',
      recipeId: 'spinach-parmesan',
      price: 9,
      unitsPerPackage: 1,
      unpacked: true,
    },
  ]
  w.batches = []
  w.ledger = []
  w.journals = []
  rollup(w)
  return w
}
