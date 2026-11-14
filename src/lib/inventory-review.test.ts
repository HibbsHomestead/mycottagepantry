import { expect, it } from 'vitest'
import { inventoryReviewReasons } from './inventory-review'
import { updateIngredient } from './ingredients'
import type { Item } from './domain'

const item = (patch: Partial<Item> = {}): Item => ({
  id: 'flour',
  name: 'Bread flour',
  usedAs: 'ingredient',
  unit: 'g',
  storageUnit: 'g',
  recipeUnit: 'g',
  quantity: 0,
  threshold: 2,
  cost: 0.01,
  currentCost: 0.01,
  purchaseQuantity: 1,
  purchaseUnit: 'bag',
  packagePrice: 5,
  conversions: [
    { from: 'bag', to: 'g', amountFrom: 1, amountTo: 500, verified: true },
  ],
  ...patch,
})

it('ignores stock, photos, optional fields, label review and unused conversion proposals', () => {
  const input = item({
    reviewed: false,
    imageAssetId: '',
    vendor: '',
    notes: '',
    conversions: [
      ...item().conversions,
      { from: 'cup', to: 'g', amountFrom: 1, amountTo: 120, verified: false },
    ],
  })
  const before = structuredClone(input)
  expect(inventoryReviewReasons(input)).toEqual([])
  expect(
    inventoryReviewReasons(item({ packagePrice: 0, currentCost: 0, cost: 0 })),
  ).toEqual([])
  expect(input).toEqual(before)
})

it('keeps import confirmation separate from cost and purchase setup, including legacy imports', () => {
  const imported = item({
    category: 'Imported — needs review',
    reviewed: true,
    purchaseQuantity: null,
    purchaseUnit: '',
    packagePrice: null,
    currentCost: null,
    cost: 0,
    needsCostSetup: true,
  })
  expect(inventoryReviewReasons(imported)).toEqual([
    'import',
    'purchase',
    'cost',
  ])
  expect(
    inventoryReviewReasons({
      ...imported,
      importNeedsReview: false,
      importReviewedAt: '2026-11-14T00:00:00Z',
    }),
  ).toEqual(['purchase', 'cost'])
  expect(inventoryReviewReasons(item({ importNeedsReview: true }))).toEqual([
    'import',
  ])
})

it('checks only required purchase, shelf, configured recipe and actual reference conversions', () => {
  const unverified = item({
    conversions: item().conversions.map((c: object) => ({
      ...c,
      verified: false,
    })),
  })
  expect(inventoryReviewReasons(unverified)).toEqual(['conversion'])
  expect(inventoryReviewReasons(item({ storageUnit: 'cup' }))).toEqual([
    'conversion',
  ])
  expect(inventoryReviewReasons(item({ recipeUnit: 'cup' }))).toEqual([
    'conversion',
  ])
  const usage = {
    recipes: [
      {
        id: 'bread',
        name: 'Bread',
        lines: [{ ingredientId: 'flour', quantity: 1, unit: 'cup' }],
      },
    ],
    products: [],
  }
  expect(inventoryReviewReasons(item(), usage)).toEqual(['conversion'])
  expect(
    inventoryReviewReasons(item(), {
      recipes: [
        {
          ...usage.recipes[0],
          lines: [{ ingredientId: 'other', quantity: 1, unit: 'cup' }],
        },
      ],
    }),
  ).toEqual([])
  expect(
    inventoryReviewReasons(item(), {
      products: [
        {
          id: 'p',
          name: 'Packaged bread',
          packagingLines: [
            { ingredientId: 'flour', quantity: 1, unit: 'each' },
          ],
        },
      ],
    }),
  ).toEqual(['conversion'])
  const verified = item({
    conversions: [
      ...item().conversions,
      { from: 'cup', to: 'g', amountFrom: 1, amountTo: 120, verified: true },
    ],
  })
  expect(inventoryReviewReasons(verified, usage)).toEqual([])
})

it('reuses the purchase-basis review and exempts produced preps from purchase requirements', () => {
  expect(
    inventoryReviewReasons(
      item({ purchaseQuantity: 5, purchaseUnit: 'lb', packagePrice: 6 }),
    ),
  ).toEqual(['purchase'])
  expect(
    inventoryReviewReasons(
      item({
        compoundRecipeId: 'prep',
        purchaseQuantity: null,
        purchaseUnit: '',
        packagePrice: null,
      }),
    ),
  ).toEqual([])
})

it('resolves validated setup without changing stock or marking imported data reviewed', () => {
  const missing = item({
    importNeedsReview: true,
    needsCostSetup: true,
    currentCost: null,
    purchaseUnit: '',
    purchaseQuantity: null,
    packagePrice: null,
    conversions: [],
  })
  const fixed = updateIngredient(missing, {
    threshold: 2,
    purchaseSetup: { packageUnit: 'bag', price: 5, stockUnits: 500 },
    purchaseSetupConfirmed: true,
  })
  expect(fixed.quantity).toBe(missing.quantity)
  expect(fixed.cost).toBe(missing.cost)
  expect(fixed.currentCost).toBe(0.01)
  expect(fixed.needsCostSetup).toBe(false)
  expect(inventoryReviewReasons(fixed)).toEqual(['import'])
})

it('uses fabric purchase validation without requiring ingredient count-to-length conversions', () => {
  const fabric = item({
    usedAs: 'material',
    materialType: 'fabric',
    fabricTracking: 'length',
    unit: 'yd',
    storageUnit: 'yd',
    recipeUnit: '',
    purchaseUnit: 'bolt',
    amountPerPackage: 10,
    purchaseQuantity: 1,
    packagePrice: 48,
    cost: 4.8,
    currentCost: 4.8,
    conversions: [],
  })
  expect(inventoryReviewReasons(fabric)).toEqual([])
  expect(inventoryReviewReasons({ ...fabric, amountPerPackage: null })).toEqual(
    ['purchase'],
  )
  expect(
    inventoryReviewReasons({
      ...fabric,
      parentMaterialId: 'parent',
      purchaseUnit: '',
      packagePrice: null,
    }),
  ).toEqual([])
})
