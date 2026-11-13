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
  user: 'production-owner-a',
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
    [a, 'production-owner-a'],
    [b, 'production-owner-b'],
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
    ['production-staff', 'Production Staff'],
    ['production-reader', 'Read-only Accountant'],
  ])
    await db.query(
      'INSERT INTO users(id,business_id,data,identity_id,role) VALUES($1,$2,$3,$4,$5)',
      [user, a, '{}', user, role],
    )
  const seed: Record<string, Item[]> = {
    ingredients: [
      {
        id: 'flour',
        name: 'Flour',
        unit: 'g',
        quantity: 10000,
        cost: 0.01,
        currentCost: 0.01,
      },
      {
        id: 'bag',
        name: 'Bread bag',
        unit: 'each',
        quantity: 100,
        cost: 0.2,
        currentCost: 0.2,
        usedAs: 'packaging',
      },
      {
        id: 'box',
        name: 'Kit box',
        unit: 'each',
        quantity: 20,
        cost: 1,
        currentCost: 1,
        usedAs: 'packaging',
      },
    ],
    recipes: [
      {
        id: 'bread',
        name: 'Bread recipe',
        yield: 4,
        yieldUnit: 'each',
        laborMinutes: 20,
        laborRate: 12,
        overhead: 0,
        wastePercent: 0,
        lines: [{ ingredientId: 'flour', quantity: 400, unit: 'g' }],
      },
    ],
    products: [
      {
        id: 'loaf',
        name: 'Bread loaf',
        workflow: 'food',
        recipeId: 'bread',
        unitsPerPackage: 1,
        price: 8,
        quantity: 0,
        cost: 0,
        packagingLines: [{ ingredientId: 'bag', quantity: 1, unit: 'each' }],
      },
      {
        id: 'loaf-pair',
        name: 'Bread pair',
        workflow: 'food',
        recipeId: 'bread',
        unitsPerPackage: 2,
        price: 15,
        quantity: 0,
        cost: 0,
      },
      {
        id: 'kit',
        name: 'Bread kit',
        workflow: 'kit',
        status: 'active',
        quantity: 0,
        cost: 0,
        price: 19,
        assemblyMinutes: 6,
        assemblyRate: 10,
        kitComponents: [{ productId: 'loaf', quantity: 2, basis: 'package' }],
        packagingLines: [{ ingredientId: 'box', quantity: 1, unit: 'each' }],
      },
    ],
    batches: [
      {
        id: 'legacy-completed',
        name: 'Historical bread',
        recipeId: 'bread',
        status: 'completed',
        count: 1,
        yield: 4,
        historicalCost: 123,
        costSnapshot: { total: 123 },
      },
    ],
  }
  for (const [table, rows] of Object.entries(seed))
    for (const item of rows) {
      const columns =
        table === 'ingredients' || table === 'products'
          ? ',quantity,cost'
          : table === 'batches'
            ? ',recipe_id'
            : ''
      const args: unknown[] = [item.id, a, JSON.stringify(item)]
      if (table === 'ingredients' || table === 'products')
        args.push(item.quantity, item.cost)
      if (table === 'batches') args.push(item.recipeId)
      await db.query(
        `INSERT INTO ${table}(id,business_id,data${columns}) VALUES(${args.map((_, i) => '$' + (i + 1)).join(',')})`,
        args,
      )
    }
  await db.exec(
    'CREATE ROLE production_app; GRANT USAGE ON SCHEMA public TO production_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO production_app; SET ROLE production_app;',
  )
  session.client = {
    query: (sql: string, params?: unknown[]) => db.query(sql, params),
    release() {},
  }
}, 30000)
afterAll(async () => {
  await db.close()
})

