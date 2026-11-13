import { expect, it } from 'vitest'
import { handleAddItem } from '../../netlify/lib/add-item-handler'
import { handleFabric } from '../../netlify/lib/fabric-handler'
import { demoData } from './demo'
import type { Item } from './domain'
import { supportsExpiry } from './fabric'
import { stockStatus } from './ingredients'
import { planFinance } from './finance'
import {
  fabricPurchaseDraft,
  inventoryPackageChange,
  inventoryPackagePlan,
} from './inventory-package'

const fabric: Item = {
  id: 'yard-fabric',
  creationRequestId: 'create-yard-fabric',
  inventoryCreation: true,
  inventoryPackageSetup: true,
  name: 'Cotton fabric',
  usedAs: 'material',
  materialType: 'fabric',
  fabricTracking: 'length',
  fabricWidth: 44,
  widthUnit: 'in',
  pieceMode: 'aggregate',
  unit: 'yd',
  purchaseUnit: 'yd',
  packagePrice: 2.99,
  initialStock: true,
  openingCount: 4,
  openingCountUnit: 'yd',
  receivedDate: '2026-11-13',
}

function oven() {
  const state = demoData()
  const writes: { table: string; item: Item }[] = []
  const ctx = {
    state,
    today: '2026-11-13',
    actor: 'owner',
    audit: async () => {},
    save: async (table: string, item: Item) => {
      const saved = structuredClone(item)
      writes.push({ table, item: saved })
      const rows = (state[table] ||= [])
      const index = rows.findIndex((r) => r.id === item.id)
      if (index < 0) rows.push(saved)
      else rows[index] = saved
    },
  }
  return { state, writes, ctx }
}

it.each([
  [4, 11.96],
  [0.25, 0.7475],
  [1.5, 4.485],
])(
  'derives a one-yard basis for %s yards without an entered package amount',
  (openingCount, value) => {
    const plan = inventoryPackagePlan({ ...fabric, openingCount })
    expect(plan.amountPerPackage).toBe(1)
    expect(plan.stockQuantity).toBe(openingCount)
    expect(plan.openingValue).toBeCloseTo(value)
    expect(plan.unitCost).toBe(2.99)
  },
)

it.each([true, false])(
  'receipt posting respects fabric expiry applicability (%s) and keeps optional lots',
  (isFabric) => {
    const w = demoData()
    const item: Item = {
      ...fabric,
      id: 'receipt-item',
      quantity: 4,
      cost: 2.99,
      expires: '2020-01-01',
      ...(isFabric
        ? {}
        : { materialType: undefined, usedAs: 'ingredient', unit: 'g' }),
    }
    w.ingredients.push(item)
    const receipt: Item = {
      id: 'fabric-receipt',
      name: 'Fabric supplier',
      vendor: 'Fabric supplier',
      status: 'draft',
      date: '2026-11-13',
      receivedDate: '2026-11-13',
      arithmeticVersion: 2,
      taxTreatment: 'exclusive',
      tax: 0,
      lines: [
        {
          description: 'Stock receipt',
          decision: 'inventory',
          amountMode: 'direct',
          enteredAmount: 2.99,
          itemId: item.id,
          itemTable: 'ingredients',
          quantity: 1,
          unit: item.unit,
          stockQuantityConfirmed: true,
          lot: 'RECEIPT-LOT',
          expires: '2026-12-01',
        },
      ],
    }
    w.receipt_extractions = [receipt]
    const plan = planFinance(w, 'receiptPost', receipt, () =>
      crypto.randomUUID(),
    )
    expect(plan.writes.find((r) => r.table === 'ledger')?.record).toMatchObject(
      { lot: 'RECEIPT-LOT', expires: isFabric ? '' : '2026-12-01' },
    )
    expect(plan.writes.find((r) => r.table === 'lots')?.record).toMatchObject({
      name: 'RECEIPT-LOT',
      expires: isFabric ? '' : '2026-12-01',
    })
    // Historical dates already on the stock record remain untouched.
    expect(
      plan.writes.find((r) => r.table === 'ingredients')?.record.expires,
    ).toBe('2020-01-01')
  },
)

