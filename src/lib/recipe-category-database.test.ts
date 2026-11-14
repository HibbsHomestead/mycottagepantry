// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import type { Item, Workspace } from './domain'
import type { Context } from '@netlify/functions'
import type { RecipeCategory } from './recipe-categories'
vi.mock('@netlify/blobs', () => ({
  getStore: () => ({ set: async () => {}, get: async () => null }),
}))
const runtime = vi.hoisted(() => ({
  client: null as {
    query: (sql: string, params?: unknown[]) => Promise<unknown>
    release: () => void
  } | null,
  user: 'recipe-owner-a',
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
const db = new PGlite(),
  orgA = '00000000-0000-4000-8000-000000000081',
  orgB = '00000000-0000-4000-8000-000000000082'
const recipe = {
  id: 'bread',
  name: 'Original bread',
  category: 'Breads',
  yield: 2,
  yieldUnit: 'loaves',
  laborMinutes: 10,
  laborRate: 18,
  overhead: 2,
  imageAssetId: 'original-photo',
  lines: [{ ingredientId: 'flour', quantity: 200, unit: 'g' }],
}
async function call(
  body?: Record<string, unknown>,
  query = '?recipeCategories=1',
) {
  const response = await handler(
    new Request(
      'https://recipe-category.invalid/api/workspace' + query,
      body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {},
    ),
    { cookies: { get: () => 'a'.repeat(64) } } as unknown as Context,
  )
  return { status: response.status, ...(await response.json()) } as {
    status: number
    error?: string
    revision: number
    categories: RecipeCategory[]
    workspace: Workspace
  }
}
async function change(body: Record<string, unknown>) {
  const current = await call()
  return call({ expectedRevision: current.revision, ...body })
}
beforeAll(async () => {
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root))
    await db.exec(
      await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
    )
  for (const [org, user] of [
    [orgA, 'recipe-owner-a'],
    [orgB, 'recipe-owner-b'],
  ]) {
    await db.query(
      'INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3)',
      [org, 'Disposable recipe category business', user],
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
        JSON.stringify({ id: 'business', name: 'Recipe test', taxRates: [] }),
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
          quantity: 1000,
          cost: 0.01,
          usedAs: 'ingredient',
          conversions: [],
        }),
        1000,
        0.01,
      ],
    )
    await db.query(
      'INSERT INTO recipes(id,business_id,data) VALUES($1,$2,$3)',
      [recipe.id, org, JSON.stringify(recipe)],
    )
    await db.query(
      'INSERT INTO products(id,business_id,data,recipe_id) VALUES($1,$2,$3,$4)',
      [
        'linked-product',
        org,
        JSON.stringify({
          id: 'linked-product',
          name: 'Bread product',
          recipeId: recipe.id,
          unitsPerPackage: 1,
          price: 8,
          packagingQuantity: 1,
        }),
        recipe.id,
      ],
    )
  }
  await db.exec(
    'CREATE ROLE recipe_category_app; GRANT USAGE ON SCHEMA public TO recipe_category_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO recipe_category_app; SET ROLE recipe_category_app;',
  )
  runtime.client = {
    query: (sql: string, params?: unknown[]) => db.query(sql, params),
    release() {},
  }
}, 30000)
afterAll(() => db.close())

