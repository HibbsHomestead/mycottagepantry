// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import { breadBaseFixture } from '@/test/fixtures/bread-base'
import { costBreakdown, type Item } from './domain'

const runtime = vi.hoisted(() => ({
  client: null as any,
  user: 'base-test-owner',
}))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({ pool: { connect: async () => runtime.client } }),
}))
vi.mock('../../netlify/lib/verified-session', async (original) => ({
  ...(await original<typeof import('../../netlify/lib/verified-session')>()),
  verifiedSession: async () => ({
    id: runtime.user,
    confirmedAt: '2026-01-01T00:00:00Z',
  }),
  selectedWorkspace: () => undefined,
}))
import handler from '../../netlify/functions/workspace.mts'
const db = new PGlite()
const org = '00000000-0000-4000-8000-000000000061'
const other = '00000000-0000-4000-8000-000000000062'
const context = { cookies: { get: () => 'a'.repeat(64) } } as any
async function request(body?: any) {
  const res = await handler(
    new Request(
      'https://base-test.invalid/api/workspace',
      body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {},
    ),
    context,
  )
  return { status: res.status, ...(await res.json()) }
}
beforeAll(async () => {
  // All SQL runs in a disposable local engine; no platform database connection.
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root))
    await db.exec(
      await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
    )
  const w = breadBaseFixture()
  delete w.recipes[1].baseRecipeId
  for (const r of w.recipes) delete r.baseRecipe
  for (const [business, user] of [
    [org, 'base-test-owner'],
    [other, 'other-test-owner'],
  ]) {
    await db.query(
      'INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3)',
      [business, 'Isolated bread test', user],
    )
    await db.query(
      'INSERT INTO users(id,business_id,data,identity_id,role) VALUES($1,$2,$3,$4,$5)',
      ['owner', business, '{}', user, 'Owner'],
    )
    await db.query(
      'INSERT INTO settings(id,business_id,data) VALUES($1,$2,$3)',
      [
        'business',
        business,
        JSON.stringify({
          id: 'business',
          name: 'Isolated bread test',
          currency: 'USD',
          taxRates: [],
        }),
      ],
    )
    for (const r of w.recipes)
      await db.query(
        'INSERT INTO recipes(id,business_id,data) VALUES($1,$2,$3)',
        [r.id, business, JSON.stringify(r)],
      )
  }
  for (const i of [
    ...w.ingredients,
    ...['empty-jar', 'history-jar'].map((id) => ({
      id,
      name: id,
      unit: 'ml',
      storageUnit: 'cup',
      recipeUnit: 'oz',
      quantity: 0,
      cost: 0.1,
      currentCost: 0.1,
      purchaseQuantity: 1,
      purchaseUnit: 'jar',
      packagePrice: 6.98,
      threshold: 0,
      reorderQuantity: 0,
      currency: 'USD',
      conversions: [
        {
          from: 'jar',
          to: 'cup',
          amountFrom: 1,
          amountTo: 0.375,
          verified: true,
        },
      ],
    })),
    {
      id: 'applesauce',
      name: 'Applesauce',
      unit: 'each',
      storageUnit: 'each',
      recipeUnit: 'each',
      usedAs: 'ingredient',
      quantity: 0,
      cost: 2,
      currentCost: 2,
      purchaseQuantity: 1,
      purchaseUnit: 'each',
      packagePrice: 2,
      threshold: 0,
      currency: 'USD',
      conversions: [],
    },
  ])
    await db.query(
      'INSERT INTO ingredients(id,business_id,data,quantity,cost) VALUES($1,$2,$3,$4,$5)',
      [i.id, org, JSON.stringify(i), i.quantity, i.cost],
    )
  await db.query(
    'INSERT INTO ledger(id,business_id,data,ingredient_id) VALUES($1,$2,$3,$4)',
    [
      'history-jar-count',
      org,
      JSON.stringify({
        id: 'history-jar-count',
        name: 'Past count',
        ingredientId: 'history-jar',
        quantity: 0,
        unit: 'ml',
        amount: 0,
        type: 'inventory_count',
      }),
      'history-jar',
    ],
  )
  await db.exec(
    'CREATE ROLE base_test_app; GRANT USAGE ON SCHEMA public TO base_test_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO base_test_app; SET ROLE base_test_app;',
  )
  runtime.client = {
    query: (sql: string, args?: any[]) => db.query(sql, args),
    release() {},
  }
}, 30000)
afterAll(async () => db.close())

