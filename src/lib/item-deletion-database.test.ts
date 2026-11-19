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
  user: 'category-owner-a',
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
const photos = vi.hoisted(() => new Map<string, ArrayBuffer>())
vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    set: async (key: string, value: ArrayBuffer) => {
      photos.set(key, value)
    },
    get: async (key: string) => photos.get(key) || null,
  }),
}))
import handler from '../../netlify/functions/workspace.mts'
const db = new PGlite()
const orgA = '00000000-0000-4000-8000-000000000011',
  orgB = '00000000-0000-4000-8000-000000000012'
const rate = {
  id: 'food-rate',
  name: 'Configured food treatment',
  jurisdiction: 'Test jurisdiction',
  ratePercent: 5,
  behavior: 'exclusive',
  appliesTo: 'all_products',
}
const context = {
  cookies: { get: () => 'a'.repeat(64) },
} as unknown as Context
async function call(
  body?: Record<string, unknown>,
  query = '?productCategories=1',
) {
  const response = await handler(
    new Request(
      'https://deletion-test.invalid/api/workspace' + query,
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
  return { status: response.status, ...(await response.json()) }
}
beforeAll(async () => {
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root))
    await db.exec(
      await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
    )
  for (const [org, user] of [
    [orgA, 'category-owner-a'],
    [orgB, 'category-owner-b'],
  ]) {
    await db.query(
      'INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3)',
      [org, 'Category test', user],
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
          name: 'Category test',
          taxRates: [
            rate,
            {
              ...rate,
              id: 'non-food-rate',
              name: 'Configured non-food treatment',
              ratePercent: 10,
            },
          ],
          productCategories: [
            {
              id: 'unclassified',
              name: 'Existing review category',
              classification: null,
            },
          ],
        }),
      ],
    )
    await db.query(
      'INSERT INTO ingredients(id,business_id,data,quantity,cost) VALUES($1,$2,$3,$4,$5)',
      [
        'flour',
        org,
        JSON.stringify({
          id: 'flour',
          name: 'Flour',
          unit: 'g',
          quantity: 100,
          cost: 0.01,
          threshold: 0,
        }),
        100,
        0.01,
      ],
    )
    await db.query(
      'INSERT INTO recipes(id,business_id,data) VALUES($1,$2,$3)',
      [
        'recipe',
        org,
        JSON.stringify({
          id: 'recipe',
          name: 'Bread',
          yield: 1,
          yieldUnit: 'each',
          lines: [{ ingredientId: 'flour', quantity: 1, unit: 'g' }],
        }),
      ],
    )
    await db.query(
      'INSERT INTO products(id,business_id,data,recipe_id) VALUES($1,$2,$3,$4)',
      [
        'legacy',
        org,
        JSON.stringify({
          id: 'legacy',
          name: 'Legacy bread',
          category: 'Existing text',
          taxStatus: 'exempt',
          taxRateIds: ['food-rate'],
          recipeId: 'recipe',
          unitsPerPackage: 1,
          unpacked: true,
          price: 20,
        }),
        'recipe',
      ],
    )
  }
  await db.query(
    'INSERT INTO users(id,business_id,data,identity_id,role) VALUES($1,$2,$3,$4,$5)',
    ['staff', orgA, '{}', 'category-staff', 'Production Staff'],
  )
  await db.exec(
    'CREATE ROLE category_app; GRANT USAGE ON SCHEMA public TO category_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO category_app; SET ROLE category_app;',
  )
  session.client = {
    query: (sql: string, params?: unknown[]) => db.query(sql, params),
    release() {},
  }
}, 30000)
afterAll(async () => {
  await db.close()
})

const command = (action: string, table: string, item: Item) =>
  call(
    {
      action,
      table,
      data: { id: item.id, expectedName: item.name, confirmed: true },
    },
    '',
  )
