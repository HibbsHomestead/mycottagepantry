import { describe, expect, it } from 'vitest'
import {
  convert,
  costBreakdown,
  normalizeUnit,
  parseQuantity,
  units,
  ingredientUnits,
} from './domain'
import { packageCost } from './ingredients'
import { ingredientCreateErrors } from './ingredient-create'
import { parseIngredient } from './recipe-import'

describe('central measurement registry', () => {
  it('uses authoritative US liquid definitions and retains existing factors', () => {
    for (const [unit, amount] of [
      ['quart', 4],
      ['pint', 8],
      ['cup', 16],
      ['fl oz', 128],
      ['l', 3.785411784],
    ] as const)
      expect(convert(1, 'gallon', unit)).toBeCloseTo(amount, 12)
    expect(convert(1000, 'mg', 'g')).toBe(1)
    expect(units.oz.factor).toBe(28.349523125)
    expect(units.cup.factor).toBe(236.5882365)
  })
  it('costs a gallon purchase in recipe cups without mutating saved records', () => {
    const ingredient = {
      id: 'milk',
      name: 'Milk',
      unit: 'cup',
      storageUnit: 'cup',
      purchaseQuantity: 1,
      purchaseUnit: 'gallon',
      packagePrice: 16,
    }
    const original = JSON.stringify(ingredient)
    const receipt = packageCost(ingredient)
    expect(receipt.contents).toBeCloseTo(16)
    expect(receipt.unitCost).toBeCloseTo(1)
    expect(
      costBreakdown(
        {
          id: 'r',
          name: 'Recipe',
          yield: 1,
          laborMinutes: 0,
          lines: [{ ingredientId: 'milk', quantity: 2, unit: 'cup' }],
        },
        [{ ...ingredient, cost: receipt.unitCost }],
      ).ingredient,
    ).toBeCloseTo(2)
    expect(JSON.stringify(ingredient)).toBe(original)
  })
  it('resolves nested packages and rejects undefined sizes, density and conflicting chains', () => {
    const definitions = [
      {
        from: 'case',
        amountFrom: 1,
        to: 'bottle',
        amountTo: 4,
        verified: true,
      },
      {
        from: 'bottle',
        amountFrom: 1,
        to: 'gallon',
        amountTo: 1,
        verified: true,
      },
    ]
    expect(convert(1, 'case', 'gallon', definitions)).toBeCloseTo(4)
    expect(convert(64, 'cup', 'case', definitions)).toBeCloseTo(1)
    expect(() => convert(1, 'bottle', 'gallon')).toThrow(/verified/)
    expect(() => convert(1, 'cup', 'g')).toThrow(/verified/)
    expect(
      convert(1, 'bag', 'lb', [
        { from: 'bag', to: 'lb', amountFrom: 1, amountTo: 25, verified: true },
      ]),
    ).toBe(25)
    expect(() =>
      convert(1, 'case', 'gallon', [
        ...definitions,
        {
          from: 'case',
          to: 'quart',
          amountFrom: 1,
          amountTo: 8,
          verified: true,
        },
      ]),
    ).toThrow(/Conflicting/)
  })
  it('accepts fractional quantities without defining fractional units', () => {
    expect(convert('1/4', 'cup', 'tbsp')).toBeCloseTo(4)
    expect(convert('0.5', 'gallon', 'cup')).toBeCloseTo(8)
    expect(parseQuantity('1 1/2')).toBe(1.5)
    expect(parseQuantity('1/0')).toBeNaN()
    expect(
      ingredientCreateErrors({
        name: 'Milk',
        purchaseQuantity: '1/2',
        purchaseUnit: 'gallon',
        unit: 'cup',
        packagePrice: 8,
      }),
    ).toEqual({})
  })
  it('normalizes aliases while requiring regional volume review', () => {
    expect(normalizeUnit('pounds')).toBe('lb')
    expect(normalizeUnit('mL')).toBe('ml')
    expect(normalizeUnit('US gallons')).toBe('gallon')
    for (const unit of [
      'gallons',
      'cups',
      'Imperial gallon',
      'metric cup',
      'unknown',
    ])
      expect(normalizeUnit(unit)).toBeNull()
    expect(parseIngredient('1 gallon milk')).toMatchObject({
      unit: '',
      name: 'milk',
    })
    expect(parseIngredient('1 US gallon milk')).toMatchObject({
      unit: 'gallon',
      name: 'milk',
    })
    expect(parseIngredient('1 bottle milk')).toMatchObject({
      unit: 'bottle',
      name: 'milk',
    })
  })
  it('preserves existing custom count definitions that share a new package label', () => {
    const conversions = [
      {
        verified: true,
        unitDefinition: {
          abbreviation: 'bottle',
          category: 'count',
          factor: 6,
        },
      },
    ]
    expect(ingredientUnits(conversions).bottle.factor).toBe(6)
    expect(convert(2, 'bottle', 'each', conversions)).toBe(12)
    expect(units.bottle.factor).toBe(0)
  })
})