it('changes an explicitly confirmed empty jar to weight without posting stock or inferring density', async () => {
  const w = (await request()).workspace
  const existing = w.ingredients.find((i: Item) => i.id === 'empty-jar')
  const data = {
    ...existing,
    expectedUpdatedAt: existing.updatedAt,
    storageUnit: 'oz',
    threshold: 0,
    reorderQuantity: 0,
    purchaseSetup: { packageUnit: 'jar', price: 6.98, stockUnits: 3 },
  }
  const unconfirmed = await request({ action: 'ingredientUpdate', data })
  expect(unconfirmed.status).toBe(400)
  expect(unconfirmed.error).toContain('Confirm the new stock basis')
  const simultaneousOpening = await request({
    action: 'ingredientUpdate',
    data: {
      ...data,
      confirmEmptyStockUnitChange: true,
      openingStock: {
        enabled: true,
        operationId: 'jar-basis-opening',
        quantity: 1,
        unit: 'cup',
        value: 1,
        date: '2026-11-08',
      },
    },
  })
  expect(simultaneousOpening.status).toBe(400)
  expect(simultaneousOpening.error).toContain('Save the new stock basis first')
  const result = await request({
    action: 'ingredientUpdate',
    data: { ...data, confirmEmptyStockUnitChange: true },
  })
  expect(result.status, result.error).toBe(200)
  expect(
    result.workspace.ingredients.find((i: Item) => i.id === existing.id),
  ).toMatchObject({
    unit: 'g',
    storageUnit: 'oz',
    recipeUnit: 'oz',
    purchaseUnit: 'jar',
    quantity: 0,
    conversions: [{ from: 'jar', to: 'oz', amountTo: 3, verified: true }],
  })
  expect(result.workspace.ledger).toEqual(w.ledger)
  expect(result.workspace.journals).toEqual(w.journals)
})

it('protects a zero-balance jar with history and accepts only an explicit measured conversion', async () => {
  const w = (await request()).workspace
  const existing = w.ingredients.find((i: Item) => i.id === 'history-jar')
  const data = {
    ...existing,
    expectedUpdatedAt: existing.updatedAt,
    storageUnit: 'oz',
    threshold: 0,
    reorderQuantity: 0,
    purchaseSetup: { packageUnit: 'jar', price: 6.98, stockUnits: 3 },
    confirmEmptyStockUnitChange: true,
    hasStockHistory: false,
  }
  const denied = await request({ action: 'ingredientUpdate', data })
  expect(denied.status).toBe(400)
  expect(denied.error).toContain('Stock/history')
  const unchanged = (await request()).workspace
  expect(unchanged.ingredients.find((i: Item) => i.id === existing.id)).toEqual(
    existing,
  )
  const measured = await request({
    action: 'ingredientUpdate',
    data: {
      ...data,
      conversions: [
        ...existing.conversions,
        {
          from: 'cup',
          to: 'oz',
          amountFrom: 1,
          amountTo: 8,
          verified: true,
          source: 'user_entered',
          notes: 'Synthetic measured conversion',
        },
      ],
    },
  })
  expect(measured.status, measured.error).toBe(200)
  expect(
    measured.workspace.ingredients.find((i: Item) => i.id === existing.id),
  ).toMatchObject({
    unit: 'ml',
    storageUnit: 'oz',
    quantity: existing.quantity,
    cost: existing.cost,
  })
  expect(measured.workspace.ledger).toEqual(w.ledger)
  expect(measured.workspace.journals).toEqual(w.journals)
})

