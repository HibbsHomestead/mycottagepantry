// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { Context } from '@netlify/functions'
import { costBreakdown, type Item } from './domain'
import { preparedRequirement } from './prepared-requirement'
import { prepStockBalance } from './stock-prep'
import { productionReviewIssues } from './production-run'
import { basketChecklist, type ChecklistStage } from './production-checklist'
import { marketOutput } from './production-destinations'
import { planStockPrep, prepReviewKey } from './stock-prep'
import { mixedPackFixture } from '../test/fixtures/mixed-pack'
import { basketProduction } from './basket-production'
import { emptyGrocerySources, generateGroceryList } from './grocery-list'
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
it('names each product still missing actual good output without treating its plan as output', () => {
  const lines = [
    { id: 'first', name: 'Brownies', quantity: 8, output: 6 },
    { id: 'second', name: 'Blondies', quantity: 4, output: '' },
    { id: 'third', name: 'Lemon bars', quantity: 6 },
  ]
  expect(productionReviewIssues(lines)).toEqual([
    'Blondies: Enter a whole number of good units greater than zero.',
    'Lemon bars: Enter a whole number of good units greater than zero.',
  ])
})
const a = '00000000-0000-4000-8000-000000000051',
  b = '00000000-0000-4000-8000-000000000052'
const context = {
  cookies: { get: () => 'a'.repeat(64) },
} as unknown as Context
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
            {
              id: 'goods',
              name: 'Handmade goods',
              classification: 'non_food',
              scope: 'handmade-products',
            },
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
  seed.ingredients.push({ id: 'isolated-liner', name: 'Test muffin liner', usedAs: 'supply', unit: 'each', quantity: 100, cost: 0.025, currentCost: 0.025 })
  seed.recipes.push({ id: 'isolated-muffins', name: 'Test muffins', yield: 12, yieldUnit: 'each', laborMinutes: 0, laborRate: 0, lines: [{ ingredientId: 'flour', quantity: 120, unit: 'g' }], productionSupplies: [{ ingredientId: 'isolated-liner', quantity: 12, unit: 'each' }] })
  seed.products.push({ id: 'isolated-muffin', name: 'Test muffin', workflow: 'food', recipeId: 'isolated-muffins', unitsPerPackage: 1, price: 3, quantity: 0, cost: 0 })
  seed.ingredients.push({ id: 'basket-test-flour', name: 'Basket flour', unit: 'g', quantity: 1000, cost: 0.01, currentCost: 0.01 })
  seed.recipes.push({ id: 'basket-test-bake', name: 'Basket rolls recipe', yield: 4, yieldUnit: 'each', laborMinutes: 12, laborRate: 10, overhead: 0, lines: [{ ingredientId: 'basket-test-flour', quantity: 400, unit: 'g' }] })
  seed.products.push(
    { id: 'basket-test-roll', name: 'Basket roll', workflow: 'food', recipeId: 'basket-test-bake', unitsPerPackage: 1, quantity: 0, cost: 0, price: 8, packagingLines: [{ ingredientId: 'bag', quantity: 1, unit: 'each' }] },
    { id: 'basket-test-tea', name: 'Purchased tea tin', workflow: 'resale', quantity: 0, cost: 0, price: 8 },
    { id: 'basket-test-set', name: 'Roll and tea basket', workflow: 'kit', quantity: 0, cost: 0, price: 20, assemblyMinutes: 6, assemblyRate: 10, kitComponents: [{ productId: 'basket-test-roll', quantity: 1, basis: 'package' }, { productId: 'basket-test-tea', quantity: 1, basis: 'package' }], packagingLines: [{ ingredientId: 'box', quantity: 1, unit: 'each' }] },
  )
  seed.ingredients.push(
    { id: 'prep-count', name: 'Bananas by count', unit: 'each', quantity: 20, cost: 0.5 },
    { id: 'prep-weight', name: 'Bananas by weight', unit: 'g', storageUnit: 'kg', quantity: 2000, cost: 0.01 },
  )
  seed.recipes.push({ id: 'prep-recipe', name: 'Existing banana recipe', yield: 1, yieldUnit: 'each', lines: [{ ingredientId: 'prep-count', quantity: 2, unit: 'each' }] })
  seed.recipes.push({
    id: 'prep-legacy-recipe', name: 'Existing legacy banana recipe', yield: 1,
    yieldUnit: 'each', laborMinutes: 0,
    lines: [{ ingredientId: 'prep-count', quantity: 3, unit: 'each' }],
  })
  seed.products.push({ id: 'prep-product', name: 'Test banana loaf', workflow: 'food', recipeId: 'prep-recipe', unitsPerPackage: 1, price: 5, quantity: 0, cost: 0 })
  const mixed = mixedPackFixture()
  seed.ingredients.push(...mixed.ingredients)
  seed.recipes.push(...mixed.recipes)
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
  const draft = {
    id: 'assemble-one',
    name: 'Bread basket',
    status: 'draft',
    lines: [{ id: 'basket-line', productId: 'kit', quantity: 1 }],
  }
  let workspace = await ok('productionSave', 'batches', draft)
  const saved = () => find(workspace.batches, draft.id)
  async function mark(stage: ChecklistStage, key: string, checked: boolean, quantity = 0, runId = draft.id) {
    const run = find(workspace.batches, runId)
    const line = run.lines[0]
    const entry = basketChecklist(line, workspace, stage).find((entry) => entry.key === key)!
    workspace = await ok('productionChecklist', 'batches', {
      id: runId, expectedRevision: run.revision, lineId: line.id, stage, key, signature: entry.signature, checked, quantity,
    })
  }
  expect((await call('productionSave', 'batches', { ...draft, status: 'scheduled', expectedRevision: 1 })).error).toMatch(/review the basket contents/i)
  await mark('reviewed', 'product:loaf', true)
  expect(find((await ok()).batches, draft.id).lines[0].checklist.reviewed['product:loaf'].checked).toBe(true)
  workspace = await ok('productionSave', 'batches', { ...draft, expectedRevision: saved().revision, lines: [{ ...draft.lines[0], quantity: 2 }] })
  expect(basketChecklist(saved().lines[0], workspace, 'reviewed')[0]).toMatchObject({ required: 4, reReview: true })
  workspace = await ok('productionSave', 'batches', { ...draft, expectedRevision: saved().revision })
  expect(basketChecklist(saved().lines[0], workspace, 'reviewed')[0].mark).toBeUndefined()
  await mark('reviewed', 'product:loaf', true)
  await mark('reviewed', 'supply:box', true)
  workspace = await ok('productionSave', 'batches', { ...draft, status: 'scheduled', expectedRevision: saved().revision })
  await mark('picked', 'product:loaf', false, 1)
  expect(basketChecklist(saved().lines[0], workspace, 'picked')[0].mark).toMatchObject({ checked: false, quantity: 1 })
  expect(basketChecklist(saved().lines[0], workspace, 'packed')[0].mark).toBeUndefined()
  workspace = await ok('productionRecordActuals', 'batches', { id: draft.id, expectedRevision: saved().revision, lines: [{ id: 'basket-line', output: 1 }] })
  expect((await call('productionComplete', 'batches', { id: draft.id, expectedRevision: saved().revision })).error).toMatch(/finish the basket checklists/i)
  for (const stage of ['picked', 'packed'] as const) {
    await mark(stage, 'product:loaf', true)
    await mark(stage, 'supply:box', true)
  }
  const competing = { ...draft, id: 'assemble-competing', name: 'Competing assembly' }
  workspace = await ok('productionSave', 'batches', competing)
  const competitor = () => find(workspace.batches, competing.id)
  await mark('reviewed', 'product:loaf', true, 0, competing.id)
  await mark('reviewed', 'supply:box', true, 0, competing.id)
  workspace = await ok('productionSave', 'batches', { ...competing, status: 'scheduled', expectedRevision: competitor().revision })
  workspace = await ok('productionRecordActuals', 'batches', { id: competing.id, expectedRevision: competitor().revision, lines: [{ id: 'basket-line', output: 1 }] })
  for (const stage of ['picked', 'packed'] as const) {
    await mark(stage, 'product:loaf', true, 0, competing.id)
    await mark(stage, 'supply:box', true, 0, competing.id)
  }
  expect(workspace.ledger).toEqual(before.ledger)
  const request = { id: draft.id, expectedRevision: saved().revision }
  const done = await ok('productionComplete', 'batches', request)
  expect((await call('productionComplete', 'batches', { id: competing.id, expectedRevision: competitor().revision })).error).toMatch(/Bread loaf/)
  expect((await ok('productionComplete', 'batches', request)).ledger).toEqual(done.ledger)
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
  expect((await call('productionChecklist', 'batches', { id: draft.id, expectedRevision: saved().revision + 1 })).error).toMatch(/read-only/i)
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

