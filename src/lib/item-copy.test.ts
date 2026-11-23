import { expect, it } from 'vitest'
import { copyDefinition } from './item-copy'
import { demoData } from './demo'
it('copies recipe definition without owned output, history, IDs or mutable artwork', () => {
  const w = demoData()
  const source = {
    id: 'source',
    name: 'Prep',
    compound: true,
    yield: 8,
    yieldUnit: 'oz',
    baseRecipeId: 'base',
    baseMultiplier: 2,
    baseOverlapApproval: 'approved',
    lines: [{ ingredientId: 'shared', quantity: 1, unit: 'oz' }],
    overhead: 12,
    overheadMode: 'percent',
    wasteCost: 3,
    quantity: 12,
    sku: 'unique',
    squareCatalogId: 'external',
    audit: { date: 'old' },
    outputIngredientId: 'prep-source',
    instructions: 'Mix',
  }
  const draft = copyDefinition(source, 'recipes', w)
  expect(draft.id).not.toBe(source.id)
  expect(draft.name).toBe('Prep — Copy')
  expect(draft.lines).toEqual(source.lines)
  expect(draft.lines).not.toBe(source.lines)
  expect(draft).toMatchObject({
    baseRecipeId: 'base',
    baseMultiplier: 2,
    compound: true,
    yieldUnit: 'oz',
    overhead: 12,
    wasteCost: 3,
  })
  for (const key of [
    'quantity',
    'sku',
    'squareCatalogId',
    'audit',
    'outputIngredientId',
  ])
    expect(draft).not.toHaveProperty(key)
  draft.lines[0].quantity = 5
  expect(source.lines[0].quantity).toBe(1)
})
it.each(['food', 'handmade', 'resale', 'kit'])(
  'copies %s product settings with zero inventory and independent BOM',
  (workflow) => {
    const w = demoData()
    const source = {
      id: 'old',
      name: 'Product',
      workflow,
      quantity: 24,
      inventoryValue: 42,
      sku: 'SKU',
      barcode: '0123',
      recipeId: 'shared-recipe',
      kitComponents: [
        { productId: 'shared-product', quantity: 2, basis: 'package' },
      ],
      bom: {
        id: 'old-bom',
        version: 7,
        lines: [{ ingredientId: 'shared-material', quantity: 3, unit: 'each' }],
        output: 2,
        overhead: 4,
      },
      price: 19,
      productCategoryId: 'category',
      imageAssetId: 'mockup',
      mockupAssetIds: ['mockup'],
    }
    w.graphic_assets = []
    w.graphic_assets.push({
      id: 'mockup',
      name: 'Owned mockup',
      mockup: { layers: [] },
    })
    const draft = copyDefinition(source, 'products', w)
    expect(draft).toMatchObject({
      name: 'Product — Copy',
      quantity: 0,
      price: 19,
      productCategoryId: 'category',
    })
    for (const key of [
      'inventoryValue',
      'sku',
      'barcode',
      'mockupAssetIds',
      'imageAssetId',
    ])
      expect(draft).not.toHaveProperty(key)
    expect(draft.kitComponents).toEqual(source.kitComponents)
    if (workflow === 'handmade') {
      expect(draft.bom.id).not.toBe(source.bom.id)
      expect(draft.bom).not.toHaveProperty('version')
      draft.bom.lines[0].quantity = 7
      expect(source.bom.lines[0].quantity).toBe(3)
    } else expect(draft.recipeId).toBe('shared-recipe')
  },
)

it.each(['inherit', 'before', 'includes', 'saved-includes', undefined])(
  'preserves product price treatment on copy (%s)',
  (mode) => {
    const w = demoData()
    const copy = copyDefinition({ id: 'old', name: 'Original', price: 20, priceTaxMode: mode, priceTaxRevision: 'old-revision' }, 'products', w)
    expect(copy.priceTaxMode).toBe(mode ?? 'configured')
    expect(copy.priceTaxRevision).toBeUndefined()
    expect(copy.price).toBe(20)
  },
)
