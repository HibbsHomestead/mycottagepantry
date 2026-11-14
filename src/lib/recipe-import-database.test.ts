// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { parseRecipeText } from './recipe-import'
import { costBreakdown, type Item } from './domain'
import { inventoryReviewReasons } from './inventory-review'
const runtime = vi.hoisted(() => ({ client: null as any, expired: false }))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({ pool: { connect: async () => runtime.client } }),
}))
vi.mock('../../netlify/lib/verified-session', async (original) => ({
  ...(await original<typeof import('../../netlify/lib/verified-session')>()),
  verifiedSession: async () =>
    runtime.expired
      ? null
      : { id: 'recipe-test-owner', confirmedAt: '2026-01-01T00:00:00Z' },
  selectedWorkspace: () => undefined,
}))
import handler from '../../netlify/functions/workspace.mts'
const db = new PGlite()
const org = '00000000-0000-4000-8000-000000000001'
const context = { cookies: { get: () => 'a'.repeat(64) } } as any
const source =
  'Bread\nYield: 2 loaves\nIngredients:\n8 cups bread flour\nInstructions:\n1. Mix.\n2. Bake.'
const initial = {
  id: 'bread-draft',
  updatedAt: '2026-01-01T00:00:00Z',
  status: 'needs_review',
  sourceText: source,
  mime: 'text/plain',
  method: 'Pasted text',
  draft: parseRecipeText(source),
}
async function request(body?: any, query = '?recipeImports=1') {
  const response = await handler(
    new Request(
      'https://recipe-test.invalid/api/workspace' + query,
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
  // Disposable PostgreSQL only: never applies migrations to a Netlify branch.
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root))
    await db.exec(
      await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
    )
  await db.query(
    'INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3)',
    [org, 'Isolated recipe test', 'recipe-test-owner'],
  )
  await db.query(
    'INSERT INTO users(id,business_id,data,identity_id,role) VALUES($1,$2,$3,$4,$5)',
    ['owner', org, '{}', 'recipe-test-owner', 'Owner'],
  )
  await db.query('INSERT INTO settings(id,business_id,data) VALUES($1,$2,$3)', [
    'business',
    org,
    JSON.stringify({
      id: 'business',
      name: 'Isolated recipe test',
      taxRates: [],
    }),
  ])
  await db.query(
    'INSERT INTO ingredients(id,business_id,data,quantity,cost) VALUES($1,$2,$3,$4,$5)',
    [
      'flour',
      org,
      JSON.stringify({
        id: 'flour',
        name: 'Bread flour',
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
    'INSERT INTO recipe_imports(id,business_id,data) VALUES($1,$2,$3)',
    [initial.id, org, JSON.stringify(initial)],
  )
  await db.exec(
    'CREATE ROLE recipe_app; GRANT USAGE ON SCHEMA public TO recipe_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO recipe_app; SET ROLE recipe_app;',
  )
  runtime.client = {
    query: (sql: string, params?: any[]) => db.query(sql, params),
    release() {},
  }
}, 30000)
afterAll(async () => {
  await db.close()
})
it('persists separate import confirmation and validated setup across reloads without stock or accounting writes', async () => {
  const imported = await request(
    {
      action: 'import',
      table: 'ingredients',
      data: {
        rows: [
          {
            id: 'inventory-review-reload',
            name: 'Imported rye flour',
            category: 'Imported — needs review',
            usedAs: 'ingredient',
            unit: 'g',
            storageUnit: 'g',
            recipeUnit: 'cup',
            quantity: 0,
            cost: 0,
            currentCost: 0,
            needsCostSetup: true,
            threshold: 0,
            conversions: [],
            reviewed: false,
          },
        ],
        reason: 'Disposable inventory review verification',
      },
    },
    '',
  )
  expect(imported.status, imported.error).toBe(200)
  const id = 'inventory-review-reload'
  let saved = imported.workspace.ingredients.find((i: Item) => i.id === id)
  const before = {
    ledger: imported.workspace.ledger,
    journals: imported.workspace.journals,
  }
  expect(inventoryReviewReasons(saved)).toEqual([
    'import',
    'purchase',
    'cost',
    'conversion',
  ])
  const unconfirmed = await request(
    {
      action: 'inventoryMarkReviewed',
      table: 'ingredients',
      data: { id, expectedUpdatedAt: saved.updatedAt },
    },
    '',
  )
  expect(unconfirmed.status).toBe(400)
  const marked = await request(
    {
      action: 'inventoryMarkReviewed',
      table: 'ingredients',
      data: {
        id,
        expectedUpdatedAt: saved.updatedAt,
        confirmed: true,
        quantity: 900,
        cost: 8,
        needsCostSetup: false,
        reviewed: true,
      },
    },
    '',
  )
  expect(marked.status, marked.error).toBe(200)
  expect(
    (
      await request(
        {
          action: 'inventoryMarkReviewed',
          table: 'ingredients',
          data: { id, expectedUpdatedAt: saved.updatedAt, confirmed: true },
        },
        '',
      )
    ).status,
  ).toBe(400)
  let fresh = (await request(undefined, '')).workspace
  saved = fresh.ingredients.find((i: Item) => i.id === id)
  expect(saved).toMatchObject({
    importNeedsReview: false,
    needsCostSetup: true,
    quantity: 0,
    cost: 0,
    currentCost: 0,
    reviewed: false,
  })
  expect(saved.importReviewedAt).toBeTruthy()
  expect(inventoryReviewReasons(saved)).toEqual([
    'purchase',
    'cost',
    'conversion',
  ])
  const failedFix = await request(
    {
      action: 'ingredientUpdate',
      table: 'ingredients',
      data: {
        id,
        expectedUpdatedAt: saved.updatedAt,
        threshold: 0,
        purchaseSetup: { packageUnit: 'bag', price: '', stockUnits: 500 },
        purchaseSetupConfirmed: true,
      },
    },
    '',
  )
  expect(failedFix.status).toBe(400)
  expect(
    inventoryReviewReasons(
      (await request(undefined, '')).workspace.ingredients.find(
        (i: Item) => i.id === id,
      ),
    ),
  ).toEqual(['purchase', 'cost', 'conversion'])
  const fixed = await request(
    {
      action: 'ingredientUpdate',
      table: 'ingredients',
      data: {
        id,
        expectedUpdatedAt: saved.updatedAt,
        threshold: 0,
        purchaseSetup: { packageUnit: 'bag', price: 4.75, stockUnits: 500 },
        purchaseSetupConfirmed: true,
        conversions: [
          {
            from: 'cup',
            to: 'g',
            amountFrom: 1,
            amountTo: 120,
            verified: true,
          },
        ],
      },
    },
    '',
  )
  expect(fixed.status, fixed.error).toBe(200)
  fresh = (await request(undefined, '')).workspace
  saved = fresh.ingredients.find((i: Item) => i.id === id)
  expect(saved).toMatchObject({
    quantity: 0,
    cost: 0,
    currentCost: 4.75 / 500,
    needsCostSetup: false,
    reviewed: false,
    importNeedsReview: false,
  })
  expect(inventoryReviewReasons(saved, fresh)).toEqual([])
  expect({ ledger: fresh.ledger, journals: fresh.journals }).toEqual(before)
})

it('retains legacy imported-data review when setup is fixed and the category is changed', async () => {
  await db.exec(`BEGIN; SET LOCAL app.business_id='${org}';`)
  await db.query(
    'INSERT INTO ingredients(id,business_id,data,quantity,cost) VALUES($1,$2,$3,$4,$5)',
    [
      'legacy-inventory-review',
      org,
      JSON.stringify({
        id: 'legacy-inventory-review',
        name: 'Legacy imported sugar',
        category: 'Imported — needs review',
        unit: 'g',
        quantity: 0,
        cost: 0,
        needsCostSetup: true,
      }),
      0,
      0,
    ],
  )
  await db.exec('COMMIT')
  const before = (await request(undefined, '')).workspace.ingredients.find(
    (i: Item) => i.id === 'legacy-inventory-review',
  )
  const fixed = await request(
    {
      action: 'ingredientUpdate',
      table: 'ingredients',
      data: {
        id: before.id,
        expectedUpdatedAt: before.updatedAt,
        categoryId: 'sugar-sweeteners',
        threshold: 0,
        purchaseSetup: { packageUnit: 'bag', price: 3.25, stockUnits: 750 },
        purchaseSetupConfirmed: true,
      },
    },
    '',
  )
  expect(fixed.status, fixed.error).toBe(200)
  const fresh = (await request(undefined, '')).workspace.ingredients.find(
    (i: Item) => i.id === before.id,
  )
  expect(fresh.category).toBe('Sugar & sweeteners')
  expect(inventoryReviewReasons(fresh)).toEqual(['import'])
})
it('persists packaging category, units and costs through the oven API without assuming case contents', async () => {
  const data = {
    id: 'packaging-api-test',
    name: 'Test bags',
    categoryId: 'packaging',
    category: 'Packaging',
    usedAs: 'packaging',
    unit: 'each',
    purchaseQuantity: 100,
    purchaseUnit: 'each',
    packagePrice: 12,
    threshold: 0,
    subingredients: 'Retain existing declaration',
    allergens: ['Wheat'],
    reviewed: true,
  }
  const created = await request(
    { action: 'save', table: 'ingredients', data },
    '',
  )
  expect(created.status, created.error).toBe(200)
  let reopened = (await request(undefined, '')).workspace.ingredients.find(
    (i: Item) => i.id === data.id,
  )
  expect(reopened).toMatchObject({
    ...data,
    quantity: 100,
    cost: 0.12,
    currentCost: 0.12,
  })
  expect(
    created.workspace.ledger.filter(
      (entry: Item) => entry.ingredientId === data.id,
    ),
  ).toHaveLength(1)
  const boxed = {
    ...reopened,
    purchaseQuantity: 1,
    purchaseUnit: 'box',
    expectedUpdatedAt: reopened.updatedAt,
  }
  const undefinedContents = await request(
    { action: 'ingredientUpdate', table: 'ingredients', data: boxed },
    '',
  )
  expect(undefinedContents.status).toBe(400)
  expect(undefinedContents.error).toMatch(/verified.*conversion/)
  const definedContents = await request(
    {
      action: 'ingredientUpdate',
      table: 'ingredients',
      data: {
        ...boxed,
        conversions: [
          {
            from: 'box',
            to: 'each',
            amountFrom: 1,
            amountTo: 100,
            verified: true,
          },
        ],
      },
    },
    '',
  )
  expect(definedContents.status, definedContents.error).toBe(200)
  reopened = (await request(undefined, '')).workspace.ingredients.find(
    (i: Item) => i.id === data.id,
  )
  expect(reopened).toMatchObject({
    categoryId: 'packaging',
    usedAs: 'packaging',
    purchaseQuantity: 1,
    purchaseUnit: 'box',
    packagePrice: 12,
    quantity: 100,
    cost: 0.12,
    currentCost: 0.12,
    subingredients: data.subingredients,
    allergens: ['Wheat'],
    reviewed: true,
  })
  for (const categoryId of ['flour-grains', 'packaging']) {
    const changed = await request(
      {
        action: 'ingredientUpdate',
        table: 'ingredients',
        data: {
          ...reopened,
          categoryId,
          expectedUpdatedAt: reopened.updatedAt,
        },
      },
      '',
    )
    if (categoryId === 'flour-grains') {
      expect(changed.status).toBe(400)
      expect(changed.error).toContain('Item Type is fixed')
      reopened = (await request(undefined, '')).workspace.ingredients.find(
        (i: Item) => i.id === data.id,
      )
      expect(reopened.usedAs).toBe('packaging')
    } else {
      expect(changed.status, changed.error).toBe(200)
      reopened = changed.workspace.ingredients.find(
        (i: Item) => i.id === data.id,
      )
    }
    expect(reopened.purchaseUnit).toBe('box')
    expect(reopened.cost).toBe(0.12)
    expect(reopened.currentCost).toBe(0.12)
    expect(reopened.subingredients).toBe(data.subingredients)
    expect(reopened.reviewed).toBe(true)
  }
  expect(reopened.categoryId).toBe('packaging')
  expect(reopened.usedAs).toBe('packaging')
})
it('persists an incomplete draft, reopens and updates it, then approves exactly once with real SQL and normalized lines', async () => {
  const draft = {
    ...initial.draft,
    lines: initial.draft.lines.map((l) => ({
      ...l,
      ingredientId: 'flour',
      decision: 'match' as const,
      confirmed: false,
      cupStandard: 'us' as const,
      preparation: 'sifted',
    })),
  }
  const first = await request({
    operation: 'save',
    id: initial.id,
    expectedUpdatedAt: initial.updatedAt,
    draft,
  })
  expect(first.status, first.error).toBe(200)
  const retry = await request({
    operation: 'save',
    id: initial.id,
    expectedUpdatedAt: initial.updatedAt,
    draft,
  })
  expect(retry).toMatchObject({
    status: 200,
    alreadySaved: true,
    import: { updatedAt: first.import.updatedAt },
  })
  const conflict = await request({
    operation: 'save',
    id: initial.id,
    expectedUpdatedAt: initial.updatedAt,
    draft: { ...draft, title: 'Conflicting edit' },
  })
  expect(conflict).toMatchObject({
    status: 409,
    code: 'IMPORT_REVISION_CONFLICT',
    stage: 'revision_check',
  })
  const reopened = await request(undefined, '?recipeImports=1&id=' + initial.id)
  expect(reopened.import.draft).toEqual(draft)
  const second = await request({
    operation: 'save',
    id: initial.id,
    expectedUpdatedAt: first.import.updatedAt,
    draft: { ...draft, title: 'Edited bread' },
  })
  expect(second.status, second.error).toBe(200)
  const manualWithoutConversion = await request(
    {
      action: 'save',
      table: 'recipes',
      data: {
        id: 'manual-unfinished',
        name: 'Manual unfinished',
        yield: 2,
        yieldUnit: 'loaves',
        lines: [{ ingredientId: 'flour', quantity: 8, unit: 'cup' }],
      },
    },
    '',
  )
  expect(manualWithoutConversion.status).toBe(400)
  expect(manualWithoutConversion.error).toMatch(/verified unit conversion/)
  const unconfirmed = await request({
    operation: 'approve',
    id: initial.id,
    expectedUpdatedAt: second.import.updatedAt,
    draft: second.import.draft,
  })
  expect(unconfirmed.status).toBe(400)
  const approve = {
    operation: 'approve',
    id: initial.id,
    expectedUpdatedAt: second.import.updatedAt,
    draft: {
      ...second.import.draft,
      lines: second.import.draft.lines.map((l: any) => ({
        ...l,
        confirmed: true,
      })),
    },
  }
  const approved = await request(approve)
  expect(approved.status, approved.error).toBe(200)
  expect((await request(approve)).alreadyApproved).toBe(true)
  const workspace = (await request(undefined, '')).workspace
  expect(workspace.recipes).toHaveLength(1)
  expect(workspace.recipes[0]).toMatchObject({
    name: 'Edited bread',
    yield: 2,
    yieldUnit: 'loaves',
    instructions: 'Mix.\n\nBake.',
    lines: [
      {
        ingredientId: 'flour',
        quantity: 8,
        unit: 'cup',
        preparation: 'sifted',
      },
    ],
  })
  expect(() =>
    costBreakdown(workspace.recipes[0], workspace.ingredients),
  ).toThrow(/incomplete/)
  await db.exec(`BEGIN; SET LOCAL app.business_id='${org}';`)
  expect((await db.query('SELECT id FROM recipe_lines')).rows).toHaveLength(1)
  expect((await db.query('SELECT id FROM recipe_imports')).rows).toHaveLength(1)
  await db.exec('COMMIT')
})
it('saves a verified conversion once, recalculates cost and exercises the shared manual recipe save service', async () => {
  const conversion = {
    action: 'conversion',
    table: 'ingredients',
    data: {
      ingredientId: 'flour',
      from: 'cup',
      to: 'g',
      amountFrom: 1,
      amountTo: 125,
      source: 'user_entered',
      verified: true,
      notes: 'Synthetic measurement for isolated test only',
    },
  }
  expect((await request(conversion, '')).status).toBe(200)
  const saved = await request(conversion, '')
  expect(saved.status, saved.error).toBe(200)
  expect(saved.workspace.ingredients[0].conversions).toHaveLength(1)
  expect(
    costBreakdown(saved.workspace.recipes[0], saved.workspace.ingredients)
      .ingredient,
  ).toBe(10)
  const manual = await request(
    {
      action: 'save',
      table: 'recipes',
      data: {
        id: 'manual-bread',
        name: 'Manual bread',
        yield: 2,
        yieldUnit: 'loaves',
        instructions: 'Mix and bake.',
        lines: [{ ingredientId: 'flour', quantity: 8, unit: 'cup' }],
      },
    },
    '',
  )
  expect(manual.status, manual.error).toBe(200)
  expect(manual.workspace.recipes).toHaveLength(2)
})
it('rejects an expired session without touching saved rows', async () => {
  runtime.expired = true
  expect(
    (await request({ operation: 'save', id: initial.id, draft: {} })).status,
  ).toBe(401)
  runtime.expired = false
  expect(
    (await request(undefined, '?recipeImports=1&id=' + initial.id)).import
      .status,
  ).toBe('approved')
})
it('saves and approves independently of unrelated oven costing and tax initialization', async () => {
  // Reproduces the shared pre-handler failure: missing settings previously threw
  // while reading taxRates, before either import operation reached its handler.
  await db.exec(`BEGIN; SET LOCAL app.business_id='${org}';`)
  await db.query('DELETE FROM settings WHERE business_id=$1', [org])
  const record = {
    ...initial,
    id: 'no-settings',
    draft: { ...initial.draft, title: 'Independent import' },
  }
  await db.query(
    'INSERT INTO recipe_imports(id,business_id,data) VALUES($1,$2,$3)',
    [record.id, org, JSON.stringify(record)],
  )
  // An unrelated broken compound must not prevent an unfinished draft save.
  const compound = {
    id: 'broken-compound',
    name: 'Unrelated prep',
    unit: 'g',
    quantity: 0,
    cost: 0,
    compoundRecipeId: 'unavailable-recipe',
  }
  await db.query(
    'INSERT INTO ingredients(id,business_id,data,quantity,cost) VALUES($1,$2,$3,0,0)',
    [compound.id, org, JSON.stringify(compound)],
  )
  await db.exec('COMMIT')
  const incomplete = {
    ...record.draft,
    title: '',
    yieldQuantity: null,
    lines: record.draft.lines.map((l) => ({
      ...l,
      quantity: null,
      unit: '',
      preparation: 'keep this edit',
    })),
  }
  const saved = await request({
    operation: 'save',
    id: record.id,
    expectedUpdatedAt: record.updatedAt,
    draft: incomplete,
  })
  expect(saved.status, saved.error).toBe(200)
  expect(
    (await request(undefined, '?recipeImports=1&id=' + record.id)).import.draft,
  ).toEqual(incomplete)
  const approved = await request({
    operation: 'approve',
    id: record.id,
    expectedUpdatedAt: saved.import.updatedAt,
    draft: {
      ...record.draft,
      lines: record.draft.lines.map((l) => ({
        ...l,
        ingredientId: 'flour',
        decision: 'match',
        confirmed: true,
        cupStandard: 'us',
      })),
    },
  })
  expect(approved.status, approved.error).toBe(200)
  await db.exec(`BEGIN; SET LOCAL app.business_id='${org}';`)
  await db.query('DELETE FROM ingredients WHERE business_id=$1 AND id=$2', [
    org,
    compound.id,
  ])
  await db.query('INSERT INTO settings(id,business_id,data) VALUES($1,$2,$3)', [
    'business',
    org,
    JSON.stringify({ id: 'business', taxRates: [] }),
  ])
  await db.exec('COMMIT')
})
it('rolls back a failed SQL approval, reports sanitized validation paths, and retains the saved draft', async () => {
  const record = {
    ...initial,
    id: 'rollback-draft',
    draft: {
      ...initial.draft,
      title: 'Rollback test',
      lines: initial.draft.lines.map((l) => ({
        ...l,
        quantity: 1e30,
        ingredientId: 'flour',
        decision: 'match' as const,
        confirmed: true,
        cupStandard: 'us' as const,
      })),
    },
  }
  await db.exec(`BEGIN; SET LOCAL app.business_id='${org}';`)
  await db.query(
    'INSERT INTO recipe_imports(id,business_id,data) VALUES($1,$2,$3)',
    [record.id, org, JSON.stringify(record)],
  )
  await db.exec('COMMIT')
  const invalid = await request({
    operation: 'save',
    id: record.id,
    expectedUpdatedAt: record.updatedAt,
    draft: { ...record.draft, sourceUrl: 'not a public URL' },
  })
  expect(invalid).toMatchObject({
    status: 400,
    code: 'IMPORT_DRAFT_INVALID',
    stage: 'draft_validation',
    fields: [{ path: 'sourceUrl' }],
  })
  const failed = await request({
    operation: 'approve',
    id: record.id,
    expectedUpdatedAt: record.updatedAt,
    draft: record.draft,
  })
  expect(failed.status).toBe(400)
  expect(failed.stage).toBe('recipe_write')
  expect(failed.error).toMatch(/database could not save/i)
  expect(
    (await request(undefined, '?recipeImports=1&id=' + record.id)).import,
  ).toMatchObject({
    status: 'needs_review',
    updatedAt: record.updatedAt,
    draft: record.draft,
  })
  const workspace = (await request(undefined, '')).workspace
  expect(
    workspace.recipes.some((r: any) => r.id === 'import-' + record.id),
  ).toBe(false)
})
it('saves a reopened legacy draft beyond the queue limit by its authorized stable ID', async () => {
  const record = { ...initial, id: 'legacy-draft' }
  await db.exec(`BEGIN; SET LOCAL app.business_id='${org}';`)
  await db.query(
    'INSERT INTO recipe_imports(id,business_id,data,created_at) VALUES($1,$2,$3,$4)',
    [record.id, org, JSON.stringify(record), '1999-01-01'],
  )
  await db.query(
    `INSERT INTO recipe_imports(id,business_id,data) SELECT 'legacy-queue-' || n, $1::uuid, jsonb_set($2::jsonb, '{id}', to_jsonb('legacy-queue-' || n)) FROM generate_series(1,201) n`,
    [org, JSON.stringify(initial)],
  )
  await db.exec('COMMIT')
  const queue = await request()
  expect(queue.imports).toHaveLength(200)
  expect(queue.imports.some((r: any) => r.id === record.id)).toBe(false)
  const reopened = await request(undefined, '?recipeImports=1&id=' + record.id)
  expect(reopened.import.id).toBe(record.id)
  const saved = await request({
    operation: 'save',
    id: record.id,
    expectedUpdatedAt: record.updatedAt,
    draft: { ...record.draft, title: 'Legacy draft edited' },
  })
  expect(saved.status, saved.error).toBe(200)
  expect(
    (await request(undefined, '?recipeImports=1&id=' + record.id)).import.draft
      .title,
  ).toBe('Legacy draft edited')
  expect(
    (
      await request({
        operation: 'save',
        id: 'foreign-or-missing',
        expectedUpdatedAt: record.updatedAt,
        draft: record.draft,
      })
    ).status,
  ).toBe(404)
})
