// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import type { Context } from '@netlify/functions'
const runtime = vi.hoisted(() => ({ client: null as any, verify: vi.fn() }))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({ pool: { connect: async () => runtime.client } }),
}))
vi.mock('@netlify/identity', () => ({
  refreshSession: runtime.verify,
  getIdentityConfig: () => null,
}))
import demo from '../../netlify/functions/demo.mts'
import workspace from '../../netlify/functions/workspace.mts'
import { resolveAccountAccess } from '../../netlify/lib/account-access'
import {
  demoEnabled,
  demoWorkspaceBlocked,
} from '../../netlify/lib/demo-session'
import { demoWorkspaceSeed } from '../../netlify/lib/demo-workspace-seed'
import { productCosting } from './domain'
const db = new PGlite()
const context = {
  cookies: { get: () => 'test-device', set: () => {} },
} as unknown as Context
const origin = 'https://preview.example.invalid'
let first = '',
  second = ''
async function request(
  handler: any,
  cookie: string,
  action?: string,
  data: any = {},
  query = '',
) {
  return handler(
    new Request(
      origin + (handler === demo ? '/api/demo' : '/api/workspace') + query,
      {
        ...(action
          ? {
              method: 'POST',
              body: JSON.stringify(
                handler === demo ? { action, ...data } : data,
              ),
            }
          : {}),
        headers: {
          'Content-Type': 'application/json',
          origin,
          cookie: cookie + '; nf_jwt=stale-real-account',
        },
      },
    ),
    context,
  )
}
async function enter() {
  const response = await request(demo, '', 'enter', {
    username: 'demo',
    password: 'demo',
  })
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(
    200,
  )
  const cookie = response.headers.get('set-cookie')!.split(';')[0]
  expect(
    response.headers
      .get('set-cookie')!
      .includes('HttpOnly; SameSite=None; Secure; Partitioned'),
  ).toBe(true)
  return cookie
}
async function read(cookie: string) {
  const response = await request(workspace, cookie)
  const value = await response.json()
  expect(response.status, value.error).toBe(200)
  return value.workspace
}
beforeAll(async () => {
  vi.stubEnv('COTTAGE_DEMO_ENABLED', 'true')
  vi.stubEnv('CONTEXT', 'deploy-preview')
  runtime.verify.mockRejectedValue(
    new Error('Stale real account must not be used'),
  )
  runtime.client = {
    query: async (sql: string, params?: unknown[]) => {
      const result = await db.query(sql, params)
      return {
        ...result,
        rowCount: /^\s*(SELECT|WITH|SHOW)/i.test(sql)
          ? result.rows.length
          : result.affectedRows,
      }
    },
    release() {},
  }
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root))
    await db.exec(
      await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
    )
}, 120000)
afterAll(async () => {
  vi.unstubAllEnvs()
  await db.close()
})
it('rejects activation in production, wrong credentials and cross-origin requests', async () => {
  vi.stubEnv('CONTEXT', 'production')
  expect(demoEnabled()).toBe(false)
  expect(
    (await request(demo, '', 'enter', { username: 'demo', password: 'demo' }))
      .status,
  ).toBe(404)
  vi.stubEnv('CONTEXT', 'deploy-preview')
  expect(
    (await request(demo, '', 'enter', { username: 'demo', password: 'wrong' }))
      .status,
  ).toBe(401)
  const cross = await demo(
    new Request(origin + '/api/demo', {
      method: 'POST',
      headers: { origin: 'https://other.invalid' },
      body: JSON.stringify({
        action: 'enter',
        username: 'demo',
        password: 'demo',
      }),
    }),
  )
  expect(cross.status).toBe(403)
})
it('enters with public credentials despite stale Identity and seeds connected costing records once', async () => {
  first = await enter()
  const access = await resolveAccountAccess(
    new Request(origin + '/api/account-access', {
      headers: { cookie: first + '; nf_jwt=stale-real-account' },
    }),
  )
  expect(access.status).toBe('workspace')
  const state = await read(first)
  expect(state.settings[0].name).toBe('Cottage Pantry Demo Bakery')
  expect(state.products.some((p: any) => p.workflow === 'kit')).toBe(true)
  expect(state.label_templates.length).toBe(4)
  expect(state.ingredients.some((i: any) => i.quantity === 0)).toBe(true)
  for (const sale of state.sales) {
    const p = state.products.find((p: any) => p.id === sale.productId)
    expect(sale.amount).toBe(p.price * sale.quantity)
    expect(sale.historicalCogs).toBeCloseTo(
      productCosting(p, state).perPackage * sale.quantity,
      8,
    )
  }
  for (const item of state.ingredients) {
    const balance = state.ledger
      .filter((l: any) => l.ingredientId === item.id)
      .reduce((sum: number, l: any) => sum + l.quantity, 0)
    expect(balance).toBeCloseTo(item.quantity, 7)
  }
  expect((await read(first)).ledger.length).toBe(state.ledger.length)
  expect(runtime.verify).not.toHaveBeenCalled()
})
it('enforces database tenant policies and keeps real records inaccessible', async () => {
  const real = '00000000-0000-4000-8000-000000000099'
  await db.query(
    'INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3)',
    [real, 'Private bakery fixture', 'real-owner'],
  )
  await db.query(
    'INSERT INTO ingredients(id,business_id,data) VALUES($1,$2,$3)',
    [
      'private-flour',
      real,
      JSON.stringify({
        id: 'private-flour',
        name: 'Private flour',
        quantity: 0,
        cost: 1,
      }),
    ],
  )
  await db.query(
    'INSERT INTO ledger(id,business_id,data,ingredient_id) VALUES($1,$2,$3,$4)',
    ['private-ledger', real, '{}', 'private-flour'],
  )
  await db.query(
    'INSERT INTO graphic_assets(id,business_id,data) VALUES($1,$2,$3)',
    [
      'private-upload',
      real,
      JSON.stringify({
        id: 'private-upload',
        key: 'never-return-this-private-file',
      }),
    ],
  )
  expect(
    (await request(workspace, first, undefined, {}, '?asset=private-upload'))
      .status,
  ).toBeGreaterThanOrEqual(400)
  const forged = await request(workspace, first, 'receive', {
    action: 'receive',
    table: 'ingredients',
    data: {
      id: 'private-flour',
      quantity: 1,
      price: 1,
      unit: 'g',
      businessId: real,
    },
  })
  expect(forged.status).toBeGreaterThanOrEqual(400)
  const access = await resolveAccountAccess(
    new Request(origin + '/api/account-access', { headers: { cookie: first } }),
  )
  await db.exec(
    'CREATE ROLE preview_demo_rls NOSUPERUSER NOBYPASSRLS; GRANT SELECT ON ingredients,products,graphic_assets TO preview_demo_rls',
  )
  await db.query("SELECT set_config('app.business_id',$1,false)", [
    access.membership!.id,
  ])
  await db.exec('SET ROLE preview_demo_rls')
  try {
    expect(
      (await db.query('SELECT * FROM ingredients WHERE business_id=$1', [real]))
        .rows,
    ).toHaveLength(0)
    expect(
      (
        await db.query('SELECT * FROM graphic_assets WHERE business_id=$1', [
          real,
        ])
      ).rows,
    ).toHaveLength(0)
    expect(
      (await db.query('SELECT * FROM ingredients')).rows.length,
    ).toBeGreaterThan(15)
  } finally {
    await db.exec('RESET ROLE')
  }
})
it('persists edits through the normal handler and isolates concurrent sessions and forged tenant IDs', async () => {
  second = await enter()
  await read(second)
  const state = await read(first)
  const updated = {
    ...state.products.find((p: any) => p.id === 'loaf'),
    name: 'My demo loaf',
  }
  const response = await request(workspace, first, 'save', {
    action: 'save',
    table: 'products',
    data: updated,
    businessId: '00000000-0000-4000-8000-000000000099',
  })
  const result = await response.json()
  expect(response.status, result.error).toBe(200)
  expect(
    (await read(first)).products.find((p: any) => p.id === 'loaf').name,
  ).toBe('My demo loaf')
  expect(
    (await read(second)).products.find((p: any) => p.id === 'loaf').name,
  ).not.toBe('My demo loaf')
  const own = await request(
    workspace,
    first,
    undefined,
    {},
    '?asset=other-business-private-file',
  )
  expect(own.status).toBeGreaterThanOrEqual(400)
})
it('uses normal production and label saves and keeps custom conversions private', async () => {
  const before = await read(first)
  const completed = await request(workspace, first, 'complete', {
    action: 'complete',
    data: { id: 'demo-bread-plan', actualYield: 8 },
  })
  const completedData = await completed.json()
  expect(completed.status, completedData.error).toBe(200)
  const after = await read(first)
  expect(
    after.batches.find((b: any) => b.id === 'demo-bread-plan').status,
  ).toBe('completed')
  expect(
    after.ingredients.find((i: any) => i.id === 'flour').quantity,
  ).toBeCloseTo(
    before.ingredients.find((i: any) => i.id === 'flour').quantity - 2400,
    7,
  )
  const document = structuredClone(
    after.label_templates.find((l: any) => l.id === 'demo-bread-label'),
  )
  document.elements[0].x = 27
  const saved = await request(workspace, first, 'labelSave', {
    action: 'labelSave',
    data: { document, expectedRevision: document.revision },
  })
  const savedData = await saved.json()
  expect(saved.status, savedData.error).toBe(200)
  expect(
    (await read(first)).label_templates.find((l: any) => l.id === document.id)
      .elements[0].x,
  ).toBe(27)
  const custom = await request(
    workspace,
    first,
    'custom',
    {
      ingredientName: 'My demo flour',
      description: 'Measured demo cup',
      inventoryIngredientId: 'flour',
      referenceWeightG: 125,
      referenceVolumeMl: 250,
      originalQuantity: 250,
      originalUnit: 'ml',
    },
    '?bakingConverter=1',
  )
  const customData = await custom.json()
  expect(custom.status, customData.error).toBe(200)
  expect(
    customData.references.some(
      (r: any) => r.scope === 'private' && r.ingredientName === 'My demo flour',
    ),
  ).toBe(true)
  const other = await request(
    workspace,
    second,
    undefined,
    {},
    '?bakingConverter=1',
  )
  expect(
    (await other.json()).references.some(
      (r: any) => r.ingredientName === 'My demo flour',
    ),
  ).toBe(false)
})
it('blocks external paths before retrieval and never accepts expired demos as real accounts', async () => {
  for (const query of [
    '?productImport=1',
    '?assistant=1',
    '?catalog=1',
    '?priceSearch=flour',
    '?dropboxChooser=1',
    '?printerSign=1',
  ]) {
    expect((await request(workspace, first, undefined, {}, query)).status).toBe(
      403,
    )
  }
  expect(
    await demoWorkspaceBlocked(
      new Request(origin + '/api/workspace', {
        method: 'POST',
        body: JSON.stringify({ action: 'receiptExtract' }),
      }),
    ),
  ).toBe(true)
  expect((await request(workspace, 'cp_demo_session=invalid')).status).toBe(401)
  expect(runtime.verify).not.toHaveBeenCalled()
})
it('resets only the current demo and cleans expired demos without permitting real history deletion', async () => {
  expect((await request(demo, first, 'reset', { confirm: false })).status).toBe(
    403,
  )
  const response = await request(demo, first, 'reset', { confirm: true })
  expect(response.status).toBe(200)
  const reset = response.headers.get('set-cookie')!.split(';')[0]
  expect(
    (await read(reset)).products.find((p: any) => p.id === 'loaf').name,
  ).toBe('Homestyle White Bread Loaf')
  expect((await read(second)).products.length).toBe(
    demoWorkspaceSeed().products.length,
  )
  expect((await request(workspace, first)).status).toBe(401)
  await db.exec(
    "UPDATE businesses SET expires_at=NOW()-INTERVAL '2 days' WHERE expires_at<NOW()",
  )
  const deleted = await db.query<{ count: number }>(
    'SELECT purge_expired_preview_demos() AS count',
  )
  expect(deleted.rows[0].count).toBe(1)
  expect(
    (
      await db.query(
        "SELECT * FROM businesses WHERE identity_owner='real-owner'",
      )
    ).rows,
  ).toHaveLength(1)
  await expect(
    db.query("DELETE FROM ledger WHERE id='private-ledger'"),
  ).rejects.toThrow('Inventory history is immutable')
  const live = await read(second)
  expect(live.ingredients.length).toBeGreaterThan(15)
  const business = (
    await db.query<{ id: string }>(
      'SELECT id FROM businesses WHERE expires_at>NOW() LIMIT 1',
    )
  ).rows[0].id
  await db.query("SELECT set_config('app.business_id',$1,false)", [business])
  await expect(
    db.query('DELETE FROM ledger WHERE business_id=$1', [business]),
  ).rejects.toThrow('Inventory history is immutable')
})
