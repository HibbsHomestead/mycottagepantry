import { expect, it } from 'vitest'
import {
  blankIngredientImportPatch,
  commonImportFields,
  ingredientImportFields,
} from './ingredient-import-draft'

it('keeps common baking-soda details without picking a fulfillment price', () => {
  const fields = {
    name: 'Baking soda',
    purchaseQuantity: 13.5,
    purchaseUnit: 'lb',
  }
  expect(
    commonImportFields([
      { fields: { ...fields, packagePrice: 9.42 } },
      { fields: { ...fields, packagePrice: 8.98 } },
    ]),
  ).toEqual(fields)
})

it('maps a source package to the chosen stock unit without labeling a bag as lb', () => {
  const fields = ingredientImportFields(
    { purchaseQuantity: 13.5, purchaseUnit: 'lb', packageSize: '13.5 lbs' },
    { unit: 'g', purchaseUnit: 'bag' },
    true,
  )
  expect(fields).toEqual({ amountPerPackage: 6123.496995, purchaseUnit: 'bag' })
  expect(
    ingredientImportFields(
      { purchaseQuantity: 25, purchaseUnit: 'lb' },
      { unit: 'lb' },
      true,
    ),
  ).toEqual({ amountPerPackage: 25, purchaseUnit: 'package' })
})

it('never invents density and preserves the legacy measurement pair', () => {
  expect(
    ingredientImportFields(
      { name: 'Flour', purchaseQuantity: 25, purchaseUnit: 'lb' },
      { unit: 'cup' },
      true,
    ),
  ).toEqual({ name: 'Flour' })
  const fields = { purchaseQuantity: 25, purchaseUnit: 'lb' }
  expect(ingredientImportFields(fields, { unit: 'g' }, false)).toEqual(fields)
  expect(
    blankIngredientImportPatch(
      fields,
      { purchaseUnit: 'g' },
      [],
      'https://example.org',
      false,
    ),
  ).toEqual({})
})

it('preserves manual values, explicit zero and reviewed wording, and uses a stable vendor ID', () => {
  const patch = blankIngredientImportPatch(
    {
      name: 'Source',
      brand: 'Brand',
      packagePrice: 10,
      subingredients: 'Source text',
      vendor: 'Samsclub.com',
    },
    { name: 'Manual', packagePrice: 0, reviewed: true },
    [{ id: 'sams', name: 'Sam’s Club' }],
    'https://www.samsclub.com/ip/product/123',
    true,
  )
  expect(patch).toEqual({
    brand: 'Brand',
    vendorId: 'sams',
    vendor: 'Sam’s Club',
  })
})

it('does not apply a price to conflicting manual package contents or currency', () => {
  const fields = {
    amountPerPackage: 13.5,
    purchaseUnit: 'bag',
    packagePrice: 8.98,
    currency: 'USD',
  }
  expect(
    blankIngredientImportPatch(
      fields,
      { amountPerPackage: 2, purchaseUnit: 'bag', currency: 'USD' },
      [],
      'https://example.org',
      true,
    ),
  ).not.toHaveProperty('packagePrice')
  expect(
    blankIngredientImportPatch(
      fields,
      { currency: 'EUR' },
      [],
      'https://example.org',
      true,
    ),
  ).not.toHaveProperty('packagePrice')
})