it('handmade BOMs, explicit purchases, actual multi-output production, reversals, sales and tenant boundaries', async () => {
  session.user = 'production-owner-a'
  const original = await ok()
  const material = {
    id: 'handmade-cord',
    name: 'Cotton cord',
    unit: 'ft',
    materialCategory: 'Cord',
    sku: 'CORD',
    threshold: 3,
  }
  await ok('handmadeMaterialSave', 'ingredients', material)
  await ok('handmadeMaterialSave', 'ingredients', {
    ...material,
    id: 'handmade-beads',
    name: 'Wood beads',
    unit: 'each',
  })
  const receipt = {
    ...material,
    operationId: 'cord-purchase-one',
    purchaseQuantity: 4,
    purchaseUnit: 'yd',
    usagePerPurchase: 3,
    purchaseCost: 12,
    date: '2026-11-15',
  }
  let w = await ok('handmadeMaterialReceive', 'ingredients', receipt)
  expect(find(w.ingredients, material.id)).toMatchObject({
    quantity: 12,
    cost: 1,
  })
  w = await ok('handmadeMaterialReceive', 'ingredients', receipt)
  expect(find(w.ingredients, material.id).quantity).toBe(12)
  expect(
    (
      await call('handmadeMaterialReceive', 'ingredients', {
        ...receipt,
        purchaseCost: 13,
      })
    ).status,
  ).toBe(400)
  await ok('handmadeMaterialReceive', 'ingredients', {
    ...receipt,
    id: 'handmade-beads',
    operationId: 'bead-purchase-one',
    purchaseQuantity: 20,
    purchaseUnit: 'each',
    usagePerPurchase: 1,
    purchaseCost: 10,
  })
  // Shared packaging is received through its existing stock workflow, never duplicated.
  await db.query("SELECT set_config('app.business_id',$1,false)", [a])
  await db.query(
    "UPDATE ingredients SET quantity=100,data=jsonb_set(data,'{quantity}','100') WHERE business_id=$1 AND id='bag'",
    [a],
  )
  const bom = {
    id: 'cord-bom',
    name: 'Cord ornament BOM',
    output: 4,
    laborMinutes: 30,
    laborRate: 12,
    overhead: 2,
    scrapPercent: 10,
    instructions: 'Cut, knot, and finish.',
    lines: [
      { ingredientId: material.id, quantity: 1, unit: 'yd' },
      { ingredientId: 'handmade-beads', quantity: 4, unit: 'each' },
      { ingredientId: 'bag', quantity: 4, unit: 'each' },
    ],
  }
  const p = {
    id: 'handmade-ornament',
    name: 'Cord ornament',
    description: 'Hand knotted ornament',
    workflow: 'handmade',
    sku: 'ORN-NAT',
    variantGroup: 'Ornaments',
    variant: 'Natural',
    price: 12,
    productCategoryId: 'goods',
    bom,
  }
  w = await ok('save', 'products', p)
  expect(find(w.products, p.id).recipeId).toBeFalsy()
  const version = find(w.products, p.id).bom.version
  await ok('save', 'products', {
    ...p,
    id: 'handmade-variant',
    sku: 'ORN-DOUBLE',
    variant: 'Double beads',
    bom: {
      ...bom,
      lines: bom.lines.map((l) =>
        l.ingredientId === 'handmade-beads' ? { ...l, quantity: 8 } : l,
      ),
    },
  })
  expect(
    find((await ok()).products, 'handmade-variant').bom.lines[1].quantity,
  ).toBe(8)
  w = await ok('productionSave', 'batches', {
    id: 'handmade-run-one',
    productId: p.id,
    quantity: 4,
    status: 'scheduled',
    date: '2026-11-15',
  })
  expect(find(w.batches, 'handmade-run-one').definition.bom.version).toBe(
    version,
  )
  const actual = {
    id: 'handmade-run-one',
    output: 3,
    waste: 1,
    wasteReason: 'One damaged ornament',
    usage: { 'handmade-cord': 4, 'handmade-beads': 4, bag: 3 },
    laborMinutes: 40,
  }
  w = await ok('productionComplete', 'batches', actual)
  const finished = structuredClone(find(w.batches, actual.id))
  // 4 cord + 2 beads + .60 packaging + 8 actual labor + 2 overhead.
  expect(finished.historicalCost).toBeCloseTo(16.6)
  expect(find(w.products, p.id)).toMatchObject({
    quantity: 3,
    stockCostKnown: true,
  })
  expect(find(w.ingredients, material.id).quantity).toBe(8)
  expect(find(w.ingredients, 'bag').quantity).toBe(97)
  const after = await ok('productionComplete', 'batches', actual)
  expect(after.ledger).toEqual(w.ledger)
  expect(
    (await call('productionComplete', 'batches', { ...actual, output: 2 }))
      .status,
  ).toBe(400)
  // Supplier and BOM changes cannot rewrite the recorded production cost.
  await ok('handmadeMaterialReceive', 'ingredients', {
    ...receipt,
    operationId: 'cord-purchase-two',
    purchaseQuantity: 1,
    purchaseCost: 30,
  })
  w = await ok('save', 'products', { ...p, bom: { ...bom, laborRate: 24 } })
  expect(find(w.batches, actual.id)).toEqual(finished)
  expect(find(w.products, p.id).bom.version).toBeGreaterThan(version)
  w = await ok('productionReverse', 'batches', {
    id: actual.id,
    reason: 'Rework the damaged run',
  })
  expect(find(w.products, p.id).quantity).toBe(0)
  expect(find(w.ingredients, material.id).quantity).toBe(15)
  expect(find(w.batches, actual.id)).toEqual(finished)
  const reversedLedger = w.ledger
  expect(
    (
      await ok('productionReverse', 'batches', {
        id: actual.id,
        reason: 'Retry reversal',
      })
    ).ledger,
  ).toEqual(reversedLedger)
  await ok('productionSave', 'batches', {
    id: 'handmade-run-sale',
    productId: p.id,
    quantity: 4,
    status: 'scheduled',
    date: '2026-11-15',
  })
  w = await ok('productionComplete', 'batches', {
    ...actual,
    id: 'handmade-run-sale',
    output: 4,
    waste: 0,
  })
  const unitCost = find(w.products, p.id).cost
  w = await ok('save', 'sales', {
    id: 'handmade-sale-one',
    name: p.name,
    productId: p.id,
    quantity: 1,
    date: '2026-11-15',
  })
  expect(find(w.products, p.id).quantity).toBe(3)
  expect(find(w.sales, 'handmade-sale-one').historicalCogs).toBeCloseTo(
    Math.round(unitCost * 100) / 100,
  )
  expect(
    (
      await call('productionReverse', 'batches', {
        id: 'handmade-run-sale',
        reason: 'Cannot reverse sold units',
      })
    ).status,
  ).toBe(400)
  w = await ok('refund', 'sales', { id: 'handmade-sale-one', restock: true })
  expect(find(w.products, p.id).quantity).toBe(4)
  expect(
    (await call('refund', 'sales', { id: 'handmade-sale-one', restock: true }))
      .status,
  ).toBe(400)
  // Financial-only refunds do not replenish stock or reverse cost a second time.
  await ok('save', 'sales', {
    id: 'handmade-sale-two',
    name: p.name,
    productId: p.id,
    quantity: 1,
  })
  w = await ok('refund', 'sales', { id: 'handmade-sale-two', restock: false })
  expect(find(w.products, p.id).quantity).toBe(3)
  expect(
    w.sales.find((s: Item) => s.refundOf === 'handmade-sale-two')
      .historicalCogs,
  ).toBe(0)
  // Unfunded materials can be documented, but never fabricated into zero-cost production.
  await ok('handmadeMaterialSave', 'ingredients', {
    ...material,
    id: 'handmade-unknown',
    name: 'Unpriced ribbon',
  })
  await ok('save', 'products', {
    ...p,
    id: 'handmade-unpriced',
    sku: 'UNPRICED',
    bom: {
      ...bom,
      lines: [{ ingredientId: 'handmade-unknown', quantity: 1, unit: 'ft' }],
    },
  })
  await ok('productionSave', 'batches', {
    id: 'handmade-run-missing',
    productId: 'handmade-unpriced',
    quantity: 1,
    status: 'scheduled',
  })
  expect(
    (
      await call('productionComplete', 'batches', {
        id: 'handmade-run-missing',
        output: 1,
      })
    ).status,
  ).toBe(400)
  await ok('productionSave', 'batches', {
    id: 'handmade-run-short',
    productId: p.id,
    quantity: 1000,
    status: 'scheduled',
  })
  const beforeShortage = await ok()
  expect(
    (
      await call('productionComplete', 'batches', {
        id: 'handmade-run-short',
        output: 1000,
      })
    ).status,
  ).toBe(400)
  expect((await ok()).ledger).toEqual(beforeShortage.ledger)
  session.user = 'production-staff'
  expect(
    (
      await call('productionReverse', 'batches', {
        id: 'handmade-run-sale',
        reason: 'Unauthorized',
      })
    ).status,
  ).toBe(400)
  expect(
    (await call('handmadeMaterialSave', 'ingredients', material)).status,
  ).toBe(400)
  session.user = 'production-reader'
  expect(
    (
      await call('productionComplete', 'batches', {
        id: 'handmade-run-short',
        output: 1,
      })
    ).status,
  ).toBe(400)
  session.user = 'production-owner-b'
  expect(
    (
      await call('productionReverse', 'batches', {
        id: actual.id,
        reason: 'Cross-business attempt',
      })
    ).status,
  ).toBe(400)
  expect((await call('save', 'products', p)).status).toBe(400)
  expect(
    (await call('handmadeMaterialReceive', 'ingredients', receipt)).status,
  ).toBe(400)
  session.user = 'production-owner-a'
  const final = await ok()
  expect(find(final.batches, 'legacy-completed')).toEqual(
    find(original.batches, 'legacy-completed'),
  )
}, 30000)

