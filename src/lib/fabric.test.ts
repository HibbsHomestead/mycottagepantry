import { expect, it } from 'vitest'
import { convert, parseQuantity } from './domain'
import {
  checkFabricWidth,
  fabricConvert,
  fabricReceipt,
  materialPlan,
  validateFabric,
} from './fabric'
const fabric = {
  id: 'fabric',
  name: 'Cotton',
  materialType: 'fabric',
  usedAs: 'material',
  fabricTracking: 'length',
  pieceMode: 'aggregate',
  unit: 'yd',
  fabricWidth: 44,
  widthUnit: 'in',
  quantity: 2.25,
  cost: 8,
}
it.each([
  ['1/4', 0.25],
  ['1/2', 0.5],
  ['3/4', 0.75],
  ['1 1/2', 1.5],
  ['2.25', 2.25],
])('normalizes %s without display rounding', (entry, quantity) => {
  expect(parseQuantity(entry)).toBe(quantity)
  expect(fabricReceipt(fabric, { quantity: entry, unit: 'yd' })).toBe(quantity)
})
it('keeps length conversions distinct from mass, volume, count and area', () => {
  expect(fabricConvert(18, 'in', 'yd', fabric)).toBeCloseTo(0.5, 14)
  expect(fabricConvert(1, 'm', 'yd', fabric)).toBeCloseTo(1 / 0.9144, 14)
  for (const unit of ['g', 'ml', 'each', 'square yd'])
    expect(() => fabricConvert(1, unit, 'yd', fabric)).toThrow()
  expect(convert(1, 'lb', 'g')).toBe(453.59237)
  expect(convert(1, 'cup', 'ml')).toBe(236.5882365)
  expect(
    convert(2, 'case', 'each', [
      { from: 'case', to: 'each', amountFrom: 1, amountTo: 12, verified: true },
    ]),
  ).toBe(24)
})
it('requires confirmed bolt length and never converts precuts to yardage', () => {
  expect(() => fabricReceipt(fabric, { quantity: 1, unit: 'bolt' })).toThrow(
    /Confirm/,
  )
  expect(
    fabricReceipt(fabric, {
      quantity: 2,
      unit: 'bolt',
      usableLength: '1 1/2',
      usableLengthUnit: 'yd',
      lengthConfirmed: true,
    }),
  ).toBe(3)
  const precut = { ...fabric, fabricTracking: 'precut', unit: 'each' }
  expect(fabricReceipt(precut, { quantity: 4, unit: 'each' })).toBe(4)
  expect(() => fabricConvert(1, 'each', 'yd', precut)).toThrow(/Precuts/)
})
it('validates widths and displays usage, available stock, cost and shortage', () => {
  expect(() =>
    checkFabricWidth(fabric, { minimumWidth: 45, widthUnit: 'in' }),
  ).toThrow(/narrower/)
  expect(() =>
    checkFabricWidth(fabric, { minimumWidth: 100, widthUnit: 'cm' }),
  ).not.toThrow()
  expect(
    materialPlan(
      {
        id: 'd',
        name: 'Design',
        lines: [
          {
            ingredientId: 'fabric',
            quantity: 18,
            unit: 'in',
            minimumWidth: 40,
            widthUnit: 'in',
          },
        ],
      },
      [fabric],
      5,
    )[0],
  ).toMatchObject({
    planned: 90,
    needed: 2.5,
    available: 2.25,
    shortage: 0.25,
    cost: 20,
  })
  expect(() => validateFabric({ ...fabric, fabricWidth: 60 }, fabric)).toThrow(
    /fixed/,
  )
})