const mapping = { quantity: 1, unit: 'each', verified: true }
const plan = (id: string, productId = 'loaf', quantity = 4) => ({
  id,
  productId,
  quantity,
  mapping,
  date: '2026-11-13',
  status: 'scheduled',
})
it('drafts save and cancel without stock movement; missing mappings block scheduling', async () => {
  const before = await ok()
  const draft = await ok('productionSave', 'batches', {
    ...plan('draft-run'),
    status: 'draft',
    mapping: {},
  })
  expect(find(draft.batches, 'draft-run').status).toBe('draft')
  expect(draft.ledger).toEqual(before.ledger)
  expect(
    (
      await call('productionSave', 'batches', {
        ...plan('draft-run'),
        mapping: {},
      })
    ).status,
  ).toBe(400)
  const canceled = await ok('productionCancel', 'batches', { id: 'draft-run' })
  expect(canceled.ledger).toEqual(before.ledger)
  expect(find(canceled.batches, 'draft-run').status).toBe('canceled')
})
it('fractional scaling receives only requested packages, retry posts once, and history stays fixed', async () => {
  const before = await ok()
  const planned = await ok(
    'productionSave',
    'batches',
    plan('produce-three', 'loaf', 3),
  )
  expect(find(planned.batches, 'produce-three').count).toBe(0.75)
  expect(planned.ledger).toEqual(before.ledger)
  const actual = { id: 'produce-three', output: 3, waste: 0 }
  const done = await ok('productionComplete', 'batches', actual)
  expect(find(done.products, 'loaf').quantity).toBe(3)
  expect(find(done.products, 'loaf').foodStockEnabled).toBe(true)
  expect(find(done.ingredients, 'flour').quantity).toBe(9700)
  expect(find(done.ingredients, 'bag').quantity).toBe(97)
  expect(find(done.batches, 'produce-three').historicalCost).toBeCloseTo(6.6)
  const retry = await ok('productionComplete', 'batches', actual)
  expect(retry.ledger).toEqual(done.ledger)
  expect(retry.journals).toEqual(done.journals)
  expect(find(retry.batches, 'legacy-completed')).toEqual(
    find(before.batches, 'legacy-completed'),
  )
  expect(
    (await call('productionComplete', 'batches', { ...actual, output: 4 }))
      .status,
  ).toBe(400)
  expect(
    (await call('complete', 'batches', { id: 'produce-three', actualYield: 3 }))
      .status,
  ).toBe(400)
})
it('assembly consumes finished stock and outer packaging once, never component raw materials', async () => {
  const before = await ok()
  await ok('productionSave', 'batches', plan('assemble-one', 'kit', 1))
  const done = await ok('productionComplete', 'batches', {
    id: 'assemble-one',
    output: 1,
    waste: 0,
  })
  expect(find(done.products, 'loaf').quantity).toBe(1)
  expect(find(done.products, 'kit').quantity).toBe(1)
  expect(find(done.ingredients, 'flour').quantity).toBe(
    find(before.ingredients, 'flour').quantity,
  )
  expect(find(done.ingredients, 'bag').quantity).toBe(
    find(before.ingredients, 'bag').quantity,
  )
  expect(find(done.ingredients, 'box').quantity).toBe(19)
  expect(find(done.batches, 'assemble-one').historicalCost).toBeCloseTo(6.4)
  await ok('productionSave', 'batches', plan('assemble-short', 'kit', 1))
  expect(
    (
      await call('productionComplete', 'batches', {
        id: 'assemble-short',
        output: 1,
        waste: 0,
      })
    ).status,
  ).toBe(400)
  expect((await ok()).ledger).toEqual(done.ledger)
  expect(
    (await call('productionCancel', 'batches', { id: 'assemble-one' })).status,
  ).toBe(400)
})
it('products sharing a recipe stay explicit, scheduled definitions stay pinned, and tenant references are rejected', async () => {
  const planned = await ok('productionSave', 'batches', {
    ...plan('pair-run', 'loaf-pair', 1),
    mapping: { quantity: 2, unit: 'each', verified: true },
  })
  expect(find(planned.batches, 'pair-run').productId).toBe('loaf-pair')
  expect(find(planned.batches, 'pair-run').count).toBe(0.5)
  expect(
    (
      await call(
        'productionSave',
        'batches',
        plan('bad-target', 'other-tenant-product'),
      )
    ).status,
  ).toBe(400)
  expect(
    (
      await call('productionSave', 'batches', {
        ...plan('bad-conversion'),
        mapping: { quantity: 1, unit: 'g', verified: true },
      })
    ).status,
  ).toBe(400)
  session.user = 'production-owner-b'
  expect(
    (await call('productionComplete', 'batches', { id: 'pair-run', output: 1 }))
      .status,
  ).toBe(400)
  session.user = 'production-owner-a'
  const done = await ok('productionComplete', 'batches', {
    id: 'pair-run',
    output: 1,
  })
  expect(find(done.products, 'loaf-pair').quantity).toBe(1)
})
it('new tracked food sales deduct finished stock and post stock COGS once', async () => {
  const before = await ok()
  const sold = await ok('save', 'sales', {
    id: 'food-sale',
    name: 'Bread sale',
    productId: 'loaf',
    quantity: 1,
    date: '2026-11-13',
    amount: 8,
  })
  expect(find(sold.products, 'loaf').quantity).toBe(0)
  expect(find(sold.sales, 'food-sale').historicalCogs).toBeCloseTo(2.2)
  expect(find(sold.ingredients, 'flour').quantity).toBe(
    find(before.ingredients, 'flour').quantity,
  )
  expect(
    (
      await call('save', 'sales', {
        id: 'food-sale',
        name: 'Bread sale',
        productId: 'loaf',
        quantity: 1,
        amount: 8,
      })
    ).status,
  ).toBe(400)
})

