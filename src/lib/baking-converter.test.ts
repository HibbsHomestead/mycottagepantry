import { describe, expect, it } from 'vitest'
import {
  bakingConvert,
  bakingDisplay,
  ovenConvert,
  parseBakingQuantity,
  validateCustomFactor,
  yeastConvert,
} from './baking-converter'
import { units } from './domain'
describe('standalone baking calculations', () => {
  it('uses exact standard constants and ingredient-specific factors', () => {
    expect(bakingConvert(1, 'lb', 'oz')).toBe(16)
    expect(bakingConvert(1, 'cup', 'tbsp')).toBe(16)
    expect(bakingConvert(1, 'cup', 'g')).toBeNull()
    expect(bakingConvert(1, 'cup', 'g', 125 / units.cup.factor)).toBeCloseTo(
      125,
      12,
    )
    expect(bakingConvert(1, 'cup', 'g', 226 / units.cup.factor)).toBeCloseTo(
      226,
      12,
    )
    const value = bakingConvert(1.5, 'cup', 'oz', 125 / units.cup.factor)!
    expect(
      bakingConvert(value, 'oz', 'cup', 125 / units.cup.factor),
    ).toBeCloseTo(1.5, 12)
  })
  it('parses safe fractions and rejects invalid quantities', () => {
    for (const raw of ['1 1/2', '1.5', '3/2'])
      expect(parseBakingQuantity(raw)).toBe(1.5)
    expect(parseBakingQuantity('0.5')).toBe(0.5)
    expect(parseBakingQuantity('1/2')).toBe(0.5)
    for (const raw of [
      '',
      '1/0',
      '1 2/0',
      'NaN',
      'Infinity',
      '2+2',
      '-1',
      '1/2/3',
    ])
      expect(parseBakingQuantity(raw)).toBeNull()
    expect(parseBakingQuantity('-40', true)).toBe(-40)
    expect(bakingDisplay(0.00001)).toBe('less than 0.01')
    expect(bakingDisplay(null)).toBe('—')
    expect(bakingConvert(Number.MAX_VALUE, 'kg', 'g')).toBeNull()
    expect(() =>
      validateCustomFactor({
        ingredientName: 'Flour',
        description: '',
        referenceWeightG: 1,
        referenceVolumeMl: 0,
      }),
    ).toThrow()
  })
  it('converts ovens exactly and derives every yeast direction from one ratio', () => {
    expect(ovenConvert(32, '°F')).toBe(0)
    expect(ovenConvert(100, '°C')).toBe(212)
    expect(yeastConvert(10, 'Fresh yeast', 'Active dry yeast')).toBe(4)
    expect(yeastConvert(10, 'Fresh yeast', 'Instant yeast')).toBeCloseTo(
      3.3,
      12,
    )
    for (const a of ['Fresh yeast', 'Active dry yeast', 'Instant yeast'])
      for (const b of ['Fresh yeast', 'Active dry yeast', 'Instant yeast'])
        expect(yeastConvert(yeastConvert(17.345, a, b), b, a)).toBeCloseTo(
          17.345,
          12,
        )
  })
})