it('posts applesauce opening stock as each once; retries, unrelated saves and invalid operations preserve history', async () => {
  let w = (await request()).workspace
  const item = w.ingredients.find((i: Item) => i.id === 'applesauce')
  const data = {
    ...item,
    expectedUpdatedAt: item.updatedAt,
    openingStock: {
      enabled: true,
      operationId: 'opening-api-once',
      quantity: 3,
      unit: 'each',
      value: 6,
      date: '2026-11-08',
    },
  }
  const saved = await request({ action: 'ingredientUpdate', data })
  expect(saved.status, saved.error).toBe(200)
  w = saved.workspace
  expect(w.ingredients.find((i: Item) => i.id === item.id)).toMatchObject({
    quantity: 3,
    unit: 'each',
    storageUnit: 'each',
    cost: 2,
  })
  expect(
    w.ledger.filter((l: Item) => l.ingredientId === item.id),
  ).toMatchObject([{ quantity: 3, unit: 'each', type: 'opening_balance' }])
  expect((await request({ action: 'ingredientUpdate', data })).status).toBe(200)
  const changedRetry = await request({
    action: 'ingredientUpdate',
    data: { ...data, notes: 'Changed after an uncertain save' },
  })
  expect(changedRetry.status).toBe(400)
  expect(changedRetry.error).toContain('changed details remain in this draft')
  const reopened = (await request()).workspace.ingredients.find(
    (i: Item) => i.id === item.id,
  )
  const ordinary = await request({
    action: 'ingredientUpdate',
    data: {
      ...reopened,
      expectedUpdatedAt: reopened.updatedAt,
      notes: 'Unrelated edit',
    },
  })
  expect(ordinary.status, ordinary.error).toBe(200)
  expect(
    ordinary.workspace.ingredients.find((i: Item) => i.id === item.id).quantity,
  ).toBe(3)
  expect(
    ordinary.workspace.ledger.filter((l: Item) => l.ingredientId === item.id),
  ).toHaveLength(1)
  const duplicate = await request({
    action: 'ingredientUpdate',
    data: {
      ...data,
      openingStock: {
        ...data.openingStock,
        operationId: 'second-opening',
      },
    },
  })
  expect(duplicate.status).toBe(400)
  const mismatch = await request({
    action: 'ingredientUpdate',
    data: { ...data, openingStock: { ...data.openingStock, unit: 'g' } },
  })
  expect(mismatch.status).toBe(400)
  expect(
    (await request()).workspace.ledger.filter(
      (l: Item) => l.ingredientId === item.id,
    ),
  ).toHaveLength(1)
})