it('adopts a legacy handmade design without replacing its product, stock, photos or sale history', async () => {
  session.user = 'production-owner-a'
  const legacyDesign = {
    id: 'legacy-handmade-design',
    name: 'Original handmade pattern',
    workflow: 'handmade',
    yield: 2,
    laborMinutes: 10,
    laborRate: 12,
    overhead: 1,
    lines: [{ ingredientId: 'handmade-cord', quantity: 1, unit: 'ft' }],
  }
  await ok('save', 'recipes', legacyDesign)
  const p = {
    id: 'legacy-handmade-product',
    name: 'Original hanging',
    description: 'Original description',
    image: '/original-photo.png',
    workflow: 'handmade',
    recipeId: legacyDesign.id,
    sku: 'LEGACY-HANG',
    price: 18,
    productCategoryId: 'goods',
  }
  await ok('save', 'products', p)
  await ok('productionSave', 'batches', {
    id: 'legacy-handmade-run',
    productId: p.id,
    quantity: 2,
    status: 'scheduled',
    mapping: { quantity: 1, unit: 'each', verified: true },
  })
  await ok('productionComplete', 'batches', {
    id: 'legacy-handmade-run',
    output: 2,
  })
  const before = await ok('save', 'sales', {
    id: 'legacy-handmade-sale',
    name: p.name,
    productId: p.id,
    quantity: 1,
  })
  const stored = find(before.products, p.id)
  const bom = {
    ...find(before.recipes, legacyDesign.id),
    output: 2,
    scrapPercent: 0,
  }
  const after = await ok('save', 'products', { ...stored, bom })
  expect(after.products.filter((r: Item) => r.id === p.id)).toHaveLength(1)
  expect(find(after.products, p.id)).toMatchObject({
    id: stored.id,
    name: stored.name,
    description: stored.description,
    image: stored.image,
    price: stored.price,
    quantity: stored.quantity,
    cost: stored.cost,
    recipeId: legacyDesign.id,
  })
  expect(find(after.recipes, legacyDesign.id)).toEqual(
    find(before.recipes, legacyDesign.id),
  )
  expect(find(after.batches, 'legacy-handmade-run')).toEqual(
    find(before.batches, 'legacy-handmade-run'),
  )
  expect(find(after.sales, 'legacy-handmade-sale')).toEqual(
    find(before.sales, 'legacy-handmade-sale'),
  )
  expect(after.ledger).toEqual(before.ledger)
})

it('multi-product runs save actuals, enforce revisions and aggregate shortages, finalize once and lock history', async () => {
  session.user = 'production-owner-a'
  // Independent stock fixture; no opening quantities bypass ledger guards.
  await db.query("SELECT set_config('app.business_id',$1,false)", [a])
  const input = {
    id: 'multi-input',
    name: 'Shared material',
    usedAs: 'material',
    unit: 'g',
    quantity: 1000,
    cost: 0.01,
  }
  await db.query(
    'INSERT INTO ingredients(id,business_id,data,quantity,cost) VALUES($1,$2,$3,$4,$5)',
    [input.id, a, JSON.stringify(input), 1000, 0.01],
  )
  const recipe = {
    id: 'multi-recipe',
    name: 'Shared recipe',
    yield: 1,
    yieldUnit: 'each',
    laborMinutes: 10,
    laborRate: 12,
    overhead: 1,
    lines: [{ ingredientId: input.id, quantity: 100, unit: 'g' }],
  }
  await db.query('INSERT INTO recipes(id,business_id,data) VALUES($1,$2,$3)', [
    recipe.id,
    a,
    JSON.stringify(recipe),
  ])
  for (const id of ['multi-food-one', 'multi-food-two']) {
    const product = {
      id,
      name: id,
      workflow: 'food',
      recipeId: recipe.id,
      quantity: 0,
      cost: 0,
    }
    await db.query(
      'INSERT INTO products(id,business_id,data,quantity,cost) VALUES($1,$2,$3,0,0)',
      [id, a, JSON.stringify(product)],
    )
  }
  const line = (id: string, productId: string, quantity: number) => ({
    id,
    productId,
    quantity,
    output: quantity,
    waste: 0,
    mapping,
  })
  const draft = {
    id: 'multi-product-run',
    name: 'Combined run',
    status: 'draft',
    date: '2026-11-16',
    lines: [
      line('multi-line-one', 'multi-food-one', 6),
      line('multi-line-two', 'multi-food-two', 6),
    ],
  }
  const before = await ok()
  let w = await ok('productionSave', 'batches', draft)
  expect(w.ledger).toEqual(before.ledger)
  expect(find(w.batches, draft.id).revision).toBe(1)
  expect(
    (await call('productionSave', 'batches', { ...draft, expectedRevision: 0 }))
      .status,
  ).toBe(400)
  expect(
    (
      await call('productionComplete', 'batches', {
        id: draft.id,
        expectedRevision: 1,
      })
    ).error,
  ).toMatch(/start the run/i)
  await ok('productionSave', 'batches', { ...draft, status: 'scheduled', expectedRevision: 1 })
  expect((await call('productionComplete', 'batches', { id: draft.id, expectedRevision: 2 })).error).toMatch(/combined/)
  expect((await ok()).ledger).toEqual(before.ledger)
  const edited = {
    ...draft,
    status: 'scheduled',
    expectedRevision: 2,
    lines: [
      line('multi-line-one', 'multi-food-one', 4),
      line('multi-line-two', 'multi-food-two', 3),
    ],
  }
  w = await ok('productionSave', 'batches', edited)
  expect(find(w.batches, draft.id).lines[1].output).toBe(3)
  expect(w.ledger).toEqual(before.ledger)
  // In-progress runs remain editable; removal, addition and notes persist.
  w = await ok('productionSave', 'batches', {
    ...edited,
    expectedRevision: 3,
    note: 'Continue tomorrow',
  })
  expect(find(w.batches, draft.id).note).toBe('Continue tomorrow')
  const request = { id: draft.id, expectedRevision: 4 }
  const done = await ok('productionComplete', 'batches', request)
  expect(find(done.ingredients, input.id).quantity).toBe(300)
  expect(find(done.products, 'multi-food-one').quantity).toBe(4)
  expect(find(done.products, 'multi-food-two').quantity).toBe(3)
  const run = find(done.batches, draft.id)
  expect(run.historicalCost).toBeCloseTo(28) // $7 materials + $14 labor + $7 overhead
  expect(run.finalizedBy).toBe('production-owner-a')
  expect(run.lines).toHaveLength(2)
  expect(
    done.batch_usage
      .filter((u: Item) => u.batchId === draft.id)
      .every((u: Item) => !!u.productionLineId),
  ).toBe(true)
  expect((await ok('productionComplete', 'batches', request)).ledger).toEqual(
    done.ledger,
  )
  expect(
    (
      await call('productionSave', 'batches', {
        ...edited,
        expectedRevision: 5,
      })
    ).status,
  ).toBe(400)
  session.user = 'production-owner-b'
  expect((await call('productionComplete', 'batches', request)).status).toBe(
    400,
  )
  session.user = 'production-owner-a'
})

it('mixed food/BOM lines retain editable actuals, rollback late failures, and keep staff permissions scoped', async () => {
  session.user = 'production-owner-a'
  await db.query("SELECT set_config('app.business_id',$1,false)", [a])
  const product = {
    id: 'mixed-craft',
    name: 'Craft sample',
    workflow: 'handmade',
    quantity: 0,
    cost: 0,
    bom: {
      id: 'mixed-bom',
      name: 'Craft BOM',
      version: 1,
      output: 1,
      laborMinutes: 15,
      laborRate: 12,
      overhead: 0.5,
      scrapPercent: 0,
      lines: [{ ingredientId: 'multi-input', quantity: 0.1, unit: 'kg' }],
    },
  }
  await db.query(
    'INSERT INTO products(id,business_id,data,quantity,cost) VALUES($1,$2,$3,0,0)',
    [product.id, a, JSON.stringify(product)],
  )
  let lines = [
    {
      id: 'mixed-food-line',
      productId: 'multi-food-one',
      quantity: 1,
      output: 1,
      mapping,
      waste: 0,
    },
    {
      id: 'mixed-craft-line',
      productId: product.id,
      quantity: 1,
      output: 1,
      mapping: {},
      waste: 1,
    },
  ]
  const draft = {
    id: 'mixed-draft-run',
    name: 'Food and craft',
    date: '2026-11-16',
    status: 'draft',
    lines,
  }
  await ok('productionSave', 'batches', draft)
  await ok('productionSave', 'batches', { ...draft, status: 'scheduled', expectedRevision: 1 })
  session.user = 'production-staff'
  expect(
    (await call('productionSave', 'batches', { ...draft, expectedRevision: 2 }))
      .status,
  ).toBe(400)
  // Staff can record actuals, but forged header, quantity, product and definition changes are ignored.
  await ok('productionRecordActuals', 'batches', {
    ...draft,
    expectedRevision: 2,
    name: 'Forged',
    lines: lines.map((l) => ({
      ...l,
      productId: 'other-business',
      quantity: 999,
    })),
  })
  session.user = 'production-owner-a'
  let w = await ok()
  expect(find(w.batches, draft.id).name).toBe('Food and craft')
  expect(find(w.batches, draft.id).lines[0].quantity).toBe(1)
  const before = await ok()
  expect(
    (
      await call('productionComplete', 'batches', {
        id: draft.id,
        expectedRevision: 3,
      })
    ).error,
  ).toMatch(/waste/)
  w = await ok()
  expect(w.ingredients).toEqual(before.ingredients)
  expect(w.products).toEqual(before.products)
  expect(w.ledger).toEqual(before.ledger)
  expect(w.batch_usage).toEqual(before.batch_usage)
  lines = lines.map((l) => ({ ...l, waste: 0 }))
  await ok('productionSave', 'batches', {
    ...draft,
    status: 'scheduled',
    lines,
    expectedRevision: 3,
  })
  const done = await ok('productionComplete', 'batches', {
    id: draft.id,
    expectedRevision: 4,
  })
  expect(find(done.ingredients, 'multi-input').quantity).toBe(100)
  expect(find(done.products, product.id).quantity).toBe(1)
  await db.query("SELECT set_config('app.business_id',$1,false)", [a])
  await expect(
    db.query(
      "UPDATE batches SET data=jsonb_set(data,'{note}','\"changed\"') WHERE business_id=$1 AND id=$2",
      [a, draft.id],
    ),
  ).rejects.toThrow('immutable')
  const cancel = { ...draft, id: 'cancel-multi-run' }
  const ledger = (await ok()).ledger
  await ok('productionSave', 'batches', cancel)
  await ok('productionCancel', 'batches', {
    id: cancel.id,
    expectedRevision: 1,
  })
  expect((await ok()).ledger).toEqual(ledger)
})

