import { describe, expect, it } from 'vitest'
import {
  purchaseEstimate,
  resaleCostBasis,
  validatePurchaseDefaults,
  resaleCostEvidence,
} from './resale-cost'
import { productCosting, type Item } from './domain'
import { productListMetrics } from './product-list'
import { preserveStoredProductFields } from './product-edit'
import { demoData } from './demo'

describe('resale purchase estimates and receipt history', () => {
  it.each([
    [8, 1, 8],
    [24, 12, 2],
    [15, 1, 15],
    [0, 1, 0],
  ])(
    'converts an explicit %s pack / %s sellable items',
    (packPrice, itemsPerPack, result) => {
      expect(
        purchaseEstimate({
          id: 'test',
          name: '15-pack',
          purchaseDefaults: { packPrice, itemsPerPack },
        }),
      ).toBe(result)
    },
  )
  it('distinguishes missing cost from a genuine zero', () => {
    expect(resaleCostBasis({ id: 'x', name: 'x' }).cost).toBeUndefined()
    expect(
      purchaseEstimate({
        id: 'x',
        name: 'x',
        purchaseDefaults: { packPrice: '', itemsPerPack: 1 },
      }),
    ).toBeUndefined()
    expect(
      resaleCostBasis({ id: 'x', name: 'x', stockCostKnown: true, cost: 0 }),
    ).toEqual({ cost: 0, label: 'Average inventory cost' })
  })
  it('uses the same estimate for product costing and list metrics without overriding actual inventory', () => {
    const workspace = demoData()
    const p: Item = {
      id: 'isolated',
      name: 'case',
      workflow: 'resale',
      price: 9,
      quantity: 0,
      purchaseDefaults: { packPrice: 24, itemsPerPack: 12 },
    }
    expect(() => productCosting(p, workspace)).toThrow()
    expect(resaleCostBasis(p).label).toBe('Estimated cost')
    expect(
      productCosting(p, workspace, { allowResaleEstimate: true }).perPackage,
    ).toBe(2)
    expect(productListMetrics(p, workspace).cost).toBe(2)
    p.stockCostKnown = true
    p.cost = 3
    expect(
      productCosting(p, workspace, { allowResaleEstimate: true }).perPackage,
    ).toBe(3)
    expect(productListMetrics(p, workspace).cost).toBe(3)
  })
  it('preserves actual quantity, valuation and purchase provenance when saving defaults', () => {
    const stored: Item = {
      id: 'x',
      name: 'x',
      workflow: 'resale',
      quantity: 12,
      cost: 3,
      stockCostKnown: true,
      purchaseCost: 24,
      purchaseQuantity: 1,
      purchaseUnit: 'case',
      itemsPerUnit: 12,
    }
    const saved = preserveStoredProductFields(
      {
        ...stored,
        quantity: 500,
        cost: 0,
        purchaseCost: 0,
        purchaseDefaults: { packPrice: 48, itemsPerPack: 12 },
      },
      stored,
    )
    expect(saved.quantity).toBe(12)
    expect(saved.cost).toBe(3)
    expect(saved.purchaseCost).toBe(24)
    expect(purchaseEstimate(saved)).toBe(4)
  })
  it('validates defaults without inventing allocations or cross-product receipt links', () => {
    expect(() =>
      validatePurchaseDefaults({ packPrice: -1, itemsPerPack: 2 }),
    ).toThrow()
    expect(() =>
      validatePurchaseDefaults({ packPrice: 10, itemsPerPack: 0 }),
    ).toThrow()
    expect(() =>
      validatePurchaseDefaults({
        packPrice: 10,
        itemsPerPack: 2,
        unit: 'each',
      }),
    ).toThrow()
    expect(
      validatePurchaseDefaults({
        packPrice: 10,
        itemsPerPack: 2,
        unit: 'case',
      }),
    ).toEqual({ packPrice: 10, itemsPerPack: 2, unit: 'case' })
    expect(
      resaleCostEvidence(
        { id: 'ours', name: 'ours' },
        {
          ledger: [
            {
              id: 'other',
              name: 'other',
              productId: 'theirs',
              type: 'purchase_receipt',
            },
          ],
        },
      ).receipts,
    ).toEqual([])
  })
})