async function insert(table: string, item: Item, org = orgA) {
  await db.exec('RESET ROLE')
  if (table === 'products')
    await db.query(
      'INSERT INTO products(id,business_id,data) VALUES($1,$2,$3)',
      [item.id, org, JSON.stringify(item)],
    )
  else
    await db.query(
      `INSERT INTO ${table}(id,business_id,data) VALUES($1,$2,$3)`,
      [item.id, org, JSON.stringify(item)],
    )
  await db.exec('SET ROLE category_app')
}
it('deletes unused items of all types and retains shared assets and immutable deletion audit', async () => {
  for (const [table, workflow] of [
    ['ingredients', 'ingredient'],
    ['recipes', 'food'],
    ['products', 'food'],
    ['products', 'handmade'],
    ['products', 'resale'],
    ['products', 'kit'],
  ]) {
    const item: Item = {
      id: `unused-${workflow}-${table}`,
      name: `Unused ${workflow}`,
      workflow,
      quantity: 0,
    }
    await insert(table, item)
    const check = await command('itemDeleteCheck', table, item)
    expect(check.status, check.error).toBe(200)
    expect(check.blockers).toEqual([])
    const result = await command('itemDelete', table, item)
    expect(result.status, result.error).toBe(200)
    expect(result.workspace[table].some((r: Item) => r.id === item.id)).toBe(
      false,
    )
    expect(
      result.workspace.activity.some(
        (r: Item) => r.type === 'itemDelete' && r.detail.includes(item.id),
      ),
    ).toBe(true)
  }
})
it('blocks JSON links, actual relational references and stored stock even when JSON quantity is zero', async () => {
  const linked = await command('itemDeleteCheck', 'recipes', {
    id: 'recipe',
    name: 'Bread',
  })
  expect(linked.blockers.join(' ')).toContain('Legacy bread')
  expect(
    (await command('itemDelete', 'recipes', { id: 'recipe', name: 'Bread' }))
      .status,
  ).toBeGreaterThanOrEqual(400)
  const normalized = {
    id: 'normalized-only',
    name: 'Normalized only',
    quantity: 0,
  }
  await insert('ingredients', normalized)
  await db.exec('RESET ROLE')
  await db.query(
    'INSERT INTO recipe_lines(id,business_id,data,recipe_id,ingredient_id,quantity,unit) VALUES($1,$2,$3,$4,$5,$6,$7)',
    ['normalized-link', orgA, '{}', 'recipe', normalized.id, 1, 'g'],
  )
  await db.exec('SET ROLE category_app')
  const actual = await command('itemDeleteCheck', 'ingredients', normalized)
  expect(actual.blockers.join(' ')).toContain('recipe lines')
  expect(
    (await command('itemDelete', 'ingredients', normalized)).status,
  ).toBeGreaterThanOrEqual(400)
  const item = { id: 'stored-stock', name: 'Stored stock', quantity: 0 }
  await insert('ingredients', item)
  // Seed an inconsistent synthetic record to exercise normalized stock checks.
  await db.exec('RESET ROLE')
  await db.query(
    'UPDATE ingredients SET quantity=2 WHERE business_id=$1 AND id=$2',
    [orgA, item.id],
  )
  await db.exec('SET ROLE category_app')
  const check = await command('itemDeleteCheck', 'ingredients', item)
  expect(check.blockers.join(' ')).toContain('Stored stock remains')
  expect(
    (await command('itemDelete', 'ingredients', item)).status,
  ).toBeGreaterThanOrEqual(400)
})
it('rechecks dependencies after confirmation and retains historical orders', async () => {
  const item = { id: 'late-dependency', name: 'Late dependency' }
  await insert('ingredients', item)
  expect(
    (await command('itemDeleteCheck', 'ingredients', item)).blockers,
  ).toEqual([])
  await insert('orders', {
    id: 'historical-order',
    name: 'Historical order',
    lines: [{ ingredientId: item.id, quantity: 1 }],
  })
  const blocked = await command('itemDelete', 'ingredients', item)
  expect(blocked.status).toBeGreaterThanOrEqual(400)
  const current = await call(undefined, '')
  expect(
    current.workspace.orders.some((r: Item) => r.id === 'historical-order'),
  ).toBe(true)
  expect(
    current.workspace.ingredients.some((r: Item) => r.id === item.id),
  ).toBe(true)
})
it('rejects foreign-business IDs and staff deletion and prevents stale drafts recreating deleted IDs', async () => {
  const foreign = { id: 'only-in-other-business', name: 'Other business item' }
  await insert('recipes', foreign, orgB)
  expect(
    (await command('itemDeleteCheck', 'recipes', foreign)).status,
  ).toBeGreaterThanOrEqual(400)
  session.user = 'category-staff'
  expect(
    (await command('itemDelete', 'recipes', { id: 'recipe', name: 'Bread' }))
      .status,
  ).toBeGreaterThanOrEqual(400)
  session.user = 'category-owner-a'
  const recreated = await call(
    {
      action: 'save',
      table: 'recipes',
      data: {
        id: 'unused-food-recipes',
        name: 'Stale draft',
        yield: 1,
        yieldUnit: 'each',
        laborMinutes: 0,
        laborRate: 0,
        overhead: 0,
        waste: 0,
        lines: [{ ingredientId: 'flour', quantity: 1, unit: 'g' }],
      },
    },
    '',
  )
  expect(recreated.status).toBeGreaterThanOrEqual(400)
  expect(recreated.error).toContain('permanently deleted')
})
it('offers explicit kit archive while keeping links and the definition intact', async () => {
  const item = {
    id: 'linked-kit',
    name: 'Linked kit',
    workflow: 'kit',
    quantity: 0,
  }
  await insert('products', item)
  await insert('orders', {
    id: 'kit-order',
    name: 'Kit order',
    productId: item.id,
  })
  const check = await command('itemDeleteCheck', 'products', item)
  expect(check.canArchive).toBe(true)
  expect(check.blockers.length).toBeGreaterThan(0)
  const result = await command('itemArchive', 'products', item)
  expect(result.status, result.error).toBe(200)
  expect(
    result.workspace.products.find((r: Item) => r.id === item.id).archived,
  ).toBe(true)
  expect(result.workspace.orders.some((r: Item) => r.id === 'kit-order')).toBe(
    true,
  )
})

