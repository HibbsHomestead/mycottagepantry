// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import type { Context } from '@netlify/functions'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import { handleAdminCatalog } from '../../netlify/lib/catalog-admin'
import type { AdminClient } from '../../netlify/lib/platform-admin-core'
const session = vi.hoisted(() => ({
  client: null as unknown,
  user: 'catalog-owner-a',
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
  orgA = '00000000-0000-4000-8000-000000000081',
  orgB = '00000000-0000-4000-8000-000000000082'
const context = { cookies: { get: () => undefined } } as unknown as Context
const c = {
  query: (sql: string, params?: unknown[]) => db.query(sql, params),
  release() {},
}
async function call(body: unknown, query = 'catalog=1') {
  const res = await handler(
    new Request(
      'https://catalog-test.invalid/api/workspace' + (query ? '?' + query : ''),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
    context,
  )
  return { status: res.status, ...(await res.json()) }
}
const snapshot = {
  kind: 'ingredient',
  entryType: 'branded',
  fields: {
    name: 'Reference flour',
    brand: 'Test mill',
    barcode: '036000291452',
    subingredients: 'Wheat (flour, malt)',
    sourceContains: 'Contains wheat.',
    sourceMayContain: 'May contain soy.',
  },
}
let itemId = '',
  revisionId = ''
async function admin(body: unknown, mfa = true) {
  await db.exec("BEGIN; SELECT set_config('app.platform_gateway','true',true)")
  try {
    const result = await handleAdminCatalog(
      c as AdminClient,
      new Request(
        'https://admin.mycottagepantry.com/api/admin?action=catalog',
        { method: 'POST', body: JSON.stringify(body) },
      ),
      {
        identity_id: 'catalog-admin',
        role: 'admin',
        mfa_at: mfa ? '2026-11-07' : null,
      },
      crypto.randomUUID(),
    )
    await db.exec('COMMIT')
    return result
  } catch (e) {
    await db.exec('ROLLBACK')
    throw e
  }
}
const publication = (extra = {}) => ({
  operation: 'publish',
  snapshot,
  sources: [
    {
      url: 'https://example.org/permitted-package',
      license: 'Synthetic test data, permitted reuse',
    },
  ],
  reviewScope:
    'Compared identity, barcode and the three separate statements with the test package.',
  rights: true,
  ...extra,
})
beforeAll(async () => {
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root))
    await db.exec(
      await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
    )
  for (const [org, user] of [
    [orgA, 'catalog-owner-a'],
    [orgB, 'catalog-owner-b'],
  ]) {
    await db.query(
      'INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3)',
      [org, 'Synthetic catalog test', user],
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
          name: 'Synthetic catalog test',
          taxRates: [],
          currency: 'USD',
        }),
      ],
    )
  }
  await db.query(
    'INSERT INTO ingredients(id,business_id,data,quantity,cost) VALUES($1,$2,$3,0,0)',
    [
      'existing',
      orgA,
      JSON.stringify({
        id: 'existing',
        name: 'Private existing flour',
        usedAs: 'ingredient',
        unit: 'g',
        barcode: '4006381333931',
        quantity: 0,
        cost: 0,
        currentCost: 0,
        notes: 'Private notes',
        vendor: 'Private supplier',
      }),
    ],
  )
  await db.exec(
    'CREATE ROLE catalog_app; GRANT USAGE ON SCHEMA public TO catalog_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO catalog_app; SET ROLE catalog_app',
  )
  session.client = c
}, 30000)
afterAll(async () => db.close())
it('stops on a private barcode match and returns only account-owned identity data without stock writes', async () => {
  const result = await call({
    operation: 'lookup',
    query: '4006381333931',
    kind: 'ingredient',
  })
  expect(result.status, result.error).toBe(200)
  expect(result.existing).toEqual([
    { id: 'existing', name: 'Private existing flour', usedAs: 'ingredient' },
  ])
  expect(result.results).toBeUndefined()
  session.user = 'catalog-owner-b'
  const other = await call({
    operation: 'lookup',
    query: '4006381333931',
    kind: 'packaging',
  })
  expect(other.existing).toBeUndefined()
  session.user = 'catalog-owner-a'
})
it('loads generic starter names without inventing branded data', async () => {
  const result = await call({
    operation: 'search',
    query: 'flour',
    kind: 'ingredient',
  })
  expect(result.status, result.error).toBe(200)
  expect(result.results[0].fields).toEqual({ name: 'All-purpose flour' })
})
it('enforces administrator MFA, publishes revisions and refuses duplicate barcode packages', async () => {
  await expect(admin(publication(), false)).rejects.toMatchObject({
    code: 'MFA_REQUIRED',
  })
  const published = await admin(publication())
  itemId = published.id!
  const result = await call({
    operation: 'lookup',
    query: '0036000291452',
    kind: 'ingredient',
  })
  expect(result.status, result.error).toBe(200)
  expect(result.results).toHaveLength(1)
  revisionId = result.results[0].revisionId
  await expect(admin(publication())).rejects.toMatchObject({
    code: 'CATALOG_DUPLICATE',
  })
  const rows = await db.query(
    'SELECT id FROM catalog_revisions WHERE item_id=$1',
    [itemId],
  )
  expect(rows.rows).toHaveLength(0) // No tenant context outside a request.
})
it('creates a private snapshot with a composite source link and no stock, purchase or ledger entry', async () => {
  const result = await call(
    {
      action: 'save',
      table: 'ingredients',
      data: {
        ...snapshot.fields,
        id: 'accepted',
        creationRequestId: 'accepted-create',
        usedAs: 'ingredient',
        categoryId: 'flour-grains',
        unit: 'g',
        initialStock: false,
        inventoryCreation: true,
        catalogSource: {
          requestId: crypto.randomUUID(),
          itemId,
          revisionId,
          fields: [
            'name',
            'brand',
            'barcode',
            'subingredients',
            'sourceContains',
            'sourceMayContain',
          ],
        },
      },
    },
    '',
  )
  expect(result.status, result.error).toBe(200)
  const saved = result.workspace.ingredients.find(
    (i: { id: string }) => i.id === 'accepted',
  )
  expect(saved).toMatchObject({
    name: 'Reference flour',
    quantity: 0,
    cost: 0,
    subingredients: 'Wheat (flour, malt)',
    sourceContains: 'Contains wheat.',
    sourceMayContain: 'May contain soy.',
  })
  expect(result.workspace.ledger).toHaveLength(0)
  expect(result.workspace.receipt_extractions).toHaveLength(0)
  await db.query("SELECT set_config('app.business_id',$1,false)", [orgA])
  const sources = await db.query('SELECT data FROM ingredient_catalog_sources')
  expect(sources.rows).toHaveLength(1)
  await db.query("SELECT set_config('app.business_id',$1,false)", [orgB])
  expect(
    (await db.query('SELECT data FROM ingredient_catalog_sources')).rows,
  ).toHaveLength(0)
  await expect(
    db.query(
      'INSERT INTO ingredient_catalog_sources(id,business_id,ingredient_id,revision_id,data) VALUES($1,$2,$3,$4,$5)',
      [crypto.randomUUID(), orgB, 'accepted', revisionId, '{}'],
    ),
  ).rejects.toThrow()
  await db.query("SELECT set_config('app.business_id','',false)")
})
it('offers catalog updates without modifying private fields, stock, labels or accepted revisions', async () => {
  await admin(
    publication({
      id: itemId,
      expectedRevision: revisionId,
      snapshot: {
        ...snapshot,
        fields: {
          ...snapshot.fields,
          name: 'Corrected reference flour',
          sourceMayContain: 'May contain soy and milk.',
        },
      },
    }),
  )
  const result = await call({ operation: 'updates' })
  expect(result.status, result.error).toBe(200)
  expect(result.updates[0]).toMatchObject({
    ingredientId: 'accepted',
    fields: { name: 'Corrected reference flour' },
  })
  const reopened = await call({ operation: 'lookup', query: '036000291452' })
  expect(
    reopened.existing.find((i: { id: string }) => i.id === 'accepted').name,
  ).toBe('Reference flour')
  await db.query("SELECT set_config('app.business_id',$1,false)", [orgA])
  expect(
    (
      await db.query<{
        data: {
          catalogSource: { revisionId: string }
          sourceMayContain: string
        }
      }>('SELECT data FROM ingredients WHERE id=$1', ['accepted'])
    ).rows[0].data,
  ).toMatchObject({
    catalogSource: { revisionId },
    sourceMayContain: 'May contain soy.',
  })
  await expect(
    db.query('UPDATE ingredient_catalog_sources SET data=$1', ['{}']),
  ).rejects.toThrow(/immutable/)
  await db.query("SELECT set_config('app.platform_gateway','true',false)")
  await expect(
    db.query('UPDATE catalog_revisions SET data=$1 WHERE id=$2', [
      '{}',
      revisionId,
    ]),
  ).rejects.toThrow(/immutable/)
  await db.query("SELECT set_config('app.platform_gateway','',false)")
  const saved = (
    await db.query<{ data: Record<string, unknown> }>(
      'SELECT data FROM ingredients WHERE id=$1',
      ['accepted'],
    )
  ).rows[0].data
  await db.query("SELECT set_config('app.business_id','',false)")
  const accepted = await call(
    {
      action: 'ingredientUpdate',
      table: 'ingredients',
      data: {
        ...saved,
        expectedUpdatedAt: saved.updatedAt,
        sourceMayContain: 'May contain soy and milk.',
        catalogSource: {
          requestId: crypto.randomUUID(),
          itemId,
          revisionId: result.updates[0].revisionId,
          fields: ['sourceMayContain'],
        },
      },
    },
    '',
  )
  expect(accepted.status, accepted.error).toBe(200)
  expect(
    accepted.workspace.ingredients.find(
      (i: { id: string }) => i.id === 'accepted',
    ),
  ).toMatchObject({
    name: 'Reference flour',
    sourceContains: 'Contains wheat.',
    sourceMayContain: 'May contain soy and milk.',
    quantity: 0,
    cost: 0,
  })
  expect(accepted.workspace.ledger).toHaveLength(0)
  await db.query("SELECT set_config('app.business_id',$1,false)", [orgA])
  expect(
    (await db.query('SELECT id FROM ingredient_catalog_sources')).rows,
  ).toHaveLength(2)
  await db.query("SELECT set_config('app.business_id','',false)")
})
it('accepts explicit allowlisted contributions, isolates submissions, and refuses private fields', async () => {
  const requestId = crypto.randomUUID()
  const result = await call({
    operation: 'submit',
    snapshot,
    rights: true,
    requestId,
    targetId: itemId,
  })
  expect(result.status, result.error).toBe(200)
  expect(
    (
      await call({
        operation: 'submit',
        snapshot: { ...snapshot, fields: { ...snapshot.fields, price: 99 } },
        rights: true,
        requestId: crypto.randomUUID(),
      })
    ).status,
  ).toBe(400)
  await db.query("SELECT set_config('app.business_id',$1,false)", [orgB])
  expect(
    (await db.query('SELECT * FROM catalog_submissions')).rows,
  ).toHaveLength(0)
  await db.query("SELECT set_config('app.business_id',$1,false)", [orgA])
  const rows = await db.query<{ data: { snapshot: unknown } }>(
    'SELECT data FROM catalog_submissions',
  )
  expect(rows.rows[0].data.snapshot).toEqual(snapshot)
  await db.query("SELECT set_config('app.business_id','',false)")
})
it('withdraws references from new lookup but preserves private references and history', async () => {
  await admin({
    operation: 'status',
    id: itemId,
    status: 'withdrawn',
    reviewScope: 'The synthetic test variant was withdrawn.',
    rights: true,
  })
  const search = await call({
    operation: 'search',
    query: 'Reference flour',
    kind: 'ingredient',
  })
  expect(search.results).toEqual([])
  const updates = await call({ operation: 'updates' })
  expect(updates.updates[0].status).toBe('withdrawn')
})
it('rejects a raced second private creation with the same barcode without creating stock or another item', async () => {
  const result = await call(
    {
      action: 'save',
      table: 'ingredients',
      data: {
        id: 'raced-duplicate',
        creationRequestId: 'raced-creation',
        inventoryCreation: true,
        usedAs: 'ingredient',
        unit: 'g',
        categoryId: 'flour-grains',
        initialStock: false,
        name: 'Duplicate reference',
        barcode: '0036000291452',
      },
    },
    '',
  )
  expect(result.status).toBe(400)
  expect(result.error).toContain('already in your account')
  const lookup = await call({ operation: 'lookup', query: '036000291452' })
  expect(lookup.existing).toHaveLength(1)
  expect(lookup.existing[0].id).toBe('accepted')
})
