import { expect, it } from 'vitest'
import { demoData } from './demo'
import {
  productListMetrics,
  productSortOptions,
  sortProducts,
} from './product-list'
import type { Item } from './domain'

it('sorts full collections numerically, preserves input and keeps unavailable values last in either direction', () => {
  const w = demoData()
  const products: Item[] = [
    { id: 'c', name: 'Cedar', price: 100, workflow: 'resale', quantity: 0 },
    { id: 'b', name: 'Birch', price: 9, workflow: 'resale', quantity: 0 },
    {
      id: 'missing',
      name: 'Alder',
      price: '',
      workflow: 'resale',
      quantity: 0,
    },
    { id: 'a2', name: 'Birch', price: 9, workflow: 'resale', quantity: 0 },
  ]
  expect(sortProducts(products, w, 'price-asc').map((p) => p.id)).toEqual([
    'a2',
    'b',
    'c',
    'missing',
  ])
  expect(sortProducts(products, w, 'price-desc').map((p) => p.id)).toEqual([
    'c',
    'a2',
    'b',
    'missing',
  ])
  expect(products.map((p) => p.id)).toEqual(['c', 'b', 'missing', 'a2'])
  expect(productListMetrics(products[2], w).price).toBeUndefined()
})
it('uses the displayed costing/profitability resolution for every sort metric and missing state', () => {
  const w = demoData()
  const missing: Item = {
    id: 'missing',
    name: 'AAA missing',
    workflow: 'food',
    price: null,
  }
  const rows = [...w.products, missing]
  for (const [option] of productSortOptions) {
    const sorted = sortProducts(rows, w, option)
    expect(sorted).toHaveLength(rows.length)
    if (option.startsWith('name')) continue
    const key = option.split('-')[0]
    const values = sorted.map((p) => {
      const m = productListMetrics(p, w)
      return key === 'price'
        ? m.price
        : key === 'cost'
          ? m.cost
          : key === 'profit'
            ? m.pricing?.profit
            : m.pricing?.margin
    })
    let missingSeen = false
    let previous: number | undefined
    for (const value of values) {
      if (value === undefined) {
        missingSeen = true
        continue
      }
      expect(missingSeen).toBe(false)
      if (previous !== undefined)
        expect(
          option.endsWith('asc') ? value >= previous : value <= previous,
        ).toBe(true)
      previous = value
    }
  }
})