it('handmade-only multi-line reversals restore posted usage once without unlocking the header', async () => {
  session.user = 'production-owner-a'
  await db.query("SELECT set_config('app.business_id',$1,false)", [a])
  const i = {
    id: 'reverse-material',
    name: 'Blank card',
    usedAs: 'material',
    unit: 'each',
    quantity: 10,
    cost: 1,
  }
  await db.query(
    'INSERT INTO ingredients(id,business_id,data,quantity,cost) VALUES($1,$2,$3,10,1)',
    [i.id, a, JSON.stringify(i)],
  )
  const p = {
    id: 'reverse-product',
    name: 'Handmade card',
    workflow: 'handmade',
    quantity: 0,
    cost: 0,
    bom: {
      id: 'reverse-bom',
      name: 'Card BOM',
      version: 1,
      output: 1,
      laborMinutes: 0,
      laborRate: 0,
      overhead: 0,
      scrapPercent: 0,
      lines: [{ ingredientId: i.id, quantity: 1, unit: 'each' }],
    },
  }
  await db.query(
    'INSERT INTO products(id,business_id,data,quantity,cost) VALUES($1,$2,$3,0,0)',
    [p.id, a, JSON.stringify(p)],
  )
  const draft = {
    id: 'reverse-multi-run',
    name: 'Cards',
    status: 'scheduled',
    lines: ['reverse-line-one', 'reverse-line-two'].map((id) => ({
      id,
      productId: p.id,
      quantity: 1,
      output: 1,
    })),
  }
  await ok('productionSave', 'batches', draft)
  const done = await ok('productionComplete', 'batches', {
    id: draft.id,
    expectedRevision: 1,
  })
  expect(find(done.products, p.id).quantity).toBe(2)
  const request = {
    id: draft.id,
    reason: 'Correction fixture',
    expectedRevision: 2,
  }
  const reversed = await ok('productionReverse', 'batches', request)
  expect(find(reversed.ingredients, i.id).quantity).toBe(10)
  expect(find(reversed.products, p.id).quantity).toBe(0)
  expect(find(reversed.batches, draft.id)).toEqual(find(done.batches, draft.id))
  expect((await ok('productionReverse', 'batches', request)).ledger).toEqual(
    reversed.ledger,
  )
})

it('connects events to existing production and separates sales attribution from invoice pickups without changing stock or posted history', async () => {
  session.user = 'production-owner-a'
  let w = await ok()
  const day = '2026-11-16'
  for (const [index, type] of [
    'Market / sale event',
    'Pickup day',
    'Other event',
  ].entries()) {
    w = await ok('eventSave', 'events', {
      id: `event-acceptance-${index}`,
      name: `Acceptance ${type}`,
      type,
      status: 'Scheduled',
      allDay: true,
      startDate: day,
      endDate: '2026-11-17',
      budget: 60,
      plannedRevenue: 150,
    })
    expect(
      w.events.find((e: Item) => e.id === `event-acceptance-${index}`).timezone,
    ).toBe('America/Chicago')
  }
  const product = w.products[0]
  for (const id of ['event-run-one', 'event-run-two'])
    await db.query(
      'INSERT INTO batches(id,business_id,data,product_id) VALUES($1,$2,$3,$4)',
      [
        id,
        a,
        JSON.stringify({
          id,
          name: id,
          status: 'draft',
          productionVersion: 2,
          date: day,
          lines: [{ id: 'line', productId: product.id, quantity: 10 }],
        }),
        product.id,
      ],
    )
  await db.query(
    'INSERT INTO finance_transactions(id,business_id,data) VALUES($1,$2,$3)',
    [
      'event-invoice',
      a,
      JSON.stringify({
        id: 'event-invoice',
        name: 'Invoice for pickup',
        kind: 'invoice',
        amount: 100,
        paid: 25,
        status: 'posted',
        date: day,
      }),
    ],
  )
  const before = await ok()
  const financialTables = [
    'ingredients',
    'products',
    'batches',
    'sales',
    'expenses',
    'ledger',
    'journals',
    'orders',
    'finance_transactions',
  ]
  for (const recordId of ['event-run-one', 'event-run-two'])
    w = await ok('eventLink', 'events', {
      eventId: 'event-acceptance-0',
      kind: 'batch',
      recordId,
      allocations: [{ lineId: 'line', productId: product.id, quantity: 8 }],
    })
  expect(
    w.event_batch_links.filter((l: Item) => l.eventId === 'event-acceptance-0'),
  ).toHaveLength(2)
  expect(
    (
      await call('eventLink', 'events', {
        eventId: 'event-acceptance-1',
        kind: 'batch',
        recordId: 'event-run-one',
        allocations: [{ lineId: 'line', productId: product.id, quantity: 3 }],
      })
    ).status,
  ).toBe(400)
  w = await ok('eventLink', 'events', {
    eventId: 'event-acceptance-1',
    kind: 'batch',
    recordId: 'event-run-one',
    allocations: [{ lineId: 'line', productId: product.id, quantity: 2 }],
  })
  const sale = w.sales.find((s: Item) => !s.refundOf)!
  w = await ok('eventLink', 'events', {
    eventId: 'event-acceptance-0',
    kind: 'sale',
    recordId: sale.id,
  })
  expect(
    (
      await call('eventLink', 'events', {
        eventId: 'event-acceptance-1',
        kind: 'sale',
        recordId: sale.id,
      })
    ).status,
  ).toBe(400)
  w = await ok('eventLink', 'events', {
    eventId: 'event-acceptance-1',
    kind: 'pickup',
    recordId: 'event-invoice',
    pickupStatus: 'Awaiting pickup',
  })
  w = await ok('eventLink', 'events', {
    eventId: 'event-acceptance-1',
    kind: 'pickup',
    recordId: 'event-invoice',
    pickupStatus: 'Picked up',
  })
  expect(w.event_pickups[0].pickedUpAt).toBeTruthy()
  const event = w.events.find((e: Item) => e.id === 'event-acceptance-0')
  w = await ok('eventSave', 'events', {
    ...event,
    expectedRevision: event.revision,
    status: 'Cancelled',
  })
  for (const table of financialTables)
    expect(w[table], table).toEqual(before[table])
  expect(w.event_sale_links).toHaveLength(1)
  session.user = 'production-staff'
  const staff = await ok()
  expect(staff.event_sale_links).toEqual([])
  expect(staff.event_pickups).toEqual([])
  expect(
    staff.events.find((e: Item) => e.id === event.id).budget,
  ).toBeUndefined()
  expect((await call('eventSave', 'events', event)).status).toBe(400)
  session.user = 'production-owner-b'
  const foreign = await ok()
  expect(foreign.events).toEqual([])
  expect(
    (
      await call('eventLink', 'events', {
        eventId: event.id,
        kind: 'sale',
        recordId: sale.id,
      })
    ).status,
  ).toBe(400)
  session.user = 'production-owner-a'
})