it('links explicit bread batches without stock, consumes raw ingredients once and retains completed snapshots', async () => {
  let w = (await request()).workspace
  const originalBase = structuredClone(
    w.recipes.find((r: Item) => r.id === 'bread'),
  )
  const variation = w.recipes.find((r: Item) => r.id === 'spinach-parmesan')
  const ledgerBefore = structuredClone(w.ledger)
  const linked = await request({
    action: 'save',
    table: 'recipes',
    data: { ...variation, baseRecipeId: 'bread', baseMultiplier: 0.5 },
  })
  expect(linked.status, linked.error).toBe(200)
  w = linked.workspace
  expect(w.ledger).toEqual(ledgerBefore)
  expect(w.recipes.find((r: Item) => r.id === 'bread')).toEqual(originalBase)
  expect(w.ingredients.some((i: Item) => i.compoundRecipeId === 'bread')).toBe(
    false,
  )
  expect(
    costBreakdown(
      w.recipes.find((r: Item) => r.id === variation.id),
      w.ingredients,
    ).total,
  ).toBeCloseTo(4.97)
  const scheduled = await request({
    action: 'save',
    table: 'batches',
    data: {
      id: 'base-run',
      name: variation.name,
      recipeId: variation.id,
      count: 2,
      yield: 6,
      date: '2026-11-08',
      status: 'scheduled',
    },
  })
  expect(scheduled.status, scheduled.error).toBe(200)
  const completed = await request({
    action: 'complete',
    data: {
      id: 'base-run',
      actualYield: 6,
      laborMinutes: 10,
      usage: { flour: 1050 },
    },
  })
  expect(completed.status, completed.error).toBe(200)
  w = completed.workspace
  const batch = w.batches.find((b: Item) => b.id === 'base-run')
  expect(batch.usage).toHaveLength(6)
  expect(
    batch.usage.find((l: Item) => l.ingredientId === 'flour').quantity,
  ).toBe(1050)
  expect(
    batch.usage.find((l: Item) => l.ingredientId === 'spinach').quantity,
  ).toBe(160)
  expect(
    batch.usage.find((l: Item) => l.ingredientId === 'parmesan').quantity,
  ).toBe(100)
  expect(w.ingredients.find((i: Item) => i.id === 'flour').quantity).toBe(8950)
  expect(w.ledger.filter((l: Item) => l.batchId === 'base-run')).toHaveLength(6)
  expect(batch.costSnapshot.ingredient).toBeCloseTo(5.04)
  expect(batch.costSnapshot.laborMinutes).toBe(10)
  expect(batch.costSnapshot.laborRate).toBe(18)
  expect(batch.costSnapshot.labor).toBe(3)
  expect(batch.historicalCost).toBeCloseTo(10.04)
  const snapshot = structuredClone(batch)
  expect(
    (
      await request({
        action: 'complete',
        data: { id: 'base-run', actualYield: 6 },
      })
    ).status,
  ).toBe(400)
  const source = w.recipes.find((r: Item) => r.id === 'bread')
  source.lines[0].quantity = 1200
  const changed = await request({
    action: 'save',
    table: 'recipes',
    data: source,
  })
  expect(changed.status, changed.error).toBe(200)
  expect(
    changed.workspace.batches.find((b: Item) => b.id === 'base-run'),
  ).toEqual(snapshot)
  expect(
    costBreakdown(
      changed.workspace.recipes.find((r: Item) => r.id === variation.id),
      changed.workspace.ingredients,
    ).ingredient,
  ).toBeCloseTo(2.67)
  expect(changed.workspace.ledger).toEqual(w.ledger)
})

it('enforces tenant isolation, composite foreign keys and positive base multipliers in SQL', async () => {
  await db.exec('BEGIN')
  await db.query("SELECT set_config('app.business_id',$1,true)", [other])
  expect((await db.query('SELECT * FROM recipe_base_links')).rows).toHaveLength(
    0,
  )
  await expect(
    db.query(
      'INSERT INTO recipe_base_links(id,business_id,data,recipe_id,base_recipe_id,multiplier) VALUES($1,$2,$3,$4,$5,$6)',
      ['forged', org, '{}', 'spinach-parmesan', 'bread', 1],
    ),
  ).rejects.toThrow(/row.level security/)
  await db.exec('ROLLBACK')
  for (const [baseId, multiplier] of [
    ['unavailable', 1],
    ['bread', 0],
    ['spinach-parmesan', 1],
  ]) {
    await db.exec('BEGIN')
    await db.query("SELECT set_config('app.business_id',$1,true)", [other])
    await expect(
      db.query(
        'INSERT INTO recipe_base_links(id,business_id,data,recipe_id,base_recipe_id,multiplier) VALUES($1,$2,$3,$4,$5,$6)',
        ['invalid', other, '{}', 'spinach-parmesan', baseId, multiplier],
      ),
    ).rejects.toThrow()
    await db.exec('ROLLBACK')
  }
})
