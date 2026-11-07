// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { Context } from '@netlify/functions'
import { applicableTaxes, calculateTax, type Item } from './domain'
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
const context = { cookies: { get: () => 'a'.repeat(64) } } as unknown as Context
async function call(
  body?: Record<string, unknown>,
  query = '?productCategories=1',
) {
  const response = await handler(
    new Request(
      'https://category-test.invalid/api/workspace' + query,
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
async function category(body: Record<string, unknown>) {
  const current = await call()
  return call({ expectedRevision: current.revision, ...body })
}
const saveProduct = (data: Record<string, unknown>) =>
  call({ action: 'save', table: 'products', data }, '')
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
let foodId = ''
it('creates classified categories, rejects blanks/duplicates and saves/reopens product associations using real tenant-scoped SQL', async () => {
  const food = await category({
    operation: 'saveCategory',
    category: { name: '  Bread  ', classification: 'food' },
  })
  expect(food.status, food.error).toBe(200)
  foodId = food.selectedId
  expect(food.categories.find((c: Item) => c.id === foodId)).toMatchObject({
    name: 'Bread',
    classification: 'food',
  })
  const bags = await category({
    operation: 'saveCategory',
    category: { name: 'Bags', classification: 'non_food' },
  })
  expect(bags.status).toBe(200)
  for (const value of [
    { name: ' bread ', classification: 'food' },
    { name: ' ', classification: 'food' },
    { name: 'Unclassified new', classification: null },
  ])
    expect(
      (await category({ operation: 'saveCategory', category: value })).status,
    ).toBe(400)
  const mapping = await category({
    operation: 'saveMappings',
    mappings: { food: ['food-rate'], non_food: ['non-food-rate'] },
    confirmAffected: 0,
  })
  expect(mapping.status, mapping.error).toBe(200)
  const saved = await saveProduct({
    id: 'new-product',
    name: 'New bread',
    productCategoryId: foodId,
    taxSource: 'category',
    recipeId: 'recipe',
    unitsPerPackage: 1,
    price: 20,
    unpacked: true,
  })
  expect(saved.status, saved.error).toBe(200)
  const savedNonFood = await saveProduct({
    id: 'non-food-product',
    name: 'Market bag',
    productCategoryId: bags.selectedId,
    taxSource: 'category',
    recipeId: 'recipe',
    unitsPerPackage: 1,
    price: 20,
    unpacked: true,
  })
  expect(savedNonFood.status, savedNonFood.error).toBe(200)
  const reopened = (await call(undefined, '')).workspace
  const product = reopened.products.find((p: Item) => p.id === 'new-product')
  expect(product.productCategoryId).toBe(foodId)
  expect(
    calculateTax(20, applicableTaxes(product, reopened.settings[0])).tax,
  ).toBe(1)
  const nonFood = reopened.products.find(
    (p: Item) => p.id === 'non-food-product',
  )
  expect(nonFood.productCategoryId).toBe(bags.selectedId)
  expect(
    calculateTax(20, applicableTaxes(nonFood, reopened.settings[0])).tax,
  ).toBe(2)
  expect(
    reopened.settings[0].productCategories.find(
      (c: Item) => c.id === 'unclassified',
    ).classification,
  ).toBeNull()
})
it('preserves existing assignments, requires impact confirmation, and never rewrites completed sale taxes', async () => {
  const legacy = await saveProduct({
    id: 'legacy',
    name: 'Legacy bread edited',
    productCategoryId: foodId,
    taxSource: 'category',
    taxStatus: 'taxable',
    recipeId: 'recipe',
    unitsPerPackage: 1,
    price: 20,
    unpacked: true,
  })
  expect(legacy.status, legacy.error).toBe(200)
  const preserved = legacy.workspace.products.find(
    (p: Item) => p.id === 'legacy',
  )
  expect(preserved.taxStatus).toBe('exempt')
  expect(preserved.taxSource).toBeUndefined()
  expect(preserved.taxRateIds).toEqual(['food-rate'])
  const sale = await call(
    {
      action: 'save',
      table: 'sales',
      data: {
        id: 'sale-before',
        name: 'Sale before mapping',
        productId: 'new-product',
        amount: 20,
        quantity: 1,
        date: '2026-11-02',
      },
    },
    '',
  )
  expect(sale.status, sale.error).toBe(200)
  const snapshot = sale.workspace.sales.find(
    (s: Item) => s.id === 'sale-before',
  )
  expect(snapshot.tax).toBe(1)
  const manualSale = await call(
    {
      action: 'save',
      table: 'sales',
      data: {
        id: 'sale-manual',
        name: 'Sale with explicit rate selection',
        productId: 'new-product',
        amount: 20,
        quantity: 1,
        date: '2026-11-02',
        taxRateIds: ['non-food-rate'],
      },
    },
    '',
  )
  expect(manualSale.status, manualSale.error).toBe(200)
  const manualSnapshot = manualSale.workspace.sales.find(
    (s: Item) => s.id === 'sale-manual',
  )
  expect(manualSnapshot.tax).toBe(2)
  expect(manualSnapshot.categoryTaxSnapshot).toMatchObject({
    configuredTaxRateIds: ['food-rate'],
    taxRateIds: ['non-food-rate'],
    manualOverride: true,
  })
  expect(
    manualSale.workspace.products.find((p: Item) => p.id === 'new-product')
      .taxSource,
  ).toBe('category')
  const changed = {
    operation: 'saveMappings',
    mappings: { food: ['non-food-rate'], non_food: ['food-rate'] },
  }
  expect((await category(changed)).status).toBe(400)
  expect((await category({ ...changed, confirmAffected: 2 })).status).toBe(400)
  expect((await category({ ...changed, confirmAffected: 3 })).status).toBe(200)
  const classification = {
    operation: 'saveCategory',
    category: { id: foodId, name: 'Loaves', classification: 'non_food' },
  }
  expect((await category(classification)).status).toBe(400)
  expect(
    (await category({ ...classification, confirmAffected: 2 })).status,
  ).toBe(200)
  const refreshed = (await call(undefined, '')).workspace
  expect(
    refreshed.products.find((p: Item) => p.id === 'new-product')
      .productCategoryId,
  ).toBe(foodId)
  expect(
    refreshed.settings[0].productCategories.find((c: Item) => c.id === foodId)
      .name,
  ).toBe('Loaves')
  expect(refreshed.sales.find((s: Item) => s.id === 'sale-before')).toEqual(
    snapshot,
  )
  expect(
    (
      await category({
        operation: 'saveMappings',
        mappings: { food: ['foreign-rate'] },
      })
    ).status,
  ).toBe(400)
})
it('enforces separate oven lists, references, management permissions and stale revisions on the server', async () => {
  session.user = 'category-owner-b'
  const other = await call()
  expect(other.categories.some((c: Item) => c.id === foodId)).toBe(false)
  expect(
    (
      await category({
        operation: 'saveCategory',
        category: { id: foodId, name: 'Cross tenant', classification: 'food' },
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await saveProduct({
        name: 'Foreign category',
        productCategoryId: foodId,
        recipeId: 'recipe',
        unitsPerPackage: 1,
        price: 20,
        unpacked: true,
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await call({
        operation: 'saveCategory',
        expectedRevision: -1,
        category: { name: 'Stale', classification: 'food' },
      })
    ).status,
  ).toBe(400)
  session.user = 'category-staff'
  expect((await call()).status).toBe(200)
  expect(
    (
      await category({
        operation: 'saveCategory',
        category: { name: 'Forbidden', classification: 'food' },
      })
    ).status,
  ).toBe(400)
  session.user = 'category-owner-a'
  const workspace = (await call(undefined, '')).workspace
  const generic = await call(
    {
      action: 'save',
      table: 'settings',
      data: {
        ...workspace.settings[0],
        productCategories: [],
        categoryTaxMappings: {},
      },
    },
    '',
  )
  expect(generic.status, generic.error).toBe(200)
  expect(
    generic.workspace.settings[0].productCategories.some(
      (c: Item) => c.id === foodId,
    ),
  ).toBe(true)
})

it('archives only unlinked categories with confirmation, retains records and mappings, and isolates archive requests by Oven', async () => {
  session.user = 'category-owner-a'
  const created = await category({
    operation: 'saveCategory',
    category: { name: 'Seasonal goods', classification: 'non_food' },
  })
  const archive = {
    operation: 'setCategoryActive',
    categoryId: created.selectedId,
    active: false,
  }
  expect((await category(archive)).status).toBe(400)
  const before = (await call(undefined, '')).workspace
  const archived = await category({ ...archive, confirm: true })
  expect(archived.status, archived.error).toBe(200)
  expect(
    archived.categories.find((c: Item) => c.id === created.selectedId),
  ).toMatchObject({ active: false, name: 'Seasonal goods' })
  expect(archived.mappings).toEqual(before.settings[0].categoryTaxMappings)
  const after = (await call(undefined, '')).workspace
  expect(after.products).toEqual(before.products)
  expect(after.sales).toEqual(before.sales)
  expect(
    (
      await saveProduct({
        name: 'Invalid archived selection',
        recipeId: 'recipe',
        productCategoryId: created.selectedId,
        price: 5,
        unpacked: true,
        unitsPerPackage: 1,
      })
    ).status,
  ).toBe(400)
  expect(
    (await category({ ...archive, categoryId: foodId, confirm: true })).status,
  ).toBe(400)
  const restored = await category({ ...archive, active: true, confirm: true })
  expect(
    restored.categories.find((c: Item) => c.id === created.selectedId).active,
  ).toBe(true)
  session.user = 'category-owner-b'
  expect((await category({ ...archive, confirm: true })).status).toBe(400)
  session.user = 'category-staff'
  expect((await category({ ...archive, confirm: true })).status).toBe(400)
  session.user = 'category-owner-a'
})

it('persists a new category across requests without changing tax settings, selections, stock or historical records', async () => {
  session.user = 'category-owner-a'
  const before = (await call(undefined, '')).workspace
  const created = await category({
    operation: 'saveCategory',
    category: { name: 'Recovery check category', classification: 'non_food' },
  })
  expect(created.status, created.error).toBe(200)
  const reopened = await call()
  expect(
    reopened.categories.find((c: Item) => c.id === created.selectedId),
  ).toMatchObject({
    name: 'Recovery check category',
    classification: 'non_food',
  })
  const after = (await call(undefined, '')).workspace
  expect(after.settings[0].taxRates).toEqual(before.settings[0].taxRates)
  expect(after.settings[0].taxRate).toEqual(before.settings[0].taxRate)
  expect(after.settings[0].categoryTaxMappings).toEqual(
    before.settings[0].categoryTaxMappings,
  )
  for (const table of ['products', 'ingredients', 'recipes', 'sales', 'ledger'])
    expect(after[table]).toEqual(before[table])
})

it('saves and reopens numeric net weight without rewriting original text, stock, taxes or batch history', async () => {
  session.user = 'category-owner-a'
  const before = (await call(undefined, '')).workspace
  const base = {
    id: 'net-weight-product',
    name: 'Net weight test bread',
    recipeId: 'recipe',
    unitsPerPackage: 1,
    price: 20,
    unpacked: true,
    netQuantity: 'Net Wt. 16oz (516g)',
  }
  const legacy = await saveProduct(base)
  expect(legacy.status, legacy.error).toBe(200)
  expect(
    legacy.workspace.products.find((p: Item) => p.id === base.id),
  ).not.toHaveProperty('netWeightOz')
  const saved = await saveProduct({ ...base, netWeightOz: '9.50' })
  expect(saved.status, saved.error).toBe(200)
  let reopened = (await call(undefined, '')).workspace
  expect(reopened.products.find((p: Item) => p.id === base.id)).toMatchObject({
    netWeightOz: 9.5,
    netQuantity: base.netQuantity,
  })
  for (const value of [0, -1, 'bad'])
    expect((await saveProduct({ ...base, netWeightOz: value })).status).toBe(
      400,
    )
  expect((await saveProduct({ ...base, netWeightOz: '' })).status).toBe(200)
  reopened = (await call(undefined, '')).workspace
  expect(reopened.products.find((p: Item) => p.id === base.id)).toMatchObject({
    netWeightOz: null,
    netQuantity: base.netQuantity,
  })
  for (const table of ['ingredients', 'recipes', 'batches', 'ledger', 'sales'])
    expect(reopened[table]).toEqual(before[table])
  expect(reopened.settings[0].taxRates).toEqual(before.settings[0].taxRates)
})

// Real public source and real disposable SQL; Identity and photo-object storage remain test adapters.
it.skipIf(!process.env.TEST_OWNER_AMAZON)(
  'imports the exact Amazon page, copies its available image, and saves/reopens package metadata with a manually confirmed price',
  async () => {
    session.user = 'category-owner-a'
    const url =
      'https://www.amazon.com/dp/B0FK3XFMQQ?ref_=ppx_hzsearch_conn_dt_b_fed_asin_title_4'
    const imported = await call({ url }, '?productImport=1')
    expect(imported.status, imported.error).toBe(200)
    const product = imported.products[0]
    expect(product.fields.name).toContain('Bread Bags')
    expect(product.fields.purchaseQuantity).toBe(100)
    const image = await call({ url: product.imageUrl }, '?productImage=1')
    expect(image.status, image.error).toBe(200)
    const price = product.fields.packagePrice ?? 12 // Explicit synthetic manual purchase price when listing price is unavailable.
    const saved = await call(
      {
        action: 'save',
        table: 'ingredients',
        data: {
          ...product.fields,
          id: 'owner-amazon-source-test',
          name: product.fields.name,
          categoryId: 'packaging',
          usedAs: 'packaging',
          unit: 'each',
          purchaseUnit: 'each',
          packagePrice: price,
          purchasePriceConfirmed: true,
          imageAssetId: image.asset.id,
          productSourceUrl: url,
          productCheckedAt: product.checkedAt,
        },
      },
      '',
    )
    expect(saved.status, saved.error).toBe(200)
    const reopened = (await call(undefined, '')).workspace.ingredients.find(
      (i: Item) => i.id === 'owner-amazon-source-test',
    )
    expect(reopened).toMatchObject({
      name: product.fields.name,
      purchaseQuantity: 100,
      purchaseUnit: 'each',
      packagePrice: price,
      imageAssetId: image.asset.id,
    })
    expect(photos.size).toBeGreaterThan(0)
  },
  30000,
)

it('saves and reopens the one-package ingredient setup without changing stock or historical records', async () => {
  session.user = 'category-owner-a'
  await db.query("SELECT set_config('app.business_id',$1,false)", [orgA])
  const ingredient: Item = {
    id: 'unit-sugar',
    name: 'Unit sugar',
    unit: 'g',
    storageUnit: 'oz',
    recipeUnit: 'oz',
    quantity: 500,
    cost: 0.03,
    currentCost: 5.99 / (3.7 * 28.349523125),
    threshold: 0,
    reorderQuantity: 0,
    purchaseQuantity: 3,
    purchaseUnit: 'bottle',
    packagePrice: 17.97,
    currency: 'USD',
    includesTax: false,
    includesShipping: true,
    usedAs: 'ingredient',
    conversions: [
      {
        from: 'bottle',
        to: 'oz',
        amountFrom: 1,
        amountTo: 3.7,
        verified: true,
      },
    ],
  }
  await db.query(
    'INSERT INTO ingredients(id,business_id,data,quantity,cost) VALUES($1,$2,$3,$4,$5)',
    [ingredient.id, orgA, JSON.stringify(ingredient), 500, 0.03],
  )
  const before = (await call(undefined, '')).workspace
  const current = before.ingredients.find((i: Item) => i.id === ingredient.id)
  const saved = await call(
    {
      action: 'ingredientUpdate',
      table: 'ingredients',
      data: {
        ...current,
        expectedUpdatedAt: current.updatedAt,
        purchaseOffers: undefined,
        purchaseSetup: {
          packageUnit: 'bottle',
          price: 17.97 / 3,
          stockUnits: 3.7,
        },
      },
    },
    '',
  )
  expect(saved.status, saved.error).toBe(200)
  const after = (await call(undefined, '')).workspace
  const reopened = after.ingredients.find((i: Item) => i.id === ingredient.id)
  expect(reopened).toMatchObject({
    purchaseQuantity: 3,
    purchaseUnit: 'bottle',
    packagePrice: 17.97,
    unit: 'g',
    storageUnit: 'oz',
    quantity: 500,
    cost: 0.03,
    includesTax: false,
    includesShipping: true,
  })
  expect(reopened.currentCost).toBe(current.currentCost)
  expect(reopened.purchaseSetup).toEqual({
    packageUnit: 'bottle',
    price: 17.97 / 3,
    stockUnits: 3.7,
  })
  for (const key of ['ledger', 'batches', 'recipes', 'purchases', 'journals'])
    expect(after[key]).toEqual(before[key])
  for (const conversion of [
    { from: 'bottle', to: 'oz', amountFrom: 1, amountTo: 4 },
    { from: 'oz', to: 'bottle', amountFrom: 3.7, amountTo: 1 },
    { from: 'g', to: 'kg', amountFrom: 1, amountTo: 1 },
  ]) {
    const rejected = await call(
      {
        action: 'conversion',
        data: {
          ...conversion,
          ingredientId: ingredient.id,
          verified: true,
        },
      },
      '',
    )
    expect(rejected.status).toBe(400)
  }
  const intact = (await call(undefined, '')).workspace
  expect(
    intact.ingredients.find((i: Item) => i.id === ingredient.id).conversions,
  ).toEqual(reopened.conversions)
  expect(intact.ledger).toEqual(after.ledger)
})

it('saves artwork independently per product, reopens selections and removes only artwork', async () => {
  session.user = 'category-owner-a'
  const before = (await call(undefined, '')).workspace
  const product = before.products.find((p: Item) => p.id === 'legacy')
  const assigned = await saveProduct({
    ...product,
    graphicAssetId: 'pantry-art-v1:bananas',
    labelArtworkVersion: 2,
  })
  expect(assigned.status, assigned.error).toBe(200)
  const reopened = (await call(undefined, '')).workspace.products.find(
    (p: Item) => p.id === 'legacy',
  )
  expect(reopened.graphicAssetId).toBe('pantry-art-v1:bananas')
  expect(reopened.imageAssetId).toBe(product.imageAssetId)
  expect(reopened.labelDesignId).toBe(product.labelDesignId)
  const removed = await saveProduct({ ...reopened, graphicAssetId: '' })
  expect(removed.status, removed.error).toBe(200)
  const after = (await call(undefined, '')).workspace
  expect(
    after.products.find((p: Item) => p.id === 'legacy').graphicAssetId,
  ).toBe('')
  expect(after.settings[0].logoAssetId).toBe(before.settings[0].logoAssetId)
  expect(after.label_templates).toEqual(before.label_templates)
  expect(after.graphic_assets).toEqual(before.graphic_assets)
  const invalid = await saveProduct({
    ...reopened,
    graphicAssetId: 'https://example.invalid/untrusted.svg',
  })
  expect(invalid.status).toBe(400)
})

it('links component recipes and consumes prepared stock once, with immutable historical costs and no stock changes on recipe edits', async () => {
  session.user = 'category-owner-a'
  await db.query("SELECT set_config('app.business_id',$1,false)", [orgA])
  const raw: Item = {
    id: 'component-raw',
    name: 'Component sugar',
    quantity: 1000,
    cost: 0.02,
    currentCost: 0.02,
    unit: 'g',
    usedAs: 'ingredient',
    allergens: ['Milk'],
    reviewed: true,
    statement: 'Sugar',
    threshold: 0,
  }
  await db.query(
    'INSERT INTO ingredients(id,business_id,data,quantity,cost) VALUES($1,$2,$3,$4,$5)',
    [raw.id, orgA, JSON.stringify(raw), 1000, 0.02],
  )
  const source: Item = {
    id: 'component-frosting',
    name: 'Test frosting',
    yield: 100,
    yieldUnit: 'g',
    lines: [{ ingredientId: raw.id, quantity: 150, unit: 'g' }],
    laborMinutes: 30,
    laborRate: 10,
    overhead: 2,
  }
  let response = await call(
    { action: 'save', table: 'recipes', data: source },
    '',
  )
  expect(response.status, response.error).toBe(200)
  const before = response.workspace
  const parent: Item = {
    id: 'component-cake',
    name: 'Test cake',
    yield: 1,
    yieldUnit: 'each',
    lines: [
      {
        ingredientId: 'prep-' + source.id,
        componentRecipeId: source.id,
        productionMode: 'prepared_stock',
        quantity: 25,
        unit: 'g',
      },
    ],
    laborMinutes: 0,
    laborRate: 0,
    overhead: 0,
  }
  response = await call({ action: 'save', table: 'recipes', data: parent }, '')
  expect(response.status, response.error).toBe(200)
  expect(
    response.workspace.ingredients.find((i: Item) => i.id === raw.id).quantity,
  ).toBe(1000)
  expect(
    response.workspace.ingredients.find(
      (i: Item) => i.id === 'prep-' + source.id,
    ).quantity,
  ).toBe(0)
  expect(response.workspace.ledger).toEqual(before.ledger)
  const reopened = (await call(undefined, '')).workspace
  expect(
    reopened.recipes.find((r: Item) => r.id === parent.id).lines[0],
  ).toMatchObject({
    componentRecipeId: source.id,
    productionMode: 'prepared_stock',
    quantity: 25,
  })
  expect(
    reopened.ingredients.find((i: Item) => i.id === 'prep-' + source.id)
      .componentAllergens,
  ).toEqual(['Milk'])
  const batch = async (id: string, recipeId: string) => {
    const saved = await call(
      {
        action: 'save',
        table: 'batches',
        data: { id, name: id, recipeId, count: 1, date: '2026-11-07' },
      },
      '',
    )
    expect(saved.status, saved.error).toBe(200)
  }
  await batch('component-parent-run', parent.id)
  response = await call(
    {
      action: 'complete',
      data: { id: 'component-parent-run', actualYield: 1 },
    },
    '',
  )
  expect(response.status).toBe(400)
  expect(response.error).toContain('short')
  await batch('component-source-run', source.id)
  response = await call(
    {
      action: 'complete',
      data: { id: 'component-source-run', actualYield: 100 },
    },
    '',
  )
  expect(response.status, response.error).toBe(200)
  expect(
    response.workspace.ingredients.find((i: Item) => i.id === raw.id).quantity,
  ).toBe(850)
  response = await call(
    {
      action: 'complete',
      data: { id: 'component-parent-run', actualYield: 1 },
    },
    '',
  )
  expect(response.status, response.error).toBe(200)
  expect(
    response.workspace.ingredients.find((i: Item) => i.id === raw.id).quantity,
  ).toBe(850)
  expect(
    response.workspace.ingredients.find(
      (i: Item) => i.id === 'prep-' + source.id,
    ).quantity,
  ).toBe(75)
  const completed = response.workspace.batches.find(
    (b: Item) => b.id === 'component-parent-run',
  )
  expect(completed.historicalCost).toBeCloseTo(2.5, 10)
  expect(completed.usage).toHaveLength(1)
  expect(completed.usage[0].ingredientId).toBe('prep-' + source.id)
  const ledger = structuredClone(response.workspace.ledger)
  await db.query("SELECT set_config('app.business_id',$1,false)", [orgA])
  await db.query(
    'UPDATE ingredients SET data=data || $3::jsonb WHERE business_id=$1 AND id=$2',
    [
      orgA,
      'prep-' + source.id,
      JSON.stringify({
        allergens: ['Egg'],
        reviewed: true,
        statement: 'House frosting',
        threshold: 12,
      }),
    ],
  )
  response = await call(
    {
      action: 'save',
      table: 'recipes',
      data: { ...source, compound: true, laborMinutes: 60 },
    },
    '',
  )
  expect(response.status, response.error).toBe(200)
  expect(
    response.workspace.batches.find((b: Item) => b.id === completed.id),
  ).toEqual(completed)
  expect(
    response.workspace.ingredients.find(
      (i: Item) => i.id === 'prep-' + source.id,
    ).currentCost,
  ).toBeCloseTo(0.15, 12)
  expect(
    response.workspace.ingredients.find(
      (i: Item) => i.id === 'prep-' + source.id,
    ),
  ).toMatchObject({
    allergens: ['Egg'],
    reviewed: true,
    statement: 'House frosting',
    threshold: 12,
    componentAllergens: ['Milk'],
  })
  expect(response.workspace.ledger).toEqual(ledger)
  const cycle = await call(
    {
      action: 'save',
      table: 'recipes',
      data: {
        ...source,
        lines: [
          {
            ingredientId: 'prep-' + parent.id,
            componentRecipeId: parent.id,
            quantity: 1,
            unit: 'each',
          },
        ],
      },
    },
    '',
  )
  expect(cycle.status).toBe(400)
  expect(cycle.error).toContain('itself')
  session.user = 'category-owner-b'
  const foreign = await call(
    { action: 'save', table: 'recipes', data: parent },
    '',
  )
  expect(foreign.status).toBe(400)
  expect(foreign.error).toContain('unavailable')
})