it('production supplies persist separately, plan without movements, finalize once and preserve existing correction restrictions', async () => {
  session.user = 'production-owner-a'
  let w = await ok()
  const recipe = find(w.recipes, 'isolated-muffins')
  const before = find(w.ingredients, 'isolated-liner').quantity
  const ledgerBefore = w.ledger.length
  w = await ok('save', 'recipes', recipe)
  expect(find(w.recipes, recipe.id).productionSupplies).toEqual(recipe.productionSupplies)
  expect(find(w.ingredients, 'isolated-liner').quantity).toBe(before)
  expect(w.ledger.length).toBe(ledgerBefore)
  w = await ok('productionSave', 'batches', plan('isolated-supply-run', 'isolated-muffin', 24))
  expect(find(w.ingredients, 'isolated-liner').quantity).toBe(before)
  const request = { id: 'isolated-supply-run', output: 24, waste: 0 }
  const done = await ok('productionComplete', 'batches', request)
  expect(find(done.ingredients, 'isolated-liner').quantity).toBe(before - 24)
  const movements = done.ledger.filter((l: Item) => l.batchId === request.id && l.ingredientId === 'isolated-liner')
  expect(movements).toHaveLength(1)
  expect(movements[0].quantity).toBe(-24)
  expect(find(done.batches, request.id).costSnapshot.suppliesCost).toBeCloseTo(.6)
  expect((await ok('productionComplete', 'batches', request)).ledger).toEqual(done.ledger)
  expect((await call('productionReverse', 'batches', { id: request.id, reason: 'Isolated test correction' })).status).toBe(400)
  const unchanged = await ok()
  expect(unchanged.ledger).toEqual(done.ledger)
  expect(find(unchanged.batches, request.id)).toEqual(find(done.batches, request.id))
})

it('posts count and weight prep, preserves costs and identity, consumes a partial portion only once, and reverses unused prep', async () => {
  session.user = 'production-owner-a'
  const date = '2026-01-01'
  const quote = <T extends Item>(w: Awaited<ReturnType<typeof ok>>, input: T) => ({
    ...input,
    review: prepReviewKey(planStockPrep(find(w.ingredients, input.id), w.lots, input, date)),
  })
  const before = await ok()
  const count = quote(before, {
    id: 'prep-count', name: '', operationId: '11111111-1111-4111-8111-111111111111',
    used: 12, portions: 3, perPortion: 4, outputUnit: 'each', method: 'Portioned and frozen',
    location: 'Freezer', date, note: '4 bananas, approximately 2 cups',
  })
  expect((await ok()).ledger).toEqual(before.ledger)
  const stale = await call('stockPrepPost', 'ingredients', { ...count, used: 9, perPortion: 3 })
  expect(stale.error).toMatch(/changed since review/)
  const shortage = await call('stockPrepPost', 'ingredients', { ...count, used: 30, perPortion: 10 })
  expect(shortage.error).toMatch(/insufficient unportioned/i)
  const countLot = `prep-${count.operationId}`
  const posted = await ok('stockPrepPost', 'ingredients', count)
  expect(find(posted.ingredients, 'prep-count')).toMatchObject({ quantity: 20, cost: 0.5 })
  expect(find(posted.lots, countLot)).toMatchObject({ ingredientId: 'prep-count', balances: [4, 4, 4], location: 'Freezer', carriedCost: 6, note: count.note })
  expect(posted.ledger.filter((l: Item) => l.prepLotId === countLot)).toHaveLength(2)
  expect((await ok('stockPrepPost', 'ingredients', count)).ledger).toEqual(posted.ledger)
  expect(posted.journals).toEqual(before.journals)
  expect(posted.sales).toEqual(before.sales)
  const adjustment = await call('adjust', 'ingredients', { id: 'prep-count', quantity: -10, unit: 'each', reason: 'Fixture correction' })
  expect(adjustment.error).toMatch(/has prepared stock/)

  const weight = {
    id: 'prep-weight', name: '', operationId: '22222222-2222-4222-8222-222222222222',
    used: 1.2, loss: 0.3, lossReason: 'Peels measured separately', portions: 3, perPortion: 300, outputUnit: 'g',
    method: 'Peeled and frozen', location: 'Freezer drawer', date, expires: '2026-02-01', note: 'About 4 bananas per portion',
  }
  expect((await call('stockPrepPost', 'ingredients', { ...weight, outputUnit: 'each' })).error).toMatch(/verified unit conversion/)
  const weightLot = `prep-${weight.operationId}`
  const weighed = await ok('stockPrepPost', 'ingredients', quote(posted, weight))
  expect(find(weighed.lots, weightLot)).toMatchObject({ balances: [300, 300, 300], quantity: 900, expires: weight.expires, carriedCost: 12, sourceUnit: 'kg' })
  expect(find(weighed.ingredients, 'prep-weight').quantity).toBe(1700)
  expect(find(weighed.ingredients, 'prep-weight').cost * 1700).toBeCloseTo(20)
  expect(weighed.ledger.find((l: Item) => l.type === 'prep_loss' && l.prepLotId === weightLot)).toMatchObject({ quantity: -300, amount: 0 })
  expect(weighed.journals).toEqual(before.journals)
  const reverse = { id: 'prep-weight', lotId: weightLot, operationId: '33333333-3333-4333-8333-333333333333', reason: 'Mistaken entry; original weight verified', confirmPhysicalStock: true }
  const reversed = await ok('stockPrepReverse', 'ingredients', reverse)
  expect(find(reversed.ingredients, 'prep-weight')).toMatchObject({ quantity: 2000, cost: 0.01 })
  expect(find(reversed.lots, weightLot)).toMatchObject({ quantity: 0, balances: [0, 0, 0], reversalReason: reverse.reason })
  expect((await ok('stockPrepReverse', 'ingredients', reverse)).ledger).toEqual(reversed.ledger)

  const run = { id: 'prep-fixture-run', name: 'Existing recipe run', status: 'scheduled', date, lines: [{ id: 'prep-fixture-line', productId: 'prep-product', quantity: 1, output: 1, mapping }] }
  const draft = await ok('productionSave', 'batches', run)
  expect(draft.ledger).toEqual(reversed.ledger)
  expect((await call('productionComplete', 'batches', { id: run.id, expectedRevision: 1 })).error).toMatch(/choose unportioned stock or a prepared lot/)
  await ok('productionRecordActuals', 'batches', { id: run.id, expectedRevision: 1, lines: [{ ...run.lines[0], prepSources: { 'prep-count': countLot } }] })
  const completion = { id: run.id, expectedRevision: 2 }
  const cooked = await ok('productionComplete', 'batches', completion)
  expect(find(cooked.ingredients, 'prep-count')).toMatchObject({ quantity: 18, cost: 0.5 })
  expect(find(cooked.lots, countLot)).toMatchObject({ balances: [2, 4, 4], quantity: 10 })
  expect(cooked.ledger.find((l: Item) => l.type === 'batch_consumption' && l.prepLotId === countLot)).toMatchObject({ quantity: -2, amount: -1, location: 'Freezer' })
  expect((await ok('productionComplete', 'batches', completion)).ledger).toEqual(cooked.ledger)
  expect((await call('stockPrepReverse', 'ingredients', { ...reverse, id: 'prep-count', lotId: countLot, operationId: '44444444-4444-4444-8444-444444444444' })).error).toMatch(/only untouched/i)
  expect(cooked.ingredients).toHaveLength(before.ingredients.length)
  expect(cooked.recipes).toEqual(before.recipes)
  const received = await ok('receive', 'ingredients', {
    id: 'prep-count', quantity: 4, unit: 'each', price: 6,
  })
  expect(find(received.ingredients, 'prep-count')).toMatchObject({ quantity: 22 })
  expect(find(received.ingredients, 'prep-count').cost * 22).toBeCloseTo(15)
  expect(find(received.lots, countLot)).toMatchObject({
    balances: [2, 4, 4], unitCost: 0.5, quantity: 10,
  })
  await ok('save', 'batches', {
    id: 'prep-legacy-run', name: 'Legacy banana batch', date, count: 1,
    recipeId: 'prep-legacy-recipe', yield: 1,
  })
  const legacy = await ok('complete', 'batches', {
    id: 'prep-legacy-run', actualYield: 1, prepSources: { 'prep-count': countLot },
  })
  expect(find(legacy.ingredients, 'prep-count').quantity).toBe(19)
  expect(find(legacy.ingredients, 'prep-count').cost * 19).toBeCloseTo(13.5)
  expect(find(legacy.lots, countLot).balances).toEqual([0, 3, 4])
  expect(find(legacy.batches, 'prep-legacy-run').usage).toMatchObject([
    { ingredientId: 'prep-count', cost: 1.5, prepLotId: countLot },
  ])
  session.user = 'production-owner-b'
  try {
    expect((await call('stockPrepPost', 'ingredients', count)).error).toMatch(/from this business/)
  } finally { session.user = 'production-owner-a' }
})

