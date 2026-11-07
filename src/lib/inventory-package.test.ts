import { expect, it } from 'vitest'
import { inventoryPackagePlan as plan } from './inventory-package'

const bag = {
  unit: 'lb',
  purchaseUnit: 'bag',
  amountPerPackage: 2,
  packagePrice: 3,
  initialStock: true,
  stockAction: 'opening',
  openingCount: 1,
  openingCountUnit: 'bag',
}

it.each([
  [1, 'bag', 2, 3],
  [1, 'lb', 1, 1.5],
  [0.5, 'bag', 1, 1.5],
])(
  'converts %s %s using the actual package and suggests its value',
  (openingCount, openingCountUnit, quantity, cost) => {
    const result = plan({ ...bag, openingCount, openingCountUnit })
    expect(result.stockQuantity).toBe(quantity)
    expect(result.baseQuantity).toBeCloseTo(quantity * 453.59237)
    expect(result.openingValue).toBe(cost)
    expect(result.unitCost).toBe(1.5)
    expect(result.stockUnit).toBe('lb')
    expect(result.purchaseUnit).toBe('bag')
  },
)

it('saves package costing without any opening count, including a previously entered count', () => {
  const result = plan({ ...bag, initialStock: false })
  expect(result.baseQuantity).toBe(0)
  expect(result.openingValue).toBeNull()
  expect(result.baseUnitCost).toBeCloseTo(3 / (2 * 453.59237))
  expect(plan({ unit: 'lb' }).packageCost).toBeNull()
})

it('keeps unknown cost distinct from explicit zero', () => {
  expect(
    plan({ ...bag, initialStock: false, packagePrice: '' }).unitCost,
  ).toBeNull()
  expect(() => plan({ ...bag, packagePrice: '' })).toThrow(
    'Missing cost is not zero',
  )
  expect(plan({ ...bag, packagePrice: 0 }).openingValue).toBe(0)
  expect(plan({ ...bag, packagePrice: '0' }).unitCost).toBe(0)
})

it('applies a valuation override only to opening stock', () => {
  const result = plan({ ...bag, openingValueOverride: true, openingValue: 2.5 })
  expect(result.suggestedValue).toBe(3)
  expect(result.openingValue).toBe(2.5)
  expect(result.packageCost).toBe(3)
  expect(result.unitCost).toBe(1.5)
  expect(
    plan({
      ...bag,
      packagePrice: '',
      openingValueOverride: true,
      openingValue: 0,
    }).openingValue,
  ).toBe(0)
  expect(() =>
    plan({ ...bag, openingValueOverride: true, openingValue: '' }),
  ).toThrow('Enter the optional')
})

it.each(['', 0, -1, 'NaN', 'Infinity'])(
  'requires actual positive package contents: %s',
  (amountPerPackage) => {
    expect(() => plan({ ...bag, amountPerPackage })).toThrow()
  },
)

it.each([0, '', -1, 'NaN', 'Infinity'])(
  'rejects invalid opening counts: %s',
  (openingCount) => {
    expect(() => plan({ ...bag, openingCount })).toThrow()
  },
)

it('does not infer a package size or weight-to-volume conversion', () => {
  expect(() => plan({ ...bag, amountPerPackage: '' })).toThrow(
    'amount in each package',
  )
  expect(() =>
    plan({ ...bag, purchaseUnit: 'lb', unit: 'ml', amountPerPackage: 500 }),
  ).toThrow('verified unit conversion')
  expect(() =>
    plan({ ...bag, purchaseUnit: 'g', amountPerPackage: 2 }),
  ).toThrow('conflicts')
  expect(() => plan({ ...bag, openingCountUnit: 'kg' })).toThrow(
    'Choose the purchase unit or stock unit',
  )
})

it('permits an explicit verified weight-to-volume conversion', () => {
  const result = plan({
    ...bag,
    purchaseUnit: 'lb',
    unit: 'ml',
    amountPerPackage: 500,
    openingCountUnit: 'lb',
    conversions: [
      { from: 'lb', to: 'ml', amountFrom: 1, amountTo: 500, verified: true },
    ],
  })
  expect(result.stockQuantity).toBe(500)
})

it('rejects overflow and keeps purchases in the separate receiving workflow', () => {
  expect(() => plan({ ...bag, openingCount: 1e308 })).toThrow('too large')
  expect(() => plan({ ...bag, stockAction: 'purchase' })).toThrow(
    'Receive Stock',
  )
})

