import { describe, expect, it } from 'vitest'
import { inventoryQuantity } from './inventory-quantity'

describe('inventory quantity display only', () => {
  it.each([
    [10, '10'],
    [2.5, '2.5'],
    [2.55, '2.55'],
    [12.345678, '12.35'],
    [4.999999, '5'],
    [0.1 + 0.2, '0.3'],
    [0.0001, '<0.01'],
    [-0.0001, '>-0.01'],
    [-12.345678, '-12.35'],
    [-0, '0'],
    [0, '0'],
    [undefined, 'Unavailable'],
    [null, 'Unavailable'],
    ['', 'Unavailable'],
    [NaN, 'Unavailable'],
    [Infinity, 'Unavailable'],
    ['12.345678', '12.35'],
    [1234.56, '1,234.56'],
  ])('formats %s as %s', (value, expected) => {
    expect(inventoryQuantity(value)).toBe(expected)
  })
  it('preserves source precision across units and supports locale', () => {
    for (const unit of ['kg', 'yd', 'each']) {
      const item = { quantity: 12.345678, unit }
      expect(`${inventoryQuantity(item.quantity)} ${item.unit}`).toBe(
        `12.35 ${unit}`,
      )
      expect(item.quantity).toBe(12.345678)
    }
    expect(inventoryQuantity(1234.56, 'de-DE')).toBe('1.234,56')
  })
})
