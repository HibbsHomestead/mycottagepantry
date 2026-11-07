import { expect, it } from 'vitest'
import { isPackaging, selectPantryCategory } from './pantry-category'
import { ingredientCreateErrors } from './ingredient-create'
import { packageCost, updateIngredient } from './ingredients'

it('uses stable IDs and supports legacy packaging records without rewriting them', () => {
  expect(
    isPackaging({ categoryId: 'packaging', category: 'Renamed label' }),
  ).toBe(true)
  expect(isPackaging({ usedAs: 'packaging', category: 'Bags' })).toBe(true)
  expect(isPackaging({ category: 'Packaging' })).toBe(true)
  expect(
    isPackaging({ categoryId: 'flour-grains', category: 'Packaging' }),
  ).toBe(false)
})

it('defaults only new blank or untouched units and retains quantities, prices and declarations', () => {
  const draft = {
    purchaseUnit: 'lb',
    unit: 'g',
    purchaseQuantity: 100,
    packagePrice: 12,
    subingredients: 'Keep this',
    allergens: ['Wheat'],
    reviewed: true,
  }
  const next = selectPantryCategory(draft, 'packaging', false)
  expect(next).toMatchObject({
    ...draft,
    categoryId: 'packaging',
    usedAs: 'packaging',
    purchaseUnit: 'each',
    unit: 'each',
  })
  for (const existing of [false, true]) {
    const saved = selectPantryCategory(
      draft,
      'packaging',
      existing,
      new Set(['purchaseUnit', 'unit']),
    )
    expect(saved.purchaseUnit).toBe('lb')
    expect(saved.unit).toBe('g')
    expect(
      selectPantryCategory(saved, 'dairy-eggs', existing).subingredients,
    ).toBe('Keep this')
  }
  expect(
    selectPantryCategory(
      { purchaseUnit: '' },
      'packaging',
      false,
      new Set(['purchaseUnit']),
    ).purchaseUnit,
  ).toBe('each')
})

it('costs 100 individual bags at $0.12 and requires contents for case, box, pack and roll conversions', () => {
  const bags = {
    id: 'bags',
    name: 'Bags',
    categoryId: 'packaging',
    unit: 'each',
    purchaseQuantity: 100,
    purchaseUnit: 'each',
    packagePrice: 12,
  }
  expect(packageCost(bags).unitCost).toBe(0.12)
  expect(ingredientCreateErrors({ ...bags, name: '' }).name).toBe(
    'Enter a packaging name.',
  )
  expect(
    ingredientCreateErrors({ ...bags, categoryId: 'flour-grains', name: '' })
      .name,
  ).toBe('Enter an ingredient name.')
  for (const purchaseUnit of ['case', 'box', 'pack', 'roll']) {
    const boxed = { ...bags, purchaseUnit, purchaseQuantity: 1 }
    expect(() => packageCost(boxed)).toThrow(/verified.*conversion/)
    expect(ingredientCreateErrors(boxed)).toHaveProperty('purchaseUnit')
    const defined = {
      ...boxed,
      conversions: [
        {
          from: purchaseUnit,
          to: 'each',
          amountFrom: 1,
          amountTo: 100,
          verified: true,
        },
      ],
    }
    expect(packageCost(defined).unitCost).toBe(0.12)
    expect(ingredientCreateErrors(defined)).toEqual({})
  }
})

it('preserves existing costs, stock and food information across category changes and reopening', () => {
  const original = {
    id: 'bags',
    name: 'Bags',
    categoryId: 'packaging',
    usedAs: 'packaging',
    category: 'Packaging',
    unit: 'each',
    storageUnit: 'each',
    purchaseQuantity: 2,
    purchaseUnit: 'box',
    packagePrice: 24,
    cost: 0.11,
    currentCost: 0.13,
    quantity: 350,
    threshold: 10,
    subingredients: 'Stored statement',
    sourceContains: 'Contains Wheat',
    allergens: ['Wheat'],
    reviewed: true,
    conversions: [
      { from: 'box', to: 'each', amountFrom: 1, amountTo: 100, verified: true },
    ],
  }
  let saved = original
  for (const categoryId of ['flour-grains', 'packaging', 'packaging']) {
    saved = updateIngredient(saved, {
      ...saved,
      purchaseOffers: undefined,
      categoryId,
    }) as typeof original
    expect(saved).toMatchObject({
      ...original,
      categoryId,
      category: categoryId === 'packaging' ? 'Packaging' : 'Flour & grains',
      usedAs: categoryId === 'packaging' ? 'packaging' : 'ingredient',
    })
    expect(saved).not.toHaveProperty('costReferenceHistory')
  }
  expect(() =>
    updateIngredient(original, {
      ...original,
      name: '',
      purchaseOffers: undefined,
    }),
  ).toThrow('Packaging name is required.')
})
