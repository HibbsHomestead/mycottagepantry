import { describe, expect, it } from 'vitest'
import { handleAddItem } from '../../netlify/lib/add-item-handler'
import { handleProductWorkflow } from '../../netlify/lib/product-workflow-handler'
import { demoData } from './demo'
import type { Item, Workspace } from './domain'
import {
  productEditDraft,
  productIdentityConflict,
  preserveStoredProductFields,
} from './product-edit'

/** Mirrors the workspace API order: Add Item handler first, then product workflows. */
function oven() {
  const state: Workspace = demoData()
  state.products = state.products.filter((p) => p.workflow !== 'resale')
  state.vendors = [
    { id: 'v1', name: 'Mercantile Supply' },
    { id: 'v2', name: 'Prairie Wholesale' },
  ]
  state.graphic_assets = [
    ...(state.graphic_assets || []),
    { id: 'photo-2', name: 'Mug photo', fileUrl: '/m.png' },
  ]
  state.settings[0].productCategories = [
    { id: 'gifts', name: 'Gifts', classification: 'non_food' },
    { id: 'kitchen', name: 'Kitchen', classification: 'non_food' },
  ]
  const writes: { table: string; item: Item }[] = []
  const save = async (table: string, item: Item) => {
    writes.push({ table, item: structuredClone(item) })
    const rows = (state[table] ||= [])
    const index = rows.findIndex((r: Item) => r.id === item.id)
    if (index >= 0) rows[index] = structuredClone(item)
    else rows.push(structuredClone(item))
  }
  const ctx = {
    state,
    save,
    audit: async () => {},
    today: '2026-11-06',
    actor: 'owner',
  }
  async function post(table: string, data: Item) {
    if (await handleAddItem('save', table, data, ctx)) return
    if (await handleProductWorkflow('save', table, data, ctx)) return
    throw new Error('Unhandled save')
  }
  return { state, writes, post }
}

const resaleCreate = (extra: Partial<Item> = {}): Item => ({
  id: 'mug-1',
  creationRequestId: 'create-mug-1',
  inventoryCreation: true,
  usedAs: 'resale',
  workflow: 'resale',
  name: 'Enamel mug',
  unit: 'each',
  purchaseUnit: 'each',
  price: '14',
  threshold: 2,
  sku: 'MUG-1',
  barcode: '0123456789012',
  vendorId: 'v1',
  productCategoryId: 'gifts',
  stockChoice: 'existing',
  sellUnit: 'item',
  countMethod: 'direct',
  startingCount: 12,
  costBasis: 'unit',
  costAmount: 4,
  receivedDate: '2026-11-01',
  ...extra,
})