it('starts an existing draft and finalizes two required portions atomically from a matching lot', async () => {
  session.user = 'production-owner-a'
  const date = '2026-01-01'
  const item = { id: 'required-prep-input', name: 'Fixture counted fruit', unit: 'each', quantity: 26, cost: 0.5 }
  await db.query("SELECT set_config('app.business_id',$1,false)", [a])
  await db.query('INSERT INTO ingredients(id,business_id,data,quantity,cost) VALUES($1,$2,$3,$4,$5)', [item.id, a, JSON.stringify(item), item.quantity, item.cost])
  const before = await ok()
  const prep = { id: item.id, date, operationId: '93e18b3d-6046-47e6-abca-712f97d4a911', used: 12, portions: 3, perPortion: 4, outputUnit: 'each', method: 'Frozen', location: 'Test freezer', note: 'Approximately two cups' }
  const stocked = await ok('stockPrepPost', 'ingredients', { ...prep, review: prepReviewKey(planStockPrep(item, before.lots, prep, date)) })
  const lotId = `prep-${prep.operationId}`
  const prepared = preparedRequirement(item, find(stocked.lots, lotId))
  expect(() => preparedRequirement({ ...item, unit: 'g' }, find(stocked.lots, lotId))).toThrow(/verified conversion from each per portion to g/)
  const line = { ingredientId: item.id, quantity: 4, unit: 'each', prepared }
  const recipe = { id: 'required-prep-recipe', name: 'Recipe with frozen portions', yield: 1, yieldUnit: 'each', lines: [line] }
  const saved = await ok('save', 'recipes', recipe)
  expect(find(saved.recipes, recipe.id).lines[0].prepared).toEqual(prepared)
  expect(find(saved.recipes, 'prep-recipe')).toEqual(find(stocked.recipes, 'prep-recipe'))
  expect(costBreakdown(find(saved.recipes, recipe.id), saved.ingredients).ingredient).toBe(2)
  expect(costBreakdown(find(saved.recipes, recipe.id), saved.ingredients, { multiplier: 2 }).ingredient).toBe(4)
  const product = { id: 'required-prep-product', name: 'Fixture frozen-fruit loaf', workflow: 'food', recipeId: recipe.id, unitsPerPackage: 1, price: 5, quantity: 0, cost: 0 }
  await db.query('INSERT INTO products(id,business_id,recipe_id,data,quantity,cost) VALUES($1,$2,$3,$4,0,0)', [product.id, a, recipe.id, JSON.stringify(product)])
  const output = { id: 'required-prep-line', productId: product.id, quantity: 2, output: 2, mapping }
  const run = { name: 'Two portions', id: 'required-prep-run', date, status: 'draft', lines: [output] }
  const drafted = await ok('productionSave', 'batches', run)
  expect((await call('productionSave', 'batches', { ...run, status: 'scheduled', expectedRevision: 0 })).status).toBe(400)
  expect(find((await ok()).batches, run.id).status).toBe('draft')
  const started = await ok('productionSave', 'batches', { ...run, status: 'scheduled', expectedRevision: 1 })
  expect(find(started.batches, run.id)).toMatchObject({ status: 'scheduled', revision: 2 })
  expect(started.ledger).toEqual(drafted.ledger)
  const wrong = await ok('productionRecordActuals', 'batches', { id: run.id, expectedRevision: 2, lines: [{ ...output, prepSources: { [item.id]: 'unportioned' } }] })
  expect((await call('productionComplete', 'batches', { id: run.id, expectedRevision: 3 })).error).toMatch(/unportioned stock cannot be substituted/i)
  expect((await ok()).ledger).toEqual(wrong.ledger)
  const assigned = { ...output, prepSources: { [item.id]: lotId } }
  await ok('productionRecordActuals', 'batches', { id: run.id, expectedRevision: 3, lines: [{ ...assigned, usage: { [item.id]: 16 } }] })
  expect((await call('productionComplete', 'batches', { id: run.id, expectedRevision: 4 })).error).toMatch(/prepare more/i)
  expect(find((await ok()).batches, run.id).status).toBe('scheduled')
  await ok('productionRecordActuals', 'batches', { id: run.id, expectedRevision: 4, lines: [assigned] })
  const request = { id: run.id, expectedRevision: 5 }
  const completed = await ok('productionComplete', 'batches', request)
  expect(find(completed.lots, lotId)).toMatchObject({ quantity: 4, balances: [0, 0, 4] })
  expect(find(completed.ingredients, item.id).quantity).toBe(18)
  expect(prepStockBalance(find(completed.ingredients, item.id), completed.lots).available).toBe(14)
  expect(completed.ledger.filter((entry: Item) => entry.batchId === run.id && entry.ingredientId === item.id)).toMatchObject([{ quantity: -8, amount: -4, prepLotId: lotId }])
  expect((await ok('productionComplete', 'batches', request)).ledger).toEqual(completed.ledger)
  expect((await call('productionSave', 'batches', { ...run, expectedRevision: 6 })).status).toBe(400)
  expect((await ok()).ledger).toEqual(completed.ledger)
})

it('portions generic materials, packaging and supplies without duplicating stock or value', async () => {
  session.user = 'production-owner-a'
  const date = '2026-01-01'
  const ribbon = { id: 'prep-ribbon', name: 'Fixture ribbon', usedAs: 'material', unit: 'yd', quantity: 12, cost: 3 }
  const boxes = { id: 'prep-boxes', name: 'Fixture boxes', usedAs: 'packaging', unit: 'each', quantity: 12, cost: 2 }
  const glue = { id: 'prep-glue', name: 'Fixture glue', usedAs: 'supply', unit: 'ml', quantity: 1000, cost: 0.02 }
  const empty = { ...boxes, id: 'prep-empty', quantity: 0 }
  const archived = { ...boxes, id: 'prep-archived', archived: true }
  await db.query("SELECT set_config('app.business_id',$1,false)", [a])
  for (const item of [ribbon, boxes, glue, empty, archived])
    await db.query('INSERT INTO ingredients(id,business_id,data,quantity,cost) VALUES($1,$2,$3,$4,$5)', [item.id, a, JSON.stringify(item), item.quantity, item.cost])
  const input = { date, location: 'Fixture shelf', portions: 2 }
  const ribbonRequest = { ...input, id: ribbon.id, used: 4, perPortion: 6, outputUnit: 'ft', operationId: '831d27f9-93b4-49a2-8b01-8e94ae318ab0' }
  const boxesRequest = { ...input, id: boxes.id, used: 6, operationId: '831d27f9-93b4-49a2-8b01-8e94ae318ab1' }
  const glueRequest = { ...input, id: glue.id, used: 500, perPortion: 0.225, outputUnit: 'l', loss: 50, lossReason: 'Measured spill', operationId: '831d27f9-93b4-49a2-8b01-8e94ae318ab2' }
  const before = await ok()
  for (const [request, reason] of [
    [{ ...boxesRequest, id: empty.id }, /no stock on hand/],
    [{ ...boxesRequest, id: archived.id }, /archived/],
    [{ ...boxesRequest, used: '' }, /Source quantity/],
    [{ ...ribbonRequest, outputUnit: 'cup' }, /no verified unit conversion/],
    [{ ...ribbonRequest, perPortion: 3 }, /Difference: 2 yd unaccounted/],
  ] as const)
    expect((await call('stockPrepPost', 'ingredients', request)).error).toMatch(reason)
  const rejected = await ok()
  for (const table of ['ingredients', 'ledger', 'lots', 'journals']) expect(rejected[table]).toEqual(before[table])
  let current = before
  for (const [request, item, balances, quantity] of [
    [ribbonRequest, ribbon, [2, 2], 12],
    [boxesRequest, boxes, [3, 3], 12],
    [glueRequest, glue, [225, 225], 950],
  ] as const) {
    const reviewed = { ...request, review: prepReviewKey(planStockPrep(find(current.ingredients, item.id), current.lots, request, date)) }
    current = await ok('stockPrepPost', 'ingredients', reviewed)
    expect(find(current.lots, `prep-${request.operationId}`)).toMatchObject({ ingredientId: item.id, balances, expires: '', name: 'Prepared portions' })
    const stock = find(current.ingredients, item.id)
    expect(stock.quantity).toBe(quantity)
    expect(stock.quantity * stock.cost).toBeCloseTo(item.quantity * item.cost)
    expect((await ok('stockPrepPost', 'ingredients', reviewed)).ledger).toEqual(current.ledger)
  }
  const glueLot = `prep-${glueRequest.operationId}`
  const correction = { id: glue.id, lotId: glueLot, operationId: '831d27f9-93b4-49a2-8b01-8e94ae318ab3', reason: 'Fixture correction', confirmPhysicalStock: true }
  const reversed = await ok('stockPrepReverse', 'ingredients', correction)
  expect(find(reversed.ingredients, glue.id)).toMatchObject({ quantity: 1000, cost: glue.cost })
  expect((await ok('stockPrepReverse', 'ingredients', correction)).ledger).toEqual(reversed.ledger)

  const prepSources = { [ribbon.id]: `prep-${ribbonRequest.operationId}`, [boxes.id]: `prep-${boxesRequest.operationId}` }
  const design = { id: 'portion-ribbon-design', name: 'Ribbon project', workflow: 'handmade', yield: 1, laborMinutes: 0, laborRate: 0, overhead: 0, lines: [
    { ingredientId: ribbon.id, quantity: 3, unit: 'ft', prepared: preparedRequirement(ribbon, find(reversed.lots, prepSources[ribbon.id])) },
    { ingredientId: boxes.id, quantity: 1, unit: 'each', prepared: preparedRequirement(boxes, find(reversed.lots, prepSources[boxes.id])) },
  ] }
  await ok('save', 'recipes', design)
  const product = { id: 'portion-ribbon-product', name: 'Ribbon project', workflow: 'handmade', recipeId: design.id, price: 15, sku: 'RIBBON-FIXTURE', productCategoryId: 'goods' }
  await ok('save', 'products', product)
  await ok('productionSave', 'batches', { id: 'portion-project-run', productId: product.id, quantity: 1, status: 'scheduled', date, mapping: { quantity: 1, unit: 'each', verified: true } })
  const done = await ok('productionComplete', 'batches', { id: 'portion-project-run', output: 1, prepSources })
  expect(find(done.ingredients, ribbon.id).quantity).toBe(11)
  expect(find(done.ingredients, boxes.id).quantity).toBe(11)
  expect(find(done.lots, prepSources[ribbon.id]).balances).toEqual([1, 2])
  expect(find(done.lots, prepSources[boxes.id]).balances).toEqual([2, 3])
  expect(done.ledger.filter((line: Item) => line.batchId === 'portion-project-run' && line.ingredientId)).toEqual(expect.arrayContaining([
    expect.objectContaining({ ingredientId: ribbon.id, prepLotId: prepSources[ribbon.id], quantity: expect.closeTo(-1, 8), amount: expect.closeTo(-3, 8) }),
    expect.objectContaining({ ingredientId: boxes.id, prepLotId: prepSources[boxes.id], quantity: -1, amount: -2 }),
  ]))
  const legacy = { id: 'portion-legacy-project', name: 'Legacy ribbon project', productId: product.id, recipeId: design.id, count: 1, yield: 1, date }
  await ok('save', 'batches', legacy)
  const actual = { id: legacy.id, actualYield: 1, laborMinutes: 0, usage: { [ribbon.id]: 3, [boxes.id]: 1 }, materialWaste: { [ribbon.id]: 0, [boxes.id]: 0 }, prepSources }
  const completed = await ok('complete', 'batches', actual)
  expect(find(completed.ingredients, ribbon.id).quantity).toBe(10)
  expect(find(completed.lots, prepSources[ribbon.id]).balances).toEqual([0, 2])
  expect((await ok('complete', 'batches', actual)).ledger).toEqual(completed.ledger)
})

