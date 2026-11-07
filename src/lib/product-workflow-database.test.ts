// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { Context } from '@netlify/functions'
import type { Item } from './domain'
const session = vi.hoisted(() => ({
  client: null as null | {
    query: (sql: string, params?: unknown[]) => Promise<unknown>
    release: () => void
  },
  user: 'trade-owner-a',
}))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({ pool: { connect: async () => session.client } }),
}))
vi.mock('../../netlify/lib/verified-session', async (original) => ({
  ...(await original<typeof import('../../netlify/lib/verified-session')>()),
  verifiedSession: async () => ({
    id: session.user,
    confirmedAt: '2026-01-01T00:00:00Z',
  }),
  selectedWorkspace: () => undefined,
}))
import handler from '../../netlify/functions/workspace.mts'
const db = new PGlite()
const a = '00000000-0000-4000-8000-000000000051',
  b = '00000000-0000-4000-8000-000000000052'
const context = { cookies: { get: () => 'a'.repeat(64) } } as unknown as Context
async function call(
  action?: string,
  table = '',
  data: Record<string, unknown> = {},
) {
  const response = await handler(
    new Request(
      'https://trade.invalid/api/workspace',
      action
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, table, data }),
          }
        : {},
    ),
    context,
  )
  return { status: response.status, ...(await response.json()) }
}
async function ok(
  action?: string,
  table = '',
  data: Record<string, unknown> = {},
) {
  const result = await call(action, table, data)
  expect(result.status, result.error).toBe(200)
  return result.workspace
}
const find = (rows: Item[], id: string) => rows.find((r) => r.id === id)!
beforeAll(async () => {
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root))
    await db.exec(
      await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
    )
  for (const [org, user] of [
    [a, 'trade-owner-a'],
    [b, 'trade-owner-b'],
  ]) {
    await db.query(
      'INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3)',
      [org, 'Trade acceptance', user],
    )
    await db.query(
      'INSERT INTO users(id,business_id,data,identity_id,role) VALUES($1,$2,$3,$4,$5)',
      ['owner', org, '{}', user, 'Owner'],
    )
    await db.query(
      'INSERT INTO settings(id,business_id,data) VALUES($1,$2,$3)',
      [
        'business',
        org,
        JSON.stringify({
          id: 'business',
          name: 'Trade acceptance',
          currency: 'USD',
          taxRates: [
            {
              id: 'food-tax',
              name: 'Food configured tax',
              jurisdiction: 'Test',
              ratePercent: 5,
              behavior: 'exclusive',
              appliesTo: 'all_products',
            },
            {
              id: 'nonfood-tax',
              name: 'Non-food configured tax',
              jurisdiction: 'Test',
              ratePercent: 10,
              behavior: 'exclusive',
              appliesTo: 'all_products',
            },
          ],
          productCategories: [
            { id: 'food', name: 'Packaged foods', classification: 'food' },
            { id: 'goods', name: 'Handmade goods', classification: 'non_food' },
          ],
          categoryTaxMappings: {
            food: ['food-tax'],
            non_food: ['nonfood-tax'],
          },
        }),
      ],
    )
  }
  for (const [user, role] of [
    ['trade-staff', 'Production Staff'],
    ['trade-reader', 'Read-only Accountant'],
  ])
    await db.query(
      'INSERT INTO users(id,business_id,data,identity_id,role) VALUES($1,$2,$3,$4,$5)',
      [user, a, '{}', user, role],
    )
  await db.exec(
    'CREATE ROLE trade_app; GRANT USAGE ON SCHEMA public TO trade_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO trade_app; SET ROLE trade_app;',
  )
  session.client = {
    query: (sql: string, params?: unknown[]) => db.query(sql, params),
    release() {},
  }
}, 30000)
afterAll(async () => {
  await db.close()
})
const material = {
  id: 'fabric',
  creationRequestId: 'fabric-initial',
  name: 'Cotton fabric',
  categoryId: 'craft-materials',
  usedAs: 'material',
  purchaseQuantity: 10,
  purchaseUnit: 'm',
  unit: 'm',
  packagePrice: 40,
  threshold: 1,
  currency: 'USD',
}
const design = {
  id: 'blanket-design',
  name: 'Small blanket design',
  workflow: 'handmade',
  yield: 2,
  laborMinutes: 60,
  laborRate: 12,
  overhead: 4,
  lines: [{ ingredientId: 'fabric', quantity: 2, unit: 'm' }],
}
const blanket = {
  id: 'blanket',
  name: 'Small blue blanket',
  workflow: 'handmade',
  recipeId: 'blanket-design',
  productCategoryId: 'goods',
  price: 40,
  variantGroup: 'Small blankets',
  variant: 'Blue',
  sku: 'BLU-S',
  barcode: '12345',
  threshold: 2,
}
const resale = {
  id: 'resale',
  name: 'Purchased jam',
  workflow: 'resale',
  productCategoryId: 'food',
  price: 8,
  threshold: 4,
}
const receipt = {
  id: 'resale',
  operationId: 'case-one',
  quantity: 2,
  unit: 'case',
  itemsPerUnit: 12,
  price: 72,
  reason: 'Two cases received',
  receivedDate: '2026-11-03',
  purchaseDate: '2026-07-30',
}
it('receives craft material, saves/reopens a design and product, completes actual production with waste and sells finished goods', async () => {
  let w = await ok('save', 'ingredients', material)
  expect(find(w.ingredients, 'fabric')).toMatchObject({
    usedAs: 'material',
    quantity: 10,
    unit: 'm',
    cost: 4,
  })
  const afterRetry = await ok('save', 'ingredients', material)
  expect(afterRetry.ledger).toHaveLength(w.ledger.length)
  await ok('save', 'recipes', design)
  await ok('save', 'products', blanket)
  w = await ok()
  expect(find(w.recipes, 'blanket-design').lines).toEqual(design.lines)
  expect(find(w.products, 'blanket')).toMatchObject({
    variant: 'Blue',
    sku: 'BLU-S',
    quantity: 0,
  })
  await ok('save', 'batches', {
    id: 'run-one',
    name: 'Blue blanket run',
    recipeId: design.id,
    productId: blanket.id,
    count: 1,
    yield: 2,
    date: '2026-11-03',
  })
  const completion = {
    id: 'run-one',
    actualYield: 2,
    usage: { fabric: 2 },
    materialWaste: { fabric: 0.5 },
    laborMinutes: 60,
    waste: 1,
    wasteReason: 'Trimming and damaged sample',
  }
  w = await ok('complete', 'batches', completion)
  expect(find(w.ingredients, 'fabric').quantity).toBe(7.5)
  expect(find(w.products, 'blanket')).toMatchObject({ quantity: 2, cost: 13 }) // 2.5m * 4 + 12 labor + 4 overhead
  expect(find(w.batches, 'run-one').costSnapshot).toMatchObject({
    total: 26,
    perItem: 13,
    laborRate: 12,
  })
  const movements = w.ledger.length
  w = await ok('complete', 'batches', completion)
  expect(w.ledger).toHaveLength(movements)
  expect(
    (await call('complete', 'batches', { ...completion, actualYield: 3 }))
      .status,
  ).toBe(400)
  await ok('save', 'recipes', { ...design, laborRate: 30 })
  expect(find((await ok()).batches, 'run-one').costSnapshot.laborRate).toBe(12)
  w = await ok('simpleSale', 'sales', {
    requestId: 'blanket-sale',
    date: '2026-11-03',
    saleLines: [{ productId: 'blanket', quantity: 1, amount: 40 }],
    fees: 0,
  })
  expect(find(w.products, 'blanket').quantity).toBe(1)
  const sale = w.sales.find((s: Item) => s.productId === 'blanket')
  expect(sale).toMatchObject({
    historicalCogs: 13,
    tax: 4,
    costSource: 'finished_weighted_average',
    categoryTaxSnapshot: { classification: 'non_food' },
  })
  expect(
    (
      await call('simpleSale', 'sales', {
        requestId: 'blanket-sale',
        date: '2026-11-03',
        saleLines: [{ productId: 'blanket', quantity: 1, amount: 40 }],
      })
    ).status,
  ).toBe(400)
  expect(find((await ok()).products, 'blanket').quantity).toBe(1)
  expect(
    (await call('save', 'products', { ...blanket, quantity: 999, cost: 0 }))
      .status,
  ).toBe(200)
  expect(find((await ok()).products, 'blanket')).toMatchObject({
    quantity: 1,
    cost: 13,
  })
})
it('receives cases without a recipe, verifies weighted-average basis, sale deduction, original-cost return and signed adjustment', async () => {
  await ok('save', 'products', resale)
  let w = await ok('receive', 'products', receipt)
  const movement = w.ledger.find(
    (l: Item) => l.sourceId === receipt.operationId,
  )
  expect(movement).toMatchObject({
    receivedDate: '2026-11-03',
    purchaseDate: '2026-07-30',
  })
  expect(w.journals.find((j: Item) => j.sourceId === movement.id).date).toBe(
    '2026-07-30',
  )
  expect(find(w.products, 'resale')).toMatchObject({
    quantity: 24,
    cost: 3,
    recipeId: null,
    lastReceivedUnitCost: 3,
  })
  const count = w.ledger.length
  w = await ok('receive', 'products', receipt)
  expect(w.ledger).toHaveLength(count)
  expect(
    (await call('receive', 'products', { ...receipt, price: 48 })).status,
  ).toBe(400)
  w = await ok('simpleSale', 'sales', {
    requestId: 'resale-sale',
    date: '2026-11-03',
    saleLines: [{ productId: 'resale', quantity: 3, amount: 24 }],
    fees: 0,
  })
  expect(find(w.products, 'resale').quantity).toBe(21)
  const sale = w.sales.find((s: Item) => s.productId === 'resale')
  expect(sale).toMatchObject({
    historicalCogs: 9,
    tax: 1.2,
    categoryTaxSnapshot: { classification: 'food' },
  })
  await ok('receive', 'products', {
    ...receipt,
    operationId: 'case-two',
    quantity: 1,
    itemsPerUnit: 3,
    price: 18,
  })
  w = await ok('refund', 'sales', { id: sale.id, restock: true })
  expect(find(w.products, 'resale').quantity).toBe(27)
  expect(find(w.products, 'resale').cost).toBeCloseTo(90 / 27, 7) // 21*3 + 18 + original 3*3
  expect(find(w.sales, sale.id).historicalCogs).toBe(9)
  expect(
    (await call('refund', 'sales', { id: sale.id, restock: true })).status,
  ).toBe(400)
  w = await ok('adjust', 'products', {
    id: 'resale',
    operationId: 'breakage',
    quantity: -2,
    reason: 'Two broken jars',
  })
  expect(find(w.products, 'resale').quantity).toBe(25)
  const adjustmentCount = w.ledger.length
  w = await ok('adjust', 'products', {
    id: 'resale',
    operationId: 'breakage',
    quantity: -2,
    reason: 'Two broken jars',
  })
  expect(w.ledger).toHaveLength(adjustmentCount)
  expect(
    (
      await call('adjust', 'products', {
        id: 'resale',
        operationId: 'bad-adjustment',
        quantity: -100,
        reason: 'Cannot remove more than stock',
      })
    ).status,
  ).toBe(400)
  expect(
    w.ledger
      .filter((l: Item) => l.productId === 'resale')
      .every(
        (l: Item) => l.actor === 'trade-owner-a' && l.occurredAt && l.sourceId,
      ),
  ).toBe(true)
})
it('rolls back all sale lines on insufficient stock and allows a refund without restocking', async () => {
  const before = await ok()
  expect(
    (
      await call('simpleSale', 'sales', {
        requestId: 'atomic-sale',
        date: '2026-11-03',
        saleLines: [
          { productId: 'resale', quantity: 1, amount: 8 },
          { productId: 'blanket', quantity: 99, amount: 1 },
        ],
      })
    ).status,
  ).toBe(400)
  let w = await ok()
  expect(w.ledger).toHaveLength(before.ledger.length)
  expect(w.sales).toHaveLength(before.sales.length)
  w = await ok('simpleSale', 'sales', {
    requestId: 'no-return-sale',
    date: '2026-11-03',
    saleLines: [{ productId: 'resale', quantity: 1, amount: 8 }],
  })
  const sale = w.sales.at(-1)
  w = await ok('refund', 'sales', { id: sale.id, restock: false })
  expect(find(w.products, 'resale').quantity).toBe(24)
  expect(w.sales.find((s: Item) => s.refundOf === sale.id).historicalCogs).toBe(
    0,
  )
})
it('rejects incompatible units, insufficient materials, workflow changes and food designs containing craft materials', async () => {
  expect(
    (
      await call('save', 'recipes', {
        ...design,
        id: 'bad-units',
        lines: [{ ingredientId: 'fabric', quantity: 1, unit: 'g' }],
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await call('save', 'recipes', {
        ...design,
        id: 'food-fabric',
        workflow: undefined,
      })
    ).status,
  ).toBe(400)
  expect(
    (await call('save', 'products', { ...blanket, workflow: 'resale' })).status,
  ).toBe(400)
  await ok('save', 'batches', {
    id: 'short-run',
    name: 'Too much material',
    recipeId: design.id,
    productId: blanket.id,
    count: 1,
    yield: 2,
    date: '2026-11-03',
  })
  const before = await ok()
  expect(
    (
      await call('complete', 'batches', {
        id: 'short-run',
        actualYield: 2,
        usage: { fabric: 999 },
        materialWaste: { fabric: 0 },
        laborMinutes: 1,
        waste: 0,
      })
    ).status,
  ).toBe(400)
  expect((await ok()).ledger).toHaveLength(before.ledger.length)
})
it('preserves food receipt, recipe completion, historical costing and sales behavior', async () => {
  await ok('save', 'ingredients', {
    ...material,
    id: 'flour',
    creationRequestId: 'food-input',
    name: 'Flour',
    categoryId: 'flour-grains',
    usedAs: 'ingredient',
    purchaseQuantity: 100,
    purchaseUnit: 'g',
    unit: 'g',
    packagePrice: 10,
  })
  await ok('save', 'recipes', {
    id: 'bread-design',
    name: 'Bread',
    yield: 2,
    yieldUnit: 'loaves',
    laborMinutes: 0,
    laborRate: 0,
    overhead: 0,
    lines: [{ ingredientId: 'flour', quantity: 20, unit: 'g' }],
  })
  await ok('save', 'products', {
    id: 'bread',
    name: 'Bread',
    workflow: 'food',
    recipeId: 'bread-design',
    productCategoryId: 'food',
    price: 8,
    unitsPerPackage: 1,
    unpacked: true,
  })
  await ok('save', 'batches', {
    id: 'bread-run',
    name: 'Bread run',
    recipeId: 'bread-design',
    productId: 'bread',
    count: 1,
    yield: 2,
    date: '2026-11-03',
  })
  let w = await ok('complete', 'batches', { id: 'bread-run', actualYield: 2 })
  expect(find(w.ingredients, 'flour').quantity).toBe(80)
  expect(find(w.products, 'bread').quantity).toBe(0)
  expect(w.ledger.some((l: Item) => l.productId === 'bread')).toBe(false)
  w = await ok('simpleSale', 'sales', {
    requestId: 'bread-sale',
    date: '2026-11-03',
    saleLines: [
      { productId: 'bread', quantity: 1, amount: 8, batchId: 'bread-run' },
    ],
  })
  expect(
    w.sales.find((sale: Item) => sale.productId === 'bread'),
  ).toMatchObject({
    historicalCogs: 1,
    tax: 0.4,
    costSource: 'completed_batch',
  })
  expect(find(w.ingredients, 'flour').quantity).toBe(80)
})
it('enforces immutable movements, completed runs and ledger-backed balances at the database boundary', async () => {
  await db.query("SELECT set_config('app.business_id',$1,false)", [a])
  await expect(
    db.query(
      "UPDATE products SET quantity=999 WHERE business_id=$1 AND id='resale'",
      [a],
    ),
  ).rejects.toThrow(/movement ledger/i)
  await expect(
    db.query(
      "UPDATE batches SET data='{}' WHERE business_id=$1 AND id='run-one'",
      [a],
    ),
  ).rejects.toThrow(/immutable/i)
  await expect(
    db.query(
      "DELETE FROM ledger WHERE business_id=$1 AND product_id='resale'",
      [a],
    ),
  ).rejects.toThrow(/immutable/i)
  expect(
    (
      await call('import', 'products', {
        rows: [
          {
            id: 'bypass',
            name: 'Forged stock',
            workflow: 'resale',
            quantity: 100,
            cost: 1,
          },
        ],
      })
    ).status,
  ).toBe(400)
  expect((await ok()).products.some((p: Item) => p.id === 'bypass')).toBe(false)
})
it('enforces real RLS, tenant foreign keys, role permissions and existing Free gates', async () => {
  session.user = 'trade-owner-b'
  expect((await ok()).products).toHaveLength(0)
  expect((await call('receive', 'products', receipt)).status).toBe(400)
  expect((await call('save', 'recipes', design)).status).toBe(400)
  expect((await call('save', 'products', blanket)).status).toBe(400)
  await db.query("SELECT set_config('app.business_id',$1,false)", [b])
  await expect(
    db.query(
      'INSERT INTO ledger(id,business_id,data,product_id) VALUES($1,$2,$3,$4)',
      ['foreign', b, '{}', 'blanket'],
    ),
  ).rejects.toThrow(/foreign key/i)
  session.user = 'trade-reader'
  expect((await call('receive', 'products', receipt)).error).toMatch(
    /read-only/,
  )
  session.user = 'trade-staff'
  expect((await call('save', 'recipes', design)).error).toMatch(
    /Owner or Manager/,
  )
  expect((await call('simpleSale', 'sales', {})).status).toBe(400)
  await ok('receive', 'products', {
    ...receipt,
    operationId: 'staff-receipt',
    quantity: 1,
  })
  session.user = 'trade-owner-a'
  await db.exec('RESET ROLE')
  await db.query(
    'INSERT INTO workspace_billing(business_id,plan_id,status,source,snapshot) VALUES($1,$2,$3,$4,$5)',
    [a, 'free', 'free_active', 'free_sandbox', '{}'],
  )
  await db.exec('SET ROLE trade_app')
  expect((await call('simpleSale', 'sales', {})).error).toMatch(
    /not available on Free/,
  )
  expect((await call('refund', 'sales', {})).error).toMatch(
    /not available on Free/,
  )
  const before = await ok()
  expect(
    (
      await call('save', 'ingredients', {
        ...material,
        id: 'material-two',
        creationRequestId: 'two',
        businessId: b,
        role: 'Owner',
      })
    ).status,
  ).toBe(200)
  expect((await ok()).ingredients).toHaveLength(before.ingredients.length + 1)
})

const yardage = {
  id: 'yardage',
  name: 'Indigo cotton · 44 inch',
  creationRequestId: 'yardage-create',
  usedAs: 'material',
  materialType: 'fabric',
  fabricTracking: 'length',
  pieceMode: 'aggregate',
  fabricWidth: 44,
  widthUnit: 'in',
  unit: 'yd',
  purchaseUnit: 'yd',
  purchaseQuantity: '3 1/2',
  packagePrice: 28,
  threshold: '1/2',
  color: 'Indigo',
  sku: 'IND44',
  receivedDate: '2026-11-03',
  purchaseDate: '2026-07-30',
}
it('receives fractional fabric, meters and confirmed bolts; saves exact quantities and independent widths', async () => {
  session.user = 'trade-owner-a'
  let w = await ok('save', 'ingredients', yardage)
  expect(
    w.journals.find((j: Item) => j.sourceId === 'fabric-yardage-create').date,
  ).toBe('2026-07-30')
  expect(find(w.ingredients, 'yardage')).toMatchObject({
    quantity: 3.5,
    cost: 8,
    threshold: 0.5,
    fabricWidth: 44,
    unit: 'yd',
  })
  const retry = await ok('save', 'ingredients', yardage)
  expect(retry.ledger).toHaveLength(w.ledger.length)
  w = await ok('receive', 'ingredients', {
    id: 'yardage',
    operationId: 'fabric-meter',
    quantity: '2.25',
    unit: 'm',
    price: 22.5,
  })
  const expected = 3.5 + 2.25 / 0.9144
  expect(find(w.ingredients, 'yardage').quantity).toBeCloseTo(expected, 14)
  expect(find((await ok()).ingredients, 'yardage').quantity).toBe(
    find(w.ingredients, 'yardage').quantity,
  )
  expect(find(w.ingredients, 'yardage').cost).toBeCloseTo(50.5 / expected, 14)
  const bolt = {
    id: 'yardage',
    operationId: 'bolt',
    quantity: 1,
    unit: 'bolt',
    price: 20,
    usableLength: '1 1/2',
    usableLengthUnit: 'yd',
  }
  expect((await call('receive', 'ingredients', bolt)).error).toMatch(/Confirm/)
  w = await ok('receive', 'ingredients', { ...bolt, lengthConfirmed: true })
  expect(find(w.ingredients, 'yardage').quantity).toBeCloseTo(
    expected + 1.5,
    14,
  )
  w = await ok('save', 'ingredients', {
    ...yardage,
    id: 'yardage-wide',
    creationRequestId: 'wide-create',
    name: 'Indigo cotton · 60 inch',
    fabricWidth: 60,
    purchaseQuantity: '.75',
  })
  expect(find(w.ingredients, 'yardage-wide').quantity).toBe(0.75)
  const item = find(w.ingredients, 'yardage')
  expect(
    (
      await call('fabricUpdate', 'ingredients', {
        ...item,
        operationId: 'change-width',
        expectedUpdatedAt: item.updatedAt,
        fabricWidth: 60,
      })
    ).error,
  ).toMatch(/fixed/)
  expect(
    (
      await call('conversion', 'ingredients', {
        id: 'yardage',
        ingredientId: 'yardage',
        from: 'yd',
        to: 'each',
        amountFrom: 1,
        amountTo: 1,
        verified: true,
      })
    ).status,
  ).toBe(400)
})
it('costs inches against yards, checks width and locks actual usage and waste exactly once', async () => {
  session.user = 'trade-owner-a'
  const fabricDesign = {
    id: 'fabric-design',
    name: 'Tote design',
    workflow: 'handmade',
    yield: 1,
    laborMinutes: 0,
    laborRate: 0,
    overhead: 0,
    lines: [
      {
        ingredientId: 'yardage',
        quantity: '18',
        unit: 'in',
        minimumWidth: 45,
        widthUnit: 'in',
      },
    ],
  }
  expect((await call('save', 'recipes', fabricDesign)).error).toMatch(
    /narrower/,
  )
  fabricDesign.lines[0].minimumWidth = 40
  await ok('save', 'recipes', fabricDesign)
  await ok('save', 'products', {
    id: 'tote',
    name: 'Indigo tote',
    workflow: 'handmade',
    recipeId: 'fabric-design',
    productCategoryId: 'goods',
    price: 30,
  })
  await ok('save', 'batches', {
    id: 'fabric-run',
    name: 'Tote run',
    recipeId: 'fabric-design',
    productId: 'tote',
    count: 1,
    yield: 1,
  })
  const before = find((await ok()).ingredients, 'yardage')
  const completion = {
    id: 'fabric-run',
    actualYield: 1,
    laborMinutes: 0,
    waste: 0,
    wasteReason: 'Edge trimming',
    usage: { yardage: '18' },
    materialWaste: { yardage: '1/2' },
  }
  let w = await ok('complete', 'batches', completion)
  expect(find(w.ingredients, 'yardage').quantity).toBeCloseTo(
    before.quantity - 18.5 / 36,
    14,
  )
  expect(find(w.products, 'tote').quantity).toBe(1)
  expect(find(w.batches, 'fabric-run').historicalCost).toBeCloseTo(
    (before.cost * 18.5) / 36,
    12,
  )
  const movements = w.ledger.length
  w = await ok('complete', 'batches', completion)
  expect(w.ledger).toHaveLength(movements)
  expect(
    (await call('complete', 'batches', { ...completion, actualYield: 2 }))
      .error,
  ).toMatch(/immutable/)
})
it('transfers usable remnants without double-counting, preserves pieces and rejects duplicate changes', async () => {
  session.user = 'trade-owner-a'
  const before = find((await ok()).ingredients, 'yardage')
  const transfer = {
    id: 'yardage',
    operationId: 'remnant-half',
    quantity: '1/2',
    unit: 'yd',
    pieceId: 'A-1',
    storageLocation: 'Drawer 2',
  }
  let w = await ok('fabricRemnant', 'ingredients', transfer)
  const child = find(w.ingredients, 'remnant-remnant-half')
  expect(child).toMatchObject({
    quantity: 0.5,
    fabricWidth: 44,
    widthUnit: 'in',
    pieceMode: 'separate',
    pieceId: 'A-1',
    cost: before.cost,
  })
  expect(find(w.ingredients, 'yardage').quantity + child.quantity).toBeCloseTo(
    before.quantity,
    14,
  )
  const count = w.ledger.length
  w = await ok('fabricRemnant', 'ingredients', transfer)
  expect(w.ledger).toHaveLength(count)
  expect(
    (
      await call('fabricRemnant', 'ingredients', {
        ...transfer,
        quantity: '.75',
      })
    ).error,
  ).toMatch(/different values/)
  expect(
    (
      await call('receive', 'ingredients', {
        id: child.id,
        operationId: 'combine-pieces',
        quantity: '.5',
        unit: 'yd',
        price: 4,
      })
    ).error,
  ).toMatch(/one piece/)
  w = await ok('save', 'ingredients', {
    ...yardage,
    id: 'piece-two',
    creationRequestId: 'piece-two',
    purchaseQuantity: '1/2',
    pieceMode: 'separate',
    pieceId: 'A-2',
  })
  expect(
    w.ingredients
      .filter((i: Item) => ['remnant-remnant-half', 'piece-two'].includes(i.id))
      .map((i: Item) => i.quantity),
  ).toEqual([0.5, 0.5])
  w = await ok('adjust', 'ingredients', {
    id: 'piece-two',
    operationId: 'fabric-waste',
    quantity: '-1/4',
    unit: 'yd',
    type: 'waste',
    reason: 'Damaged edge',
  })
  expect(find(w.ingredients, 'piece-two').quantity).toBe(0.25)
  expect(
    (
      await call('fabricRemnant', 'ingredients', {
        ...transfer,
        operationId: 'overdraw',
        quantity: 100,
      })
    ).error,
  ).toMatch(/exceeds/)
})
it('tracks precuts by count and enforces fabric tenant ownership and permissions', async () => {
  session.user = 'trade-owner-a'
  let w = await ok('save', 'ingredients', {
    ...yardage,
    id: 'precut',
    creationRequestId: 'precut',
    fabricTracking: 'precut',
    unit: 'each',
    purchaseUnit: 'each',
    purchaseQuantity: 8,
    pieceLength: 18,
    pieceLengthUnit: 'in',
    packagePrice: 32,
  })
  expect(find(w.ingredients, 'precut')).toMatchObject({
    quantity: 8,
    unit: 'each',
    cost: 4,
    pieceLength: 18,
  })
  expect(
    (
      await call('receive', 'ingredients', {
        id: 'precut',
        operationId: 'precut-yard',
        quantity: 1,
        unit: 'yd',
        price: 4,
      })
    ).error,
  ).toMatch(/Precuts/)
  session.user = 'trade-owner-b'
  expect(
    (
      await call('receive', 'ingredients', {
        id: 'yardage',
        operationId: 'foreign-fabric',
        quantity: 1,
        unit: 'yd',
        price: 4,
      })
    ).status,
  ).toBe(400)
  session.user = 'trade-reader'
  expect(
    (
      await call('adjust', 'ingredients', {
        id: 'yardage',
        operationId: 'reader-fabric',
        quantity: -1,
        unit: 'yd',
        reason: 'Count',
      })
    ).error,
  ).toMatch(/read-only/)
  session.user = 'trade-staff'
  expect(
    (
      await call('fabricRemnant', 'ingredients', {
        id: 'yardage',
        operationId: 'staff-remnant',
        quantity: 1,
        unit: 'yd',
        pieceId: 'S-1',
      })
    ).error,
  ).toMatch(/Owner or Manager/)
  session.user = 'trade-owner-a'
})
it('matches receipt lines to fabric and applies existing tax allocation without duplicate receipts', async () => {
  session.user = 'trade-owner-b'
  await ok('save', 'ingredients', {
    ...yardage,
    id: 'receipt-fabric',
    creationRequestId: 'receipt-fabric',
    purchaseQuantity: '1/4',
    packagePrice: 2,
  })
  let w = await ok('receiptManual', '', {})
  const receipt = w.receipt_extractions[w.receipt_extractions.length - 1]
  const line = {
    id: 'fabric-line',
    description: 'Cotton yardage',
    amount: 20,
    decision: 'inventory',
    itemId: 'receipt-fabric',
    quantity: '1 1/2',
    unit: 'm',
    stockQuantityConfirmed: true,
  }
  w = await ok('receiptDraft', '', {
    id: receipt.id,
    vendor: 'Textile mill',
    date: '2026-11-03',
    currency: 'USD',
    receiptNumber: 'FAB-100',
    subtotal: 20,
    tax: 2,
    total: 22,
    lines: [line],
  })
  w = await ok('receiptPost', '', { id: receipt.id })
  const qty = 0.25 + 1.5 / 0.9144
  expect(find(w.ingredients, 'receipt-fabric').quantity).toBeCloseTo(qty, 14)
  expect(find(w.ingredients, 'receipt-fabric').cost).toBeCloseTo(24 / qty, 14)
  expect(find(w.receipt_extractions, receipt.id).postedLines[0]).toMatchObject({
    taxShare: 2,
  })
  expect(w.ledger.find((l: Item) => l.receiptId === receipt.id).amount).toBe(22)
  const movements = w.ledger.length
  expect((await call('receiptPost', '', { id: receipt.id })).status).toBe(400)
  expect((await ok()).ledger).toHaveLength(movements)
  session.user = 'trade-owner-a'
})
it('updates fabric metadata without changing stock, valuation or width and cannot bypass piece safeguards', async () => {
  session.user = 'trade-owner-a'
  const before = find((await ok()).ingredients, 'piece-two')
  const w = await ok('fabricUpdate', 'ingredients', {
    ...before,
    operationId: 'fabric-meta',
    expectedUpdatedAt: before.updatedAt,
    color: 'Midnight',
    notes: 'Usable piece',
    quantity: 900,
    cost: 0,
  })
  const updated = find(w.ingredients, 'piece-two')
  expect(updated).toMatchObject({
    color: 'Midnight',
    notes: 'Usable piece',
    quantity: before.quantity,
    cost: before.cost,
  })
  expect(
    (
      await call('receive', 'ingredients', {
        id: 'piece-two',
        ingredientId: 'fabric',
        operationId: 'spoof-piece',
        quantity: '.5',
        unit: 'yd',
        price: 4,
      })
    ).error,
  ).toMatch(/one piece/)
})
it('receives fabric priced per yard or meter using confirmed purchase quantity', async () => {
  session.user = 'trade-owner-a'
  let w = await ok('save', 'ingredients', {
    ...yardage,
    id: 'unit-price-fabric',
    creationRequestId: 'unit-price-fabric',
    priceMode: 'per_unit',
    purchaseUnitPrice: 8,
    packagePrice: '',
  })
  expect(find(w.ingredients, 'unit-price-fabric')).toMatchObject({
    quantity: 3.5,
    cost: 8,
    packagePrice: 28,
  })
  w = await ok('receive', 'ingredients', {
    id: 'unit-price-fabric',
    operationId: 'unit-price-meters',
    quantity: '1 1/2',
    unit: 'm',
    priceMode: 'per_unit',
    purchaseUnitPrice: 10,
  })
  expect(find(w.ingredients, 'unit-price-fabric').quantity).toBeCloseTo(
    3.5 + 1.5 / 0.9144,
    14,
  )
  expect(find(w.ingredients, 'unit-price-fabric').cost).toBeCloseTo(
    43 / (3.5 + 1.5 / 0.9144),
    14,
  )
})

it('enforces the clarified Kitchen and Mercantile modules through the real workspace API without deleting history', async () => {
  session.user = 'trade-owner-a'
  const before = await ok()
  await db.query("SELECT set_config('app.billing_worker','true',false)")
  await db.query(
    "INSERT INTO workspace_billing(business_id,plan_id,source,status,environment,paid_through) VALUES($1,'cottage-kitchen','square_sandbox','paid_active','sandbox','2099-01-01') ON CONFLICT(business_id) DO UPDATE SET plan_id='cottage-kitchen',source='square_sandbox',status='paid_active',environment='sandbox',paid_through='2099-01-01',entitlement_policy='kitchen-two-v1'",
    [a],
  )
  await db.query("SELECT set_config('app.billing_worker','false',false)")
  const excludedProduct = await call('save', 'products', {
    ...resale,
    id: 'blocked-resale',
  })
  expect(excludedProduct.status).toBe(400)
  expect(excludedProduct.error).toMatch(/not included|excludes/)
  const excludedConsignor = await call('consignorSave', '', {
    name: 'Blocked consignor',
  })
  expect(excludedConsignor.status).toBe(400)
  expect(excludedConsignor.error).toMatch(/not included|excludes/)
  session.user = 'trade-staff'
  const secondLogin = await call('consignmentSale', '', { quantity: 1 })
  expect(secondLogin.status).toBe(400)
  expect(secondLogin.error).toMatch(/not included/)
  session.user = 'trade-owner-a'
  const indirectSale = await call('simpleSale', 'sales', {
    id: 'blocked-sale',
    productId: 'resale',
    quantity: 1,
    price: 8,
    date: '2026-11-04',
    dateAuthority: 'business',
  })
  expect(indirectSale.status).toBe(400)
  const after = await ok()
  expect(after.products).toEqual(before.products)
  expect(after.sales).toEqual(before.sales)
  expect(after.ledger).toEqual(before.ledger)
  const craft = after.ingredients.find(
    (row: Item) => row.materialType === 'fabric',
  )
  await ok('fabricUpdate', 'ingredients', {
    id: craft.id,
    operationId: 'kitchen-craft-edit',
    expectedUpdatedAt: craft.updatedAt,
    notes: 'Two-user Kitchen includes craft materials',
  })
  await db.query("SELECT set_config('app.billing_worker','true',false)")
  await db.query(
    "UPDATE workspace_billing SET plan_id='cottage-mercantile' WHERE business_id=$1",
    [a],
  )
  await db.query("SELECT set_config('app.billing_worker','false',false)")
  const full = await ok('consignorSave', '', { name: 'Included consignor' })
  expect(
    full.consignors.some((row: Item) => row.name === 'Included consignor'),
  ).toBe(true)
})