it.each([
  {
    usedAs: 'packaging',
    unit: 'each',
    purchaseUnit: 'pack',
    amountPerPackage: 24,
    packagePrice: 9.6,
    openingCount: 0.5,
    openingCountUnit: 'pack',
    stock: 12,
    base: 12,
    value: 4.8,
  },
  {
    usedAs: 'supply',
    unit: 'ml',
    purchaseUnit: 'bottle',
    amountPerPackage: 2000,
    packagePrice: 12,
    openingCount: 500,
    openingCountUnit: 'ml',
    stock: 500,
    base: 500,
    value: 3,
  },
  {
    usedAs: 'material',
    materialType: 'yarn',
    unit: 'yd',
    purchaseUnit: 'pack',
    amountPerPackage: 200,
    packagePrice: 8,
    openingCount: 50,
    openingCountUnit: 'yd',
    stock: 50,
    base: 45.72,
    value: 2,
  },
  {
    usedAs: 'material',
    materialType: 'fabric',
    fabricTracking: 'length',
    unit: 'yd',
    purchaseUnit: 'roll',
    amountPerPackage: 10,
    packagePrice: 50,
    openingCount: 0.5,
    openingCountUnit: 'roll',
    stock: 5,
    base: 5,
    value: 25,
  },
  {
    usedAs: 'material',
    materialType: 'fabric',
    fabricTracking: 'precut',
    unit: 'each',
    purchaseUnit: 'bundle',
    amountPerPackage: 4,
    packagePrice: 12,
    openingCount: 1,
    openingCountUnit: 'each',
    stock: 1,
    base: 1,
    value: 3,
  },
  {
    usedAs: 'resale',
    sellUnit: 'bottle',
    unit: 'each',
    purchaseUnit: 'case',
    amountPerPackage: 6,
    packagePrice: 9,
    openingCount: 0.5,
    openingCountUnit: 'case',
    stock: 3,
    base: 3,
    value: 4.5,
  },
])(
  'uses $usedAs $materialType package and stock units independently',
  (data) => {
    const result = plan({ ...data, initialStock: true })
    expect(result.stockQuantity).toBe(data.stock)
    expect(result.baseQuantity).toBeCloseTo(data.base)
    expect(result.openingValue).toBeCloseTo(data.value)
  },
)

it('requires whole resale items after decimal package conversion and ignores sealed-pack contents', () => {
  const data = {
    usedAs: 'resale',
    sellUnit: 'sealed pack',
    packContents: '15 bottles',
    unit: 'each',
    purchaseUnit: 'case',
    amountPerPackage: 6,
    packagePrice: 9,
    initialStock: true,
    openingCount: 0.5,
    openingCountUnit: 'case',
  }
  expect(plan(data).baseQuantity).toBe(3)
  expect(() => plan({ ...data, openingCount: 0.25 })).toThrow('whole number')
  expect(() =>
    plan({ ...data, initialStock: false, amountPerPackage: 1.5 }),
  ).toThrow('whole number')
  expect(
    plan({ ...data, amountPerPackage: 1, openingCount: 1 }).baseQuantity,
  ).toBe(1)
})

it('keeps the existing resale cent rounding', () => {
  const result = plan({
    usedAs: 'resale',
    sellUnit: 'item',
    unit: 'each',
    purchaseUnit: 'case',
    amountPerPackage: 3,
    packagePrice: 1,
    openingCount: 1,
    openingCountUnit: 'each',
    initialStock: true,
  })
  expect(result.openingValue).toBe(0.33)
  expect(result.suggestedValue).toBe(0.33)
})

it('does not allow fabric yardage for precuts or inferred density for supplies', () => {
  expect(() =>
    plan({
      ...bag,
      usedAs: 'material',
      materialType: 'fabric',
      fabricTracking: 'precut',
      unit: 'yd',
    }),
  ).toThrow('stock unit')
  expect(() =>
    plan({
      ...bag,
      usedAs: 'supply',
      purchaseUnit: 'lb',
      unit: 'ml',
      amountPerPackage: 500,
    }),
  ).toThrow('verified unit conversion')
  expect(() => plan({ ...bag, usedAs: 'packaging', unit: 'lb' })).toThrow(
    'stock unit',
  )
})

it('requires explicit bundle contents and preserves historical custom bundle definitions', async () => {
  const { convert } = await import('./domain')
  expect(() => convert(1, 'bundle', 'each')).toThrow('verified unit conversion')
  expect(
    convert(1, 'bundle', 'each', [
      {
        verified: true,
        unitDefinition: {
          abbreviation: 'bundle',
          category: 'count',
          factor: 4,
        },
      },
    ]),
  ).toBe(4)
  const result = plan({
    unit: 'each',
    usedAs: 'packaging',
    purchaseUnit: 'bundle',
    amountPerPackage: 10,
    packagePrice: 5,
    initialStock: true,
    openingCount: 0.5,
    openingCountUnit: 'bundle',
  })
  expect(result.baseQuantity).toBe(5)
})