it('plans and posts a shared market batch without an order, and keeps stock and customer-order plans separate', async () => {
  session.user = 'production-owner-a'
  const day = '2026-11-24'
  const eventId = 'isolated-board-market'
  await ok('eventSave', 'events', { id: eventId, name: 'Fixture market', type: 'Market / sale event', status: 'Scheduled', allDay: true, startDate: day, endDate: day })
  const orderId = 'isolated-board-order'
  await db.query('INSERT INTO finance_transactions(id,business_id,data) VALUES($1,$2,$3)', [orderId, a, JSON.stringify({ id: orderId, kind: 'invoice', name: 'Fixture customer order', status: 'posted', amount: 10, paid: 0, date: day })])
  const baseline = await ok()
  const basketId = 'isolated-board-basket'
  await ok('productionSave', 'batches', { id: basketId, status: 'draft', eventId, lines: [{ id: 'board-basket-line', productId: 'kit', quantity: 1 }] })
  const loaf = { id: 'board-loaf-line', productId: 'loaf', quantity: 6, mapping: { quantity: 1, unit: 'each', verified: true } }
  const market = { id: 'isolated-board-batch', name: 'Shared market bake', status: 'draft', eventId, dueDate: day, lines: [{ ...loaf, basketAssignments: [{ runId: basketId, quantity: 2 }] }] }
  let workspace = await ok('productionSave', 'batches', market)
  const draft = find(workspace.batches, market.id)
  expect(draft).toMatchObject({ eventId, dueDate: day, status: 'draft' })
  expect(draft.orderId).toBeUndefined()
  expect(marketOutput(draft, draft.lines[0], eventId, workspace)).toEqual({ planned: 6, completed: 0, forBaskets: 2 })
  expect((await call('productionSave', 'batches', { ...market, id: 'isolated-excess-bake', lines: [{ ...loaf, basketAssignments: [{ runId: basketId, quantity: 7 }] }] })).error).toMatch(/exceed planned packages/)
  expect((await call('productionSave', 'batches', { ...market, id: 'isolated-other-order', orderId: 'missing-order' })).error).toMatch(/existing customer order/)
  for (const link of [{ id: 'isolated-board-stock' }, { id: 'isolated-board-customer', orderId }]) {
    workspace = await ok('productionSave', 'batches', { ...link, status: 'scheduled', lines: [loaf] })
    const run = find(workspace.batches, link.id)
    expect(run.orderId).toBe('orderId' in link ? orderId : undefined)
    expect(run.eventId).toBeUndefined()
  }
  workspace = await ok('eventLink', 'events', { eventId, kind: 'batch', recordId: market.id, allocations: [{ lineId: loaf.id, productId: loaf.productId, quantity: 4 }] })
  expect(marketOutput(draft, draft.lines[0], eventId, workspace).planned).toBe(6)
  workspace = await ok('productionSave', 'batches', { ...market, status: 'scheduled', expectedRevision: draft.revision })
  workspace = await ok('productionRecordActuals', 'batches', { id: market.id, expectedRevision: find(workspace.batches, market.id).revision, lines: [{ id: loaf.id, output: 3 }] })
  expect(workspace.ledger).toEqual(baseline.ledger)
  const finalize = { id: market.id, expectedRevision: find(workspace.batches, market.id).revision }
  const done = await ok('productionComplete', 'batches', finalize)
  const run = find(done.batches, market.id)
  expect(marketOutput(run, run.lines[0], eventId, done)).toEqual({ planned: 6, completed: 3, forBaskets: 2 })
  expect(find(done.products, 'loaf').quantity).toBe(find(baseline.products, 'loaf').quantity + 3)
  expect(done.sales).toEqual(baseline.sales)
  expect(done.orders).toEqual(baseline.orders)
  expect(done.finance_transactions).toEqual(baseline.finance_transactions)
  expect((await ok('productionComplete', 'batches', finalize)).ledger).toEqual(done.ledger)
})

it('plans basket contents atomically, allows zero finished stock, and posts partial assembly without repeating component costs', async () => {
  session.user = 'production-owner-a'
  const day = '2026-11-24'
  const eventId = 'fixture-contents-market'
  await ok('eventSave', 'events', { id: eventId, name: 'Contents market', type: 'Market / sale event', status: 'Scheduled', allDay: true, startDate: day, endDate: day })
  await ok('receive', 'products', { id: 'basket-test-tea', operationId: 'fixture-tea-receipt', quantity: 3, unit: 'each', itemsPerUnit: 1, price: 12, reason: 'Fixture stock', receivedDate: day })
  const before = await ok()
  const parent = { id: 'fixture-contents-parent', name: 'Market roll and tea baskets', status: 'draft', date: day, eventId, expectedRevision: 0, planContents: true,
    lines: [{ id: 'contents-basket-line', productId: 'basket-test-set', quantity: 3, basketPlan: { 'basket-test-roll': { wholeBatch: true }, 'basket-test-tea': { stock: 3 } } }],
  }
  let workspace = await ok('productionSave', 'batches', parent)
  const saved = () => find(workspace.batches, parent.id)
  const child = () => workspace.batches.find((run: Item) => run.lines?.some((line: Item) => line.basketAssignments?.some((assignment: Item) => assignment.runId === parent.id)))!
  const firstChild = child()
  expect(firstChild).toMatchObject({ eventId, status: 'draft', quantity: 4 })
  expect(firstChild.lines[0].basketAssignments).toEqual([{ runId: parent.id, quantity: 3 }])
  expect(saved().orderId).toBeUndefined()
  expect(workspace.batches).toHaveLength(before.batches.length + 2)
  expect((await ok('productionSave', 'batches', parent)).batches).toEqual(workspace.batches)
  expect(workspace.ledger).toEqual(before.ledger)
  const competing = await call('productionSave', 'batches', { ...parent, id: 'fixture-contents-competing' })
  expect(competing.error).toMatch(/Purchased tea tin.*0 eligible/)
  expect((await ok()).batches).toEqual(workspace.batches)
  async function mark(stage: ChecklistStage) {
    for (const entry of basketChecklist(saved().lines[0], workspace, stage)) {
      workspace = await ok('productionChecklist', 'batches', { id: parent.id, lineId: saved().lines[0].id, expectedRevision: saved().revision, stage, key: entry.key, signature: entry.signature, checked: true })
    }
  }
  await mark('reviewed')
  workspace = await ok('productionSave', 'batches', { ...saved(), status: 'scheduled', expectedRevision: saved().revision })
  expect(find(workspace.products, 'basket-test-roll').quantity).toBe(0)
  const missing = basketChecklist(saved().lines[0], workspace, 'picked')[0]
  expect((await call('productionChecklist', 'batches', { id: parent.id, lineId: saved().lines[0].id, expectedRevision: saved().revision, stage: 'picked', key: missing.key, signature: missing.signature, checked: true })).error).toMatch(/3 packages still needed/)
  workspace = await ok('productionSave', 'batches', { ...child(), status: 'scheduled', expectedRevision: child().revision })
  workspace = await ok('productionRecordActuals', 'batches', { id: child().id, expectedRevision: child().revision, lines: [{ id: child().lines[0].id, output: 2, waste: 1, wasteReason: 'Fixture reject' }] })
  const componentPost = { id: child().id, expectedRevision: child().revision }
  workspace = await ok('productionComplete', 'batches', componentPost)
  expect((await ok('productionComplete', 'batches', componentPost)).ledger).toEqual(workspace.ledger)
  expect(find(workspace.products, 'basket-test-roll').quantity).toBe(2)
  expect(marketOutput(child(), child().lines[0], eventId, workspace)).toEqual({ planned: 4, completed: 2, forBaskets: 3 })
  expect((await call('productionSave', 'batches', { id: 'fixture-excess-content', eventId, status: 'draft', lines: [{ id: 'fixture-excess-line', productId: 'basket-test-roll', quantity: 2, mapping, basketAssignments: [{ runId: parent.id, quantity: 2 }] }] })).error).toMatch(/exceed unmet basket demand/)
  workspace = await ok('productionRecordActuals', 'batches', { id: parent.id, expectedRevision: saved().revision, lines: [{ id: saved().lines[0].id, output: 1 }] })
  await mark('picked')
  await mark('packed')
  const raw = find(workspace.ingredients, 'basket-test-flour').quantity
  const bags = find(workspace.ingredients, 'bag').quantity
  const boxes = find(workspace.ingredients, 'box').quantity
  const rollCost = find(workspace.products, 'basket-test-roll').cost
  const post = { id: parent.id, expectedRevision: saved().revision }
  workspace = await ok('productionComplete', 'batches', post)
  expect(find(workspace.products, 'basket-test-roll').quantity).toBe(1)
  expect(find(workspace.products, 'basket-test-tea').quantity).toBe(2)
  expect(find(workspace.products, 'basket-test-set').quantity).toBe(1)
  expect(find(workspace.ingredients, 'basket-test-flour').quantity).toBe(raw)
  expect(find(workspace.ingredients, 'bag').quantity).toBe(bags)
  expect(find(workspace.ingredients, 'box').quantity).toBe(boxes - 1)
  expect(saved().historicalCost).toBeCloseTo(rollCost + 4 + 1 + 1)
  expect((await ok('productionComplete', 'batches', post)).ledger).toEqual(workspace.ledger)
  expect((await ok()).batches).toEqual(workspace.batches)

  const canceledId = 'fixture-cancel-contents'
  workspace = await ok('productionSave', 'batches', { ...parent, id: canceledId, name: 'Basket to cancel', lines: [{ ...parent.lines[0], quantity: 1, basketPlan: {} }] })
  const linked = workspace.batches.find((run: Item) => run.lines?.some((line: Item) => line.basketAssignments?.some((assignment: Item) => assignment.runId === canceledId)))
  expect(linked.quantity).toBe(1)
  workspace = await ok('productionSave', 'batches', { ...linked, status: 'scheduled', expectedRevision: linked.revision })
  workspace = await ok('productionRecordActuals', 'batches', { id: linked.id, expectedRevision: find(workspace.batches, linked.id).revision, lines: [{ id: linked.lines[0].id, output: 1 }] })
  workspace = await ok('productionComplete', 'batches', { id: linked.id, expectedRevision: find(workspace.batches, linked.id).revision })
  const beforeCancel = workspace
  workspace = await ok('productionCancel', 'batches', { id: canceledId, expectedRevision: find(workspace.batches, canceledId).revision })
  expect(find(workspace.batches, linked.id)).toEqual(find(beforeCancel.batches, linked.id))
  expect(workspace.ledger).toEqual(beforeCancel.ledger)
  expect(find(workspace.products, 'basket-test-roll').quantity).toBe(2)
  const postedRun = find(workspace.batches, linked.id)
  expect(marketOutput(postedRun, postedRun.lines[0], eventId, workspace)).toEqual({ planned: 1, completed: 1, forBaskets: 0 })
})