it('persists custom categories and icons, rejects duplicates, stale changes, and invalid icons', async () => {
  const result = await change({
    operation: 'saveCategory',
    category: { name: 'Market treats', icon: 'candy' },
  })
  expect(result.status, result.error).toBe(200)
  const saved = result.categories.find((c: Item) => c.name === 'Market treats')!
  expect((await call()).categories).toContainEqual(saved)
  const duplicate = await change({
    operation: 'saveCategory',
    category: { name: ' MARKET   TREATS ', icon: 'cookie' },
  })
  expect(duplicate.status).toBe(400)
  expect(duplicate.error).toMatch(/already exists/)
  expect(
    (
      await call({
        operation: 'saveCategory',
        expectedRevision: 0,
        category: { name: 'Stale', icon: 'cake' },
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await change({
        operation: 'saveCategory',
        category: { name: 'Bad icon', icon: 'invalid' },
      })
    ).status,
  ).toBe(400)
})

it('changes recipe categories without changing photos, yield, costs, ingredient lines or product links; renames and archives retain references', async () => {
  let current = await call()
  const custom = current.categories.find(
    (c: Item) => c.name === 'Market treats',
  )!
  const assigned = await call(
    {
      action: 'save',
      table: 'recipes',
      data: { ...recipe, category: custom.name, recipeCategoryId: custom.id },
    },
    '',
  )
  expect(assigned.status, assigned.error).toBe(200)
  const saved = assigned.workspace.recipes.find((r: Item) => r.id === recipe.id)
  expect(saved).toMatchObject({
    ...recipe,
    category: custom.name,
    recipeCategoryId: custom.id,
  })
  expect(assigned.workspace.products[0].recipeId).toBe(recipe.id)
  expect(assigned.workspace.ingredients[0].quantity).toBe(1000)
  expect(assigned.workspace.ledger).toHaveLength(0)
  const renamed = await change({
    operation: 'saveCategory',
    category: { id: custom.id, name: 'Special treats', icon: 'pastry' },
  })
  expect(renamed.status, renamed.error).toBe(200)
  expect(
    renamed.categories.find((c: Item) => c.id === custom.id),
  ).toMatchObject({
    name: 'Special treats',
    icon: 'pastry',
    previousNames: ['Market treats'],
  })
  expect(
    (
      await change({
        operation: 'setCategoryActive',
        categoryId: custom.id,
        active: false,
      })
    ).status,
  ).toBe(200)
  const reopened = (await call(undefined, '')).workspace.recipes[0]
  expect(reopened.recipeCategoryId).toBe(custom.id)
  expect(
    (
      await call(
        {
          action: 'save',
          table: 'recipes',
          data: { ...reopened, description: 'Still editable' },
        },
        '',
      )
    ).status,
  ).toBe(200)
  const rejected = await call(
    {
      action: 'save',
      table: 'recipes',
      data: {
        ...recipe,
        id: 'new-archived',
        recipeCategoryId: custom.id,
        category: 'Special treats',
      },
    },
    '',
  )
  expect(rejected.status).toBe(400)
  expect(rejected.error).toMatch(/Archived/)
  // Generic settings saves cannot bypass category revision/validation.
  const w = (await call(undefined, '')).workspace
  const bypass = await call(
    {
      action: 'save',
      table: 'settings',
      data: {
        ...w.settings[0],
        recipeCategories: [],
        recipeCategoryRevision: 999,
      },
    },
    '',
  )
  expect(bypass.status, bypass.error).toBe(200)
  current = await call()
  expect(current.categories.some((c: Item) => c.id === custom.id)).toBe(true)
  expect(current.revision).not.toBe(999)
})

it('preserves source categories for import review and validates reviewed category choices', async () => {
  const created = (await call(
    {
      operation: 'create',
      kind: 'text',
      text: 'Category review recipe\nCategory: Family traditions\nYield: 2 loaves\nIngredients:\n200 g Flour\nInstructions:\nMix well.',
    },
    '?recipeImports=1',
  )) as unknown as {
    status: number
    error?: string
    imports: {
      id: string
      updatedAt: string
      draft: Record<string, unknown> & { lines: Record<string, unknown>[] }
    }[]
  }
  expect(created.status, created.error).toBe(200)
  expect(created.imports[0].draft.importedCategory).toBe('Family traditions')
  const approved = await call(
    {
      operation: 'approve',
      id: created.imports[0].id,
      expectedUpdatedAt: created.imports[0].updatedAt,
      draft: {
        ...created.imports[0].draft,
        lines: created.imports[0].draft.lines.map((l) => ({
          ...l,
          ingredientId: 'flour',
          decision: 'match',
          confirmed: true,
        })),
      },
    },
    '?recipeImports=1',
  )
  expect(approved.status, approved.error).toBe(200)
  const w = (await call(undefined, '')).workspace
  expect(
    w.recipes.find((r) => r.name === 'Category review recipe'),
  ).toMatchObject({
    category: '',
    recipeCategoryId: '',
    importedCategory: 'Family traditions',
    categoryNeedsReview: true,
  })
  expect(w.ingredients[0].quantity).toBe(1000)
  expect(w.ledger).toHaveLength(0)
  const csv = await call(
    {
      action: 'import',
      table: 'recipes',
      data: {
        reason: 'Disposable category test',
        rows: [
          {
            ...recipe,
            id: 'csv-category',
            name: 'CSV recipe',
            category: 'Unfamiliar source category',
          },
        ],
      },
    },
    '',
  )
  expect(csv.status, csv.error).toBe(200)
  expect(
    csv.workspace.recipes.find((r) => r.id === 'csv-category'),
  ).toMatchObject({
    category: '',
    importedCategory: 'Unfamiliar source category',
    categoryNeedsReview: true,
  })
  const breadCategory = (await call()).categories.find(
    (c) => c.name === 'Breads',
  )!
  await change({
    operation: 'saveCategory',
    category: { id: breadCategory.id, name: 'Loaf favorites', icon: 'bread' },
  })
  const legacyCsv = await call(
    {
      action: 'import',
      table: 'recipes',
      data: {
        reason: 'Legacy category import',
        rows: [
          {
            ...recipe,
            id: 'csv-legacy-category',
            name: 'CSV legacy recipe',
            category: ' BREADS ',
          },
        ],
      },
    },
    '',
  )
  expect(legacyCsv.status, legacyCsv.error).toBe(200)
  expect(
    legacyCsv.workspace.recipes.find((r) => r.id === 'csv-legacy-category'),
  ).toMatchObject({
    recipeCategoryId: breadCategory.id,
    category: 'Loaf favorites',
    importedCategory: ' BREADS ',
    categoryNeedsReview: false,
  })
})

it('isolates business categories, rejects foreign IDs and enforces category management roles', async () => {
  const custom = (await call()).categories.find(
    (c: Item) => c.name === 'Special treats',
  )!
  runtime.user = 'recipe-owner-b'
  expect((await call()).categories.some((c: Item) => c.id === custom.id)).toBe(
    false,
  )
  expect(
    (
      await change({
        operation: 'saveCategory',
        category: { id: custom.id, name: 'Cross business', icon: 'drink' },
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await call(
        {
          action: 'save',
          table: 'recipes',
          data: { ...recipe, recipeCategoryId: custom.id },
        },
        '',
      )
    ).status,
  ).toBe(400)
  await db.query('BEGIN')
  await db.query("SELECT set_config('app.business_id',$1,true)", [orgB])
  await db.query(
    "UPDATE users SET role='Production Staff' WHERE business_id=$1",
    [orgB],
  )
  await db.query('COMMIT')
  expect((await call()).status).toBe(200)
  const forbidden = await change({
    operation: 'saveCategory',
    category: { name: 'Not permitted', icon: 'drink' },
  })
  expect(forbidden.status).toBe(400)
  expect(forbidden.error).toMatch(/Owner or Manager/)
})