it('scheduled definitions survive recipe edits; actual waste/output and input changes post once', async () => {
  await ok('productionSave', 'batches', plan('pinned-actuals', 'loaf', 4))
  await db.query("SELECT set_config('app.business_id',$1,false)", [a])
  await db.query(
    'UPDATE recipes SET data=data || \'{"yield":400,"laborRate":99}\'::jsonb WHERE business_id=$1 AND id=\'bread\'',
    [a],
  )
  const before = await ok()
  const completed = await ok('productionComplete', 'batches', {
    id: 'pinned-actuals',
    output: 3,
    waste: 1,
    wasteReason: 'One loaf spoiled',
    usage: { flour: 450 },
    laborMinutes: 30,
  })
  const run = find(completed.batches, 'pinned-actuals')
  expect(run.definition.recipe.yield).toBe(4)
  expect(run.costSnapshot.laborRate).toBe(12)
  expect(run.historicalCost).toBeCloseTo(11.1)
  expect(find(completed.products, 'loaf').quantity).toBe(
    find(before.products, 'loaf').quantity + 3,
  )
  expect(find(completed.ingredients, 'flour').quantity).toBe(
    find(before.ingredients, 'flour').quantity - 450,
  )
  expect(run.waste).toBe(1)
  const beforeUsage = completed.batch_usage
  expect(beforeUsage.some((u: Item) => u.batchId === 'pinned-actuals')).toBe(
    true,
  )
  await db.query("SELECT set_config('app.business_id',$1,false)", [a])
  await expect(
    db.query(
      "UPDATE batch_usage SET data='{}' WHERE business_id=$1 AND batch_id='pinned-actuals'",
      [a],
    ),
  ).rejects.toThrow('immutable')
})
it('a late packaging shortage rolls back ingredient movement and output', async () => {
  await ok('productionSave', 'batches', plan('late-shortage', 'loaf', 1))
  await db.query("SELECT set_config('app.business_id',$1,false)", [a])
  await db.query(
    "UPDATE ingredients SET quantity=0,data=jsonb_set(data,'{quantity}','0') WHERE business_id=$1 AND id='bag'",
    [a],
  )
  const before = await ok()
  expect(
    (
      await call('productionComplete', 'batches', {
        id: 'late-shortage',
        output: 1,
      })
    ).status,
  ).toBe(400)
  const after = await ok()
  expect(after.ledger).toEqual(before.ledger)
  expect(after.products).toEqual(before.products)
  expect(after.ingredients).toEqual(before.ingredients)
  expect(after.batch_usage).toEqual(before.batch_usage)
})

it('legacy scheduled replacement is explicit and draft review leaves the original untouched', async () => {
  await db.query("SELECT set_config('app.business_id',$1,false)", [a])
  const legacy = {
    id: 'legacy-plan',
    name: 'Original recipe plan',
    recipeId: 'bread',
    status: 'scheduled',
    count: 2,
    yield: 8,
    date: '2026-11-13',
  }
  await db.query(
    'INSERT INTO batches(id,business_id,data,recipe_id) VALUES($1,$2,$3,$4)',
    [legacy.id, a, JSON.stringify(legacy), 'bread'],
  )
  const before = await ok()
  const draft = await ok('productionSave', 'batches', {
    ...plan('replacement-plan'),
    status: 'draft',
    legacyRunId: legacy.id,
  })
  expect(find(draft.batches, legacy.id).status).toBe('scheduled')
  const scheduled = await ok('productionSave', 'batches', {
    ...plan('replacement-plan'),
    legacyRunId: legacy.id,
  })
  expect(find(scheduled.batches, legacy.id)).toMatchObject({
    ...legacy,
    status: 'canceled',
    replacementRunId: 'replacement-plan',
  })
  expect(scheduled.ledger).toEqual(before.ledger)
  expect(
    (
      await call('productionSave', 'batches', {
        ...plan('second-replacement'),
        legacyRunId: legacy.id,
      })
    ).status,
  ).toBe(400)
})

it('food and assembled kit balances remain enforced by the database movement ledger', async () => {
  await db.query("SELECT set_config('app.business_id',$1,false)", [a])
  for (const id of ['loaf', 'kit'])
    await expect(
      db.query(
        'UPDATE products SET quantity=999 WHERE business_id=$1 AND id=$2',
        [a, id],
      ),
    ).rejects.toThrow('movement ledger')
})