it('expresses the one-yard basis in a different stock unit', () => {
  const plan = inventoryPackagePlan({
    ...fabric,
    unit: 'in',
    openingCount: 18,
    openingCountUnit: 'in',
  })
  expect(plan.amountPerPackage).toBe(36)
  expect(plan.stockQuantity).toBe(18)
  expect(plan.openingValue).toBeCloseTo(1.495)
})

it.each(['bolt', 'roll'])(
  'keeps %s contents editable and independent of owned yards',
  (purchaseUnit) => {
    const plan = inventoryPackagePlan({
      ...fabric,
      purchaseUnit,
      amountPerPackage: 10,
      packagePrice: 29.9,
      openingCount: 4,
    })
    expect(plan.amountPerPackage).toBe(10)
    expect(plan.stockQuantity).toBe(4)
    expect(plan.openingValue).toBeCloseTo(11.96)
  },
)

it('requires a reviewed price after changing units and clears an obsolete package count', () => {
  const roll = {
    ...fabric,
    purchaseUnit: 'roll',
    amountPerPackage: 10,
    packagePrice: 29.9,
    openingCount: 2,
    openingCountUnit: 'roll',
  }
  const yard = {
    ...roll,
    ...inventoryPackageChange(roll, 'purchaseUnit', 'yd'),
  }
  expect(yard.amountPerPackage).toBe(1)
  expect(yard.packagePrice).toBe('')
  expect(yard.openingCount).toBe('')
  expect(yard.openingCountUnit).toBe('yd')
  expect(() => inventoryPackagePlan(yard)).toThrow('Review and enter the price')
  const reviewed = {
    ...yard,
    ...inventoryPackageChange(yard, 'packagePrice', '2.99'),
    openingCount: 4,
  }
  expect(inventoryPackagePlan(reviewed).openingValue).toBeCloseTo(11.96)
  const back = {
    ...reviewed,
    ...inventoryPackageChange(reviewed, 'purchaseUnit', 'roll'),
  }
  expect(back.amountPerPackage).toBe('')
  expect(back.packagePrice).toBe('')
  expect(() => inventoryPackagePlan(back)).toThrow('Review and enter the price')
})

it('flags conflicting saved yard references without changing them or their history', async () => {
  const { state, writes, ctx } = oven()
  const saved: Item = {
    ...fabric,
    purchaseQuantity: 4,
    packagePrice: 11.96,
    quantity: 4,
    cost: 2.99,
    expires: '2026-01-01',
  }
  delete saved.inventoryCreation
  delete saved.inventoryPackageSetup
  state.ingredients.push(saved)
  const snapshot = structuredClone(saved)
  const draft = fabricPurchaseDraft(saved)
  expect(draft.amountPerPackage).toBe(4)
  expect(() => inventoryPackagePlan(draft)).toThrow(
    'Review this fabric purchase basis',
  )
  expect(saved).toEqual(snapshot)
  await handleFabric(
    'fabricUpdate',
    'ingredients',
    { ...draft, name: 'Updated name', operationId: 'metadata-only' },
    ctx,
  )
  const reopened = state.ingredients.find((i) => i.id === saved.id)!
  expect(reopened).toMatchObject({
    purchaseQuantity: 4,
    packagePrice: 11.96,
    quantity: 4,
    cost: 2.99,
    expires: '2026-01-01',
  })
  expect(writes.every((w) => w.table === 'ingredients')).toBe(true)
  await handleFabric(
    'fabricUpdate',
    'ingredients',
    {
      ...reopened,
      operationId: 'review-reference',
      fabricPurchaseChanged: true,
      amountPerPackage: 1,
      packagePrice: 2.99,
      purchasePriceReviewed: true,
    },
    ctx,
  )
  const reviewed = state.ingredients.find((i) => i.id === saved.id)!
  expect(reviewed).toMatchObject({
    purchaseQuantity: 1,
    amountPerPackage: 1,
    packagePrice: 2.99,
    quantity: 4,
    cost: 2.99,
    expires: '2026-01-01',
  })
  expect(reviewed.costReferenceHistory.at(-1)).toMatchObject({
    purchaseQuantity: 4,
    packagePrice: 11.96,
  })
  expect(writes.every((w) => w.table === 'ingredients')).toBe(true)
})