it('preserves stock history at zero quantity and rolls back child cleanup if deletion fails', async () => {
  const historical: Item = {
    id: 'zero-with-history',
    name: 'Zero with history',
    quantity: 0,
  }
  await insert('ingredients', historical)
  await db.exec('RESET ROLE')
  await db.query(
    'INSERT INTO ledger(id,business_id,data,ingredient_id) VALUES($1,$2,$3,$4)',
    [
      'historical-movement',
      orgA,
      JSON.stringify({
        id: 'historical-movement',
        name: 'Past receipt',
        ingredientId: historical.id,
        type: 'purchase_receipt',
        quantity: 0,
        amount: 0,
      }),
      historical.id,
    ],
  )
  await db.exec('SET ROLE category_app')
  const blocked = await command('itemDeleteCheck', 'ingredients', historical)
  expect(blocked.blockers.join(' ')).toContain('ledger')
  expect(
    (await command('itemDelete', 'ingredients', historical)).status,
  ).toBeGreaterThanOrEqual(400)
  const current = await call(undefined, '')
  expect(
    current.workspace.ledger.some(
      (row: Item) => row.id === 'historical-movement',
    ),
  ).toBe(true)

  const recipe: Item = { id: 'reject-delete', name: 'Rollback recipe' }
  await insert('recipes', recipe)
  await db.exec('RESET ROLE')
  await db.query(
    'INSERT INTO recipe_lines(id,business_id,data,recipe_id,ingredient_id,quantity,unit) VALUES($1,$2,$3,$4,$5,$6,$7)',
    ['rollback-line', orgA, '{}', recipe.id, 'flour', 1, 'g'],
  )
  await db.exec(
    "CREATE FUNCTION deletion_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id='reject-delete' THEN RAISE EXCEPTION 'Fixture rejected deletion'; END IF; RETURN OLD; END $$; CREATE TRIGGER deletion_fixture_failure BEFORE DELETE ON recipes FOR EACH ROW EXECUTE FUNCTION deletion_fixture_failure(); SET ROLE category_app;",
  )
  expect(
    (await command('itemDelete', 'recipes', recipe)).status,
  ).toBeGreaterThanOrEqual(400)
  await db.exec('RESET ROLE')
  expect(
    (
      await db.query(
        'SELECT id FROM recipe_lines WHERE business_id=$1 AND id=$2',
        [orgA, 'rollback-line'],
      )
    ).rows,
  ).toHaveLength(1)
  expect(
    (
      await db.query('SELECT id FROM recipes WHERE business_id=$1 AND id=$2', [
        orgA,
        recipe.id,
      ])
    ).rows,
  ).toHaveLength(1)
  await db.exec('SET ROLE category_app')
})