it('saves, allocates, produces, and sells a fixed mixed six-pack without duplicate stock posting', async () => {
  session.user = 'production-owner-a'
  const { outputs, wrapped, pack, flour, container, labels, wrap } = mixedPackFixture()
  const fixture = { ...pack, productCategoryId: 'food', mixedLabelTemplateId: '' }
  for (const product of [...outputs, wrapped]) await ok('save', 'products', product)
  expect((await call('save', 'products', { ...fixture, expectedContents: 5 })).error).toMatch(/contents count mismatch/i)
  await ok('save', 'products', fixture)
  expect(find((await ok()).products, pack.id)).toMatchObject({ kitComponents: pack.kitComponents, expectedContents: 6 })
  const date = '2026-11-24'
  const existingId = 'mixed-existing-output'
  await ok('productionSave', 'batches', { id: existingId, productId: outputs[0].id, quantity: 4, status: 'scheduled', date })
  let workspace = await ok('productionComplete', 'batches', { id: existingId, output: 4 })
  const before = workspace
  const parent = { id: 'mixed-parent-run', name: pack.name, status: 'draft', date, expectedRevision: 0, planContents: true,
    lines: [{ id: 'mixed-parent-line', productId: pack.id, quantity: 10, basketPlan: { [outputs[0].id]: { stock: 4, wholeBatch: true } } }],
  }
  workspace = await ok('productionSave', 'batches', parent)
  const saved = () => find(workspace.batches, parent.id)
  const linked = workspace.batches.filter((run: Item) => run.lines?.some((line: Item) => line.basketAssignments?.some((assignment: Item) => assignment.runId === parent.id)))
  expect(basketProduction(saved().lines[0], workspace, parent.id).map((row) => [row.required, row.allocated, row.pending])).toEqual([[30, 4, 26], [30, 0, 30]])
  expect(linked.map((run: Item) => run.quantity).sort((left: number, right: number) => left - right)).toEqual([30, 36])
  expect((await call('productionSave', 'batches', { ...parent, id: 'mixed-competing-run' })).error).toMatch(/0 eligible/)
  expect(workspace.ledger).toEqual(before.ledger)
  const grocery = generateGroceryList(workspace, { ...emptyGrocerySources, runs: [parent.id, ...linked.map((run: Item) => run.id)] }, 'mixed-grocery', date)
  expect(grocery.lines.find((line) => line.name === flour.name)).toMatchObject({ needed: 660 })
  expect(grocery.lines.find((line) => line.name === container.name)).toMatchObject({ needed: 10 })
  expect(grocery.lines.find((line) => line.name === labels.name)).toMatchObject({ needed: 20 })
  expect(grocery.lines.find((line) => line.name === wrap.name)).toBeUndefined()
  const mark = async (stage: ChecklistStage) => {
    for (const entry of basketChecklist(saved().lines[0], workspace, stage))
      workspace = await ok('productionChecklist', 'batches', { id: parent.id, lineId: saved().lines[0].id, expectedRevision: saved().revision, stage, key: entry.key, signature: entry.signature, checked: true })
  }
  await mark('reviewed')
  workspace = await ok('productionSave', 'batches', { ...saved(), status: 'scheduled', expectedRevision: saved().revision })
  workspace = await ok('productionRecordActuals', 'batches', { id: parent.id, expectedRevision: saved().revision, lines: [{ id: saved().lines[0].id, output: 10 }] })
  expect((await call('productionComplete', 'batches', { id: parent.id, expectedRevision: saved().revision })).status).toBe(400)
  expect((await ok()).ledger).toEqual(before.ledger)
  for (const run of linked) {
    workspace = await ok('productionSave', 'batches', { ...run, status: 'scheduled', expectedRevision: run.revision })
    workspace = await ok('productionRecordActuals', 'batches', { id: run.id, expectedRevision: find(workspace.batches, run.id).revision, lines: [{ id: run.lines[0].id, output: run.quantity }] })
    const post = { id: run.id, expectedRevision: find(workspace.batches, run.id).revision }
    workspace = await ok('productionComplete', 'batches', post)
    expect((await ok('productionComplete', 'batches', post)).ledger).toEqual(workspace.ledger)
  }
  expect(find(workspace.ingredients, flour.id).quantity).toBe(find(before.ingredients, flour.id).quantity - 660)
  await mark('picked')
  await mark('packed')
  const finish = { id: parent.id, expectedRevision: saved().revision }
  const raw = find(workspace.ingredients, flour.id).quantity
  const setContainerFixtureStock = async (quantity: number) => {
    await db.query("SELECT set_config('app.business_id',$1,false)", [a])
    await db.query("UPDATE ingredients SET quantity=$3,data=jsonb_set(data,'{quantity}',to_jsonb($3::numeric)) WHERE business_id=$1 AND id=$2", [a, container.id, quantity])
  }
  await setContainerFixtureStock(9)
  const beforeFailure = await ok()
  expect((await call('productionComplete', 'batches', finish)).status).toBe(400)
  const afterFailure = await ok()
  expect(afterFailure.ledger).toEqual(beforeFailure.ledger)
  expect(afterFailure.products).toEqual(beforeFailure.products)
  await setContainerFixtureStock(25)
  workspace = await ok('productionComplete', 'batches', finish)
  expect(find(workspace.products, pack.id).quantity).toBe(10)
  expect(find(workspace.products, outputs[0].id).quantity).toBe(10)
  expect(find(workspace.products, outputs[1].id).quantity).toBe(0)
  expect(find(workspace.ingredients, flour.id).quantity).toBe(raw)
  expect(find(workspace.ingredients, container.id).quantity).toBe(15)
  expect(find(workspace.ingredients, labels.id).quantity).toBe(5)
  expect(find(workspace.ingredients, wrap.id).quantity).toBe(100)
  expect(saved().historicalCost).toBeCloseTo(47.5)
  expect((await ok('productionComplete', 'batches', finish)).ledger).toEqual(workspace.ledger)
  workspace = await ok('save', 'sales', { id: 'mixed-sale', name: pack.name, productId: pack.id, date, quantity: 1, amount: 18 })
  expect(find(workspace.products, pack.id).quantity).toBe(9)
  expect(find(workspace.sales, 'mixed-sale').costSource).toBe('finished_weighted_average')
})