describe('editing an existing resale product (owner reproduction)', () => {
  it('updates the same product instead of reporting a false duplicate', async () => {
    const { state, writes, post } = oven()
    await post('products', resaleCreate())
    const created = state.products.find((p) => p.id === 'mug-1')!
    expect(created.quantity).toBe(12)
    expect(created).not.toHaveProperty('inventoryCreation')
    const stockWrites = writes.filter((w) =>
      ['ledger', 'journals'].includes(w.table),
    ).length
    // Older records stored the creation flag; the editor must still update them.
    const legacy = { ...created, inventoryCreation: true }
    state.products = state.products.map((p) =>
      p.id === legacy.id ? legacy : p,
    )

    // Exact owner path: stored record sent back with a new price.
    await post('products', { ...legacy, price: '16.5' })
    let saved = state.products.find((p) => p.id === 'mug-1')!
    expect(saved.price).toBe(16.5)

    // Category, supplier, photo and reorder threshold.
    await post('products', {
      ...productEditDraft(saved),
      productCategoryId: 'kitchen',
      supplierId: 'v2',
      imageAssetId: 'photo-2',
      threshold: '5',
    })
    saved = state.products.find((p) => p.id === 'mug-1')!
    expect(saved).toMatchObject({
      productCategoryId: 'kitchen',
      supplierId: 'v2',
      vendorId: 'v2',
      vendor: 'Prairie Wholesale',
      imageAssetId: 'photo-2',
      threshold: 5,
    })

    // Unchanged save and repeated saves: no error, no duplicate.
    await post('products', productEditDraft(saved))
    await post('products', productEditDraft(saved))
    expect(state.products.filter((p) => p.id === 'mug-1')).toHaveLength(1)
    expect(state.products.filter((p) => p.name === 'Enamel mug')).toHaveLength(
      1,
    )

    // Stock, receipts and history never change from item editing.
    expect(saved.quantity).toBe(created.quantity)
    expect(saved.cost).toBe(created.cost)
    expect(saved.stockEntry).toEqual(created.stockEntry)
    expect(
      writes.filter((w) => ['ledger', 'journals'].includes(w.table)),
    ).toHaveLength(stockWrites)
    expect(saved).not.toHaveProperty('inventoryCreation')
  })

  it('ignores stock or cost values sent from an editor', async () => {
    const { state, post } = oven()
    await post('products', resaleCreate())
    const stored = state.products.find((p) => p.id === 'mug-1')!
    await post('products', {
      ...productEditDraft(stored),
      quantity: 999,
      cost: 0.01,
      stockEntry: { tampered: true },
      stockChoice: 'existing',
      startingCount: 500,
    })
    const saved = state.products.find((p) => p.id === 'mug-1')!
    expect(saved.quantity).toBe(stored.quantity)
    expect(saved.cost).toBe(stored.cost)
    expect(saved.stockEntry).toEqual(stored.stockEntry)
    expect(saved).not.toHaveProperty('startingCount')
  })

  it('still detects a genuine SKU or barcode conflict with ANOTHER product', async () => {
    const { state, post } = oven()
    await post('products', resaleCreate())
    await post(
      'products',
      resaleCreate({
        id: 'jar-1',
        creationRequestId: 'create-jar-1',
        name: 'Glass jar',
        sku: 'JAR-1',
        barcode: '0999999999999',
      }),
    )
    const jar = state.products.find((p) => p.id === 'jar-1')!
    await expect(
      post('products', { ...productEditDraft(jar), sku: 'mug-1' }),
    ).rejects.toThrow(
      /SKU “mug-1” is already used by another product, “Enamel mug”/,
    )
    await expect(
      post('products', { ...productEditDraft(jar), barcode: '0123456789012' }),
    ).rejects.toThrow(/Barcode .* “Enamel mug”/)
    // A new Add Item product with a taken SKU is also refused.
    await expect(
      post(
        'products',
        resaleCreate({ id: 'x', creationRequestId: 'create-x', sku: 'MUG-1' }),
      ),
    ).rejects.toThrow(/already used by another product/)
    expect(state.products.find((p) => p.id === 'jar-1')!.sku).toBe('JAR-1')
  })

  it('keeps an identical creation retry idempotent', async () => {
    const { state, writes, post } = oven()
    await post('products', resaleCreate())
    const count = writes.length
    await post('products', resaleCreate())
    expect(writes).toHaveLength(count)
    expect(state.products.filter((p) => p.id === 'mug-1')).toHaveLength(1)
  })

  it('edits handmade products through the same update path', async () => {
    const { state, post } = oven()
    const design = state.recipes.find((r) => r.workflow === 'handmade')
    if (!design) return
    const product = state.products.find((p) => p.workflow === 'handmade')
    if (!product) return
    await post('products', { ...productEditDraft(product), price: '22' })
    const saved = state.products.find((p) => p.id === product.id)!
    expect(saved.price).toBe(22)
    expect(saved.quantity).toBe(product.quantity || 0)
  })
})

describe('product edit helpers', () => {
  it('excludes the record being edited and unchanged legacy duplicates', () => {
    const products = [
      { id: 'a', name: 'A', sku: 'X' },
      { id: 'b', name: 'B', sku: 'X' },
    ] as Item[]
    expect(productIdentityConflict(products, products[0], products[0])).toBe(
      null,
    )
    expect(
      productIdentityConflict(
        products,
        { ...products[0], sku: 'Y' },
        products[0],
      ),
    ).toBe(null)
    expect(
      productIdentityConflict(products, { id: 'c', name: 'C', sku: 'x' }),
    ).toMatchObject({ field: 'sku', other: { id: 'a' } })
  })
  it('restores stored stock fields and keeps the original ID', () => {
    const stored = { id: 'a', name: 'A', quantity: 3, cost: 2 } as Item
    expect(
      preserveStoredProductFields(
        { id: 'other', name: 'A2', quantity: 50, inventoryCreation: true },
        stored,
      ),
    ).toEqual({ id: 'a', name: 'A2', quantity: 3, cost: 2 })
  })
})
