import { expect, it } from 'vitest'
import { demoData } from './demo'
import {
  blankLabel,
  elementText,
  newElement,
  resolveLabelData,
} from './label-studio'
import {
  formatNetWeight,
  inspectLegacyNetWeight,
  normalizeProductNetWeight,
} from './net-weight'
import type { Item } from './domain'

it('formats ounces once, keeps precision, truncates grams and omits blank weights', () => {
  expect(formatNetWeight(9.5)).toBe('Net Wt. 9.5oz (269g)')
  expect(formatNetWeight('9.50')).toBe('Net Wt. 9.5oz (269g)')
  expect(formatNetWeight(5)).toBe('Net Wt. 5oz (141g)')
  expect(formatNetWeight(1.23456789)).toBe('Net Wt. 1.23456789oz (34g)')
  for (const value of ['', null, undefined])
    expect(formatNetWeight(value)).toBe('')
  for (const value of [0, -1, 'no', '5 fl oz', Infinity, true])
    expect(() => formatNetWeight(value)).toThrow('positive net weight')
})

it('converts only unambiguous ounce-weight text and flags real legacy gram conflicts', () => {
  expect(inspectLegacyNetWeight('Net Wt. 9.5oz (269g)')).toEqual({
    ounces: 9.5,
  })
  expect(inspectLegacyNetWeight('18 oz')).toEqual({ ounces: 18 })
  for (const value of [
    'Net Wt. 16oz (516g)',
    'Net Wt. 5oz (142g)',
    '8 fl oz',
    '12 count',
    '250g',
    '9.5',
    'net 2 bags',
  ])
    expect(inspectLegacyNetWeight(value).review).toBeTruthy()
})

it('preserves original text on save, reopens numeric ounces and explicitly clears the complete line', () => {
  const w = demoData()
  const original = { ...w.products[0], netQuantity: 'Net Wt. 9.5oz (269g)' }
  const updated: Item = { ...original }
  normalizeProductNetWeight(updated, original)
  expect(updated.netWeightOz).toBe(9.5)
  expect(updated.netQuantity).toBe(original.netQuantity)
  w.products = [JSON.parse(JSON.stringify(updated))]
  const binding = {
    ...newElement('text', 'Net Wt. old units', 'product.netQuantity'),
    fontSize: 12,
    x: 24,
    y: 40,
  }
  const template = { ...blankLabel(), elements: [binding] }
  const before = structuredClone(template)
  const resolved = resolveLabelData(w, { kind: 'product', id: updated.id })
  expect(elementText(binding, resolved)).toBe(formatNetWeight(9.5))
  const cleared = {
    ...updated,
    netWeightOz: '',
    netQuantity: 'client replacement',
  }
  normalizeProductNetWeight(cleared, updated)
  expect(cleared.netQuantity).toBe(original.netQuantity)
  expect(cleared.netWeightOz).toBe(null)
  w.products = [cleared]
  expect(
    elementText(
      binding,
      resolveLabelData(w, { kind: 'product', id: updated.id }),
    ),
  ).toBe('')
  expect(template).toEqual(before)
})

it('keeps ambiguous existing labels intact until explicitly reviewed', () => {
  const w = demoData()
  const original = { ...w.products[0], netQuantity: 'Net Wt. 16oz (516g)' }
  const item: Item = { ...original }
  normalizeProductNetWeight(item, original)
  expect(item).not.toHaveProperty('netWeightOz')
  w.products = [item]
  const data = resolveLabelData(w, { kind: 'product', id: item.id })
  expect(data.values['product.netQuantity']).toBe(original.netQuantity)
  expect(data.warnings.join(' ')).toContain('453g')
  item.netWeightOz = 16
  normalizeProductNetWeight(item, original)
  expect(item.netQuantity).toBe(original.netQuantity)
  expect(
    resolveLabelData(w, { kind: 'product', id: item.id }).values[
      'product.netQuantity'
    ],
  ).toBe('Net Wt. 16oz (453g)')
})
