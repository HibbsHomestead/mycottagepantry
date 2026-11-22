// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import type { Context } from '@netlify/functions'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import { detectSquare } from './square-sales'
const session = vi.hoisted(() => ({
  client: null as any,
  user: 'square-owner-a',
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
const db = new PGlite(),
  a = '00000000-0000-4000-8000-000000000081',
  b = '00000000-0000-4000-8000-000000000082'
async function call(action?: string, data: any = {}) {
  const response = await handler(
    new Request(
      'https://square.invalid/api/workspace',
      action
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, table: 'sales_imports', data }),
          }
        : {},
    ),
    { cookies: { get: () => 'a'.repeat(64) } } as unknown as Context,
  )
  return { status: response.status, ...(await response.json()) }
}
async function ok(action?: string, data: any = {}) {
  const r = await call(action, data)
  expect(r.status, r.error).toBe(200)
  return r.workspace
}
async function stage(kind: string) {
  const csv = await readFile(`public/demo/square-${kind}.csv`, 'utf8')
  const w = await ok('squareStage', {
    csv,
    filename: `simulated-${kind}.csv`,
    options: detectSquare(csv),
  })
  return w.sales_imports.find((i: any) => i.name === `simulated-${kind}.csv`)
}
async function commit(batch: any, choices = batch.choices) {
  await ok('squareReview', { id: batch.id, choices })
  return ok('squareCommit', {
    id: batch.id,
    choices,
    confirm: true,
    acknowledge: true,
  })
}
beforeAll(async () => {
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root))
    await db.exec(
      await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
    )
  for (const [org, user] of [
    [a, 'square-owner-a'],
    [b, 'square-owner-b'],
  ]) {
    await db.query(
      'INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3)',
      [org, 'Fictional Square bakery', user],
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
          name: 'Fictional Square bakery',
          currency: 'USD',
        }),
      ],
    )
    await db.query(
      'INSERT INTO ingredients(id,business_id,data,quantity,cost) VALUES($1,$2,$3,10,2)',
      [
        'flour',
        org,
        JSON.stringify({
          id: 'flour',
          name: 'Flour',
          unit: 'g',
          quantity: 10,
          cost: 2,
          currentCost: 2,
        }),
      ],
    )
    await db.query(
      'INSERT INTO products(id,business_id,data) VALUES($1,$2,$3)',
      [
        org === a ? 'cookies' : 'private-product',
        org,
        JSON.stringify({
          id: org === a ? 'cookies' : 'private-product',
          name: 'Simulated Cookies',
          sku: 'SIM-COOKIE-3',
          price: 7,
          unitsPerPackage: 3,
        }),
      ],
    )
    await db.query('INSERT INTO sales(id,business_id,data) VALUES($1,$2,$3)', [
      'manual',
      org,
      JSON.stringify({
        id: 'manual',
        name: 'Manual unchanged sale',
        amount: 9,
        quantity: 1,
        date: '2026-10-01',
      }),
    ])
  }
  await db.query(
    'INSERT INTO users(id,business_id,data,identity_id,role) VALUES($1,$2,$3,$4,$5)',
    ['staff', a, '{}', 'square-staff', 'Production Staff'],
  )
  await db.exec(
    'CREATE ROLE square_app; GRANT USAGE ON SCHEMA public TO square_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO square_app; SET ROLE square_app;',
  )
  session.client = {
    query: (sql: string, params?: any[]) => db.query(sql, params),
    release() {},
  }
}, 30000)
afterAll(async () => {
  await db.close()
})
let item: any, tx: any
it('stages without posting; commits matches and metadata transactionally without inventory or price changes', async () => {
  const before = await ok()
  item = await stage('items')
  let w = await ok()
  expect(w.sales).toHaveLength(1)
  expect(item.status).toBe('staged')
  const choices = { ...item.choices }
  const cookieKey = item.rows[0].mappingKey
  choices[cookieKey] = { productId: 'cookies', multiplier: 1, save: true }
  w = await commit(item, choices)
  expect(w.sales.reduce((a: number, s: any) => a + s.amount, 0)).toBe(43)
  expect(
    w.sales
      .filter((s: any) => s.productId === 'cookies')
      .reduce((a: number, s: any) => a + s.quantity, 0),
  ).toBe(4)
  expect(
    w.sales.some(
      (s: any) =>
        s.externalSource === 'square' && !s.productId && s.amount !== 0,
    ),
  ).toBe(true)
  expect(w.ingredients).toEqual(before.ingredients)
  expect(w.products).toEqual(before.products)
  expect(w.ledger).toEqual(before.ledger)
  expect(w.journals).toEqual(before.journals)
  expect(w.sales_product_mappings).toHaveLength(1)
  const retry = await ok('squareCommit', {
    id: item.id,
    confirm: true,
    acknowledge: true,
    choices,
  })
  expect(retry.sales).toEqual(w.sales)
})
it('rejects duplicate files, persists mappings and enriches with transaction records without duplication', async () => {
  const csv = await readFile('public/demo/square-items.csv', 'utf8')
  expect(
    (
      await call('squareStage', {
        csv,
        filename: 'same-content-different-name.csv',
        options: detectSquare(csv),
      })
    ).status,
  ).toBe(400)
  tx = await stage('transactions')
  let w = await commit(tx)
  expect(w.sales.reduce((a: number, s: any) => a + s.amount, 0)).toBe(43)
  expect(
    w.sales.reduce((a: number, s: any) => a + (s.tax || 0), 0),
  ).toBeCloseTo(2.04)
  const overlap = await stage('overlap')
  expect(overlap.choices[overlap.rows[0].mappingKey]).toMatchObject({
    productId: 'cookies',
    multiplier: 1,
  })
  w = await commit(overlap)
  expect(w.sales.reduce((a: number, s: any) => a + s.amount, 0)).toBe(49)
})
it('undo removes only one contribution, preserves another import and manual records, and retains audit', async () => {
  const w = await ok('squareUndo', { id: item.id, confirm: true })
  expect(w.sales.find((s: any) => s.id === 'manual').amount).toBe(9)
  expect(w.sales.reduce((a: number, s: any) => a + s.amount, 0)).toBe(49)
  expect(
    w.sales_imports
      .find((i: any) => i.id === item.id)
      .history.some((h: any) => h.action === 'reversed'),
  ).toBe(true)
  expect(w.sales_product_mappings).toHaveLength(1)
  expect(w.activity.some((i: any) => i.name === 'Square import reversed')).toBe(
    true,
  )
  expect(w.ledger).toEqual([])
})
it('enforces tenant isolation, owned mappings and staff permissions including hidden source data', async () => {
  session.user = 'square-owner-b'
  expect((await call('squareUndo', { id: tx.id, confirm: true })).status).toBe(
    400,
  )
  let w = await ok()
  expect(w.sales_imports).toEqual([])
  expect(w.sales_product_mappings).toEqual([])
  expect(w.sales).toHaveLength(1)
  const own = await stage('items')
  const choices = {
    ...own.choices,
    [own.rows[0].mappingKey]: { productId: 'cookies', multiplier: 1 },
  }
  expect((await call('squareReview', { id: own.id, choices })).status).toBe(400)
  session.user = 'square-staff'
  expect((await call('squareUndo', { id: tx.id, confirm: true })).status).toBe(
    400,
  )
  w = await ok()
  expect(w.sales_imports).toEqual([])
  expect(w.sales_product_mappings).toEqual([])
  session.user = 'square-owner-a'
})
it('rolls back ambiguous overlaps and currency rejection without partial sales or mappings', async () => {
  const before = await ok()
  const raw = await readFile('public/demo/square-items.csv', 'utf8')
  const csv = raw.replaceAll('SIM-', 'CAD-SIM-').replaceAll(',USD', ',CAD')
  const w = await ok('squareStage', {
    csv,
    filename: 'other-currency.csv',
    options: detectSquare(csv),
  })
  const batch = w.sales_imports.find(
    (i: any) => i.name === 'other-currency.csv',
  )
  await ok('squareReview', { id: batch.id, choices: batch.choices })
  expect(
    (
      await call('squareCommit', {
        id: batch.id,
        choices: batch.choices,
        confirm: true,
        acknowledge: true,
      })
    ).status,
  ).toBe(400)
  const after = await ok()
  expect(after.sales).toEqual(before.sales)
  expect(after.sales_product_mappings).toEqual(before.sales_product_mappings)
})
it('requires a fresh review after import history changes and rejects direct import-record edits', async () => {
  const batch = await stage('summary')
  await ok('squareReview', { id: batch.id, choices: batch.choices })
  const csv = 'Date,Net Sales,Currency\n2026-11-20,1.00,USD'
  await ok('squareStage', {
    csv,
    filename: 'simulated-another-summary.csv',
    options: detectSquare(csv),
  })
  const rejected = await call('squareCommit', {
    id: batch.id,
    choices: batch.choices,
    confirm: true,
    acknowledge: true,
  })
  expect(rejected.status).toBe(400)
  expect(rejected.error).toMatch(/history changed/)
  expect(
    (
      await call('save', {
        id: batch.id,
        name: 'Forged status',
        status: 'committed',
      })
    ).status,
  ).toBe(400)
  const w = await commit(batch)
  expect(w.sales_imports.find((b: any) => b.id === batch.id).status).toBe(
    'committed',
  )
  expect(w.sales.reduce((sum: number, s: any) => sum + s.amount, 0)).toBe(49)
})