it.each(['yd', 'roll'])(
  'rejects an unreviewed change from an existing %s price basis on the server',
  async (purchaseUnit) => {
    const { state, writes, ctx } = oven()
    const saved: Item = {
      ...fabric,
      purchaseUnit,
      purchaseQuantity: 4,
      amountPerPackage: purchaseUnit === 'yd' ? 4 : 10,
      packagePrice: 11.96,
      quantity: 4,
      cost: 2.99,
    }
    state.ingredients.push(saved)
    await expect(
      handleFabric(
        'fabricUpdate',
        'ingredients',
        {
          ...saved,
          operationId: 'unreviewed-basis',
          fabricPurchaseChanged: true,
          purchaseUnit: 'yd',
          amountPerPackage: 1,
        },
        ctx,
      ),
    ).rejects.toThrow('Review and enter the price')
    expect(writes).toHaveLength(0)
    expect(state.ingredients.find((i) => i.id === saved.id)).toEqual(saved)
  },
)

it('flags legacy receipts that overwrote a one-yard reference with a multi-yard total price', () => {
  const saved: Item = {
    ...fabric,
    amountPerPackage: 1,
    purchaseQuantity: 4,
    packagePrice: 11.96,
    quantity: 4,
    cost: 2.99,
  }
  const draft = fabricPurchaseDraft(saved)
  expect(draft.fabricPurchaseBasisConflict).toBe(true)
  expect(() => inventoryPackagePlan(draft)).toThrow(
    'saved purchase quantity and per-yard reference disagree',
  )
  expect(saved).toMatchObject({
    amountPerPackage: 1,
    purchaseQuantity: 4,
    packagePrice: 11.96,
  })
})

it('saves a per-yard opening count, preserves its reference on receiving, and records actual receipt quantities separately', async () => {
  const { state, ctx } = oven()
  await handleAddItem(
    'save',
    'ingredients',
    { ...fabric, expires: '2026-01-01', lot: 'Cotton lot' },
    ctx,
  )
  const saved = state.ingredients.find((i) => i.id === fabric.id)!
  expect(saved).toMatchObject({
    purchaseUnit: 'yd',
    purchaseQuantity: 1,
    amountPerPackage: 1,
    packagePrice: 2.99,
    quantity: 4,
    cost: 2.99,
    lot: 'Cotton lot',
  })
  expect(saved.expires).toBeUndefined()
  expect(state.ledger.find((l) => l.ingredientId === saved.id)).toMatchObject({
    amount: 11.96,
    lot: 'Cotton lot',
  })
  expect(
    state.ledger.find((l) => l.ingredientId === saved.id)?.expires,
  ).toBeUndefined()
  await handleFabric(
    'receive',
    'ingredients',
    {
      id: saved.id,
      name: saved.name,
      operationId: 'receive-two',
      quantity: 2,
      unit: 'yd',
      priceMode: 'per_unit',
      purchaseUnitPrice: 2.99,
      receivedDate: '2026-11-13',
      lot: 'Second lot',
    },
    ctx,
  )
  expect(state.ingredients.find((i) => i.id === saved.id)).toMatchObject({
    purchaseQuantity: 1,
    amountPerPackage: 1,
    packagePrice: 2.99,
    quantity: 6,
  })
  expect(state.ledger.find((l) => l.id === 'fabric-receive-two')).toMatchObject(
    {
      purchaseQuantity: 2,
      purchaseUnit: 'yd',
      amount: 5.98,
      lot: 'Second lot',
    },
  )
})

it.each(['2020-01-01', '2099-01-01', new Date().toISOString().slice(0, 10)])(
  'ignores historical fabric expiry %s while keeping ingredient expiry',
  (expires) => {
    const saved = { ...fabric, quantity: 4, threshold: 0, expires }
    expect(supportsExpiry(saved)).toBe(false)
    expect(stockStatus(saved)).toBe('In stock')
    expect(saved.expires).toBe(expires)
    const ingredient = {
      ...saved,
      usedAs: 'ingredient',
      materialType: undefined,
    }
    expect(supportsExpiry(ingredient)).toBe(true)
    if (expires === '2020-01-01')
      expect(stockStatus(ingredient)).toBe('Expired')
    if (expires === new Date().toISOString().slice(0, 10))
      expect(stockStatus(ingredient)).toBe('Expiring soon')
  },
)
