// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { Context } from '@netlify/functions'
import { applicableTaxes, calculateTax, saleTaxReviewKey, type Item } from './domain'
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
  if (body.operation === 'saveCategory') body = {...body, category:{scope:'food-products', ...(body.category as object)}}
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

it('archives categories while preserving assigned records with confirmation, retains records and mappings, and isolates archive requests by Oven', async () => {
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
  ).toBe(200)
  await category({...archive,categoryId:foodId,active:true,confirm:true})
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
    compound: true,
    yield: 100,
    yieldUnit: 'g',
    lines: [{ ingredientId: raw.id, quantity: 150, unit: 'g' }],
    laborMinutes: 30,
    laborRate: 10,
    overhead: 2,
  }
  const regular = await call(
    { action: 'save', table: 'recipes', data: { ...source, compound: false } },
    '',
  )
  expect(regular.status, regular.error).toBe(200)
  expect(regular.workspace.ingredients.some((i: Item) => i.compoundRecipeId === source.id)).toBe(false)
  const premature = await call({ action: 'save', table: 'recipes', data: {
    id: 'premature-link', name: 'Premature link', yield: 1, yieldUnit: 'each',
    lines: [{ ingredientId: `prep-${source.id}`, componentRecipeId: source.id, quantity: 25, unit: 'g' }],
  } }, '')
  expect(premature.error).toMatch(/Set Test frosting to Compound prep/)
  let response = await call(
    { action: 'save', table: 'recipes', data: source },
    '',
  )
  expect(response.status, response.error).toBe(200)
  const before = response.workspace
  expect(before.ledger).toEqual(regular.workspace.ledger)
  expect(before.recipes.find((r: Item) => r.id === source.id)).toMatchObject({
    compound: true, yield: source.yield, yieldUnit: source.yieldUnit, lines: source.lines,
  })
  const blockedDemotion = await call(
    { action: 'save', table: 'recipes', data: { ...source, compound: false } },
    '',
  )
  expect(blockedDemotion.error).toMatch(/preserve its production link/)
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

it('scopes product categories, retains tax treatment on archive, and rejects cross-section assignments', async () => {
  session.user='category-owner-a'
  const food = await category({operation:'saveCategory',category:{name:'Scope test',scope:'food-products',classification:'food',description:'Food items',displayOrder:2}})
  const handmade = await category({operation:'saveCategory',category:{name:'Scope test',scope:'handmade-products',classification:'non_food'}})
  expect(food.status,food.error).toBe(200)
  expect(handmade.status,handmade.error).toBe(200)
  const wrong=await saveProduct({id:'scope-mismatch',name:'Food with craft category',recipeId:'recipe',productCategoryId:handmade.selectedId,price:8,unpacked:true,unitsPerPackage:1})
  expect(wrong.status).toBe(400)
  expect(wrong.error).toMatch(/this section/)
  const saved=await saveProduct({id:'scope-food',name:'Food with own category',recipeId:'recipe',productCategoryId:food.selectedId,price:8,unpacked:true,unitsPerPackage:1})
  expect(saved.status,saved.error).toBe(200)
  const before=saved.workspace
  const product=before.products.find((p:Item)=>p.id==='scope-food')
  const taxes=applicableTaxes(product,before.settings[0])
  expect((await category({operation:'setCategoryActive',categoryId:food.selectedId,active:false,confirm:true})).status).toBe(200)
  const after=(await call(undefined,'')).workspace
  expect(after.products).toEqual(before.products)
  expect(applicableTaxes(product,after.settings[0])).toEqual(taxes)
  expect(after.ledger).toEqual(before.ledger)
})

it('persists pantry category metadata, parents and ordering in tenant-scoped settings without changing stock', async () => {
  session.user='category-owner-a'
  async function pantry(body?: Record<string, unknown>) {
    const current=await call(undefined,'?pantryCategories=1')
    return body ? call({...body,expectedRevision:current.revision},'?pantryCategories=1') : current
  }
  const before=(await call(undefined,'')).workspace
  const food=await pantry({operation:'saveCategory',category:{name:'Market supplies',scope:'food-ingredients',description:'Food preparation supplies',displayOrder:4}})
  expect(food.status,food.error).toBe(200)
  const parent=food.selectedId
  const packaging=await pantry({operation:'saveCategory',category:{name:'Market supplies',scope:'packaging',description:'Boxes and bags'}})
  expect(packaging.status,packaging.error).toBe(200)
  const craft=await pantry({operation:'saveCategory',category:{name:'Market supplies',scope:'handmade-materials'}})
  expect(craft.status,craft.error).toBe(200)
  const child=await pantry({operation:'saveCategory',category:{name:'Liners',scope:'packaging',parentId:packaging.selectedId,description:'Paper liners',displayOrder:1}})
  expect(child.status,child.error).toBe(200)
  const duplicate=await pantry({operation:'saveCategory',category:{name:'  MARKET   supplies ',scope:'packaging'}})
  expect(duplicate.status).toBe(400)
  expect(duplicate.error).toMatch(/already exists/)
  const crossParent=await pantry({operation:'saveCategory',category:{name:'Invalid child',scope:'packaging',parentId:parent}})
  expect(crossParent.status).toBe(400)
  const cycle=await pantry({operation:'saveCategory',category:{id:packaging.selectedId,name:'Market supplies',scope:'packaging',parentId:child.selectedId}})
  expect(cycle.status).toBe(400)
  const material=await call({action:'handmadeMaterialSave',table:'ingredients',data:{id:'scoped-material',name:'Cotton cord',unit:'each',sectionCategoryId:craft.selectedId,threshold:0}},'')
  expect(material.status,material.error).toBe(200)
  const wrong=await call({action:'handmadeMaterialSave',table:'ingredients',data:{id:'wrong-material',name:'Wrong category',unit:'each',sectionCategoryId:packaging.selectedId,threshold:0}},'')
  expect(wrong.status).toBe(400)
  expect((await pantry({operation:'setCategoryActive',categoryId:craft.selectedId,active:false})).status).toBe(200)
  const saved=(await call(undefined,'')).workspace
  expect(saved.ingredients.find((i:Item)=>i.id==='scoped-material').sectionCategoryId).toBe(craft.selectedId)
  expect(saved.ingredients.find((i:Item)=>i.id==='scoped-material').quantity).toBe(0)
  expect(saved.ingredients.find((i:Item)=>i.id==='flour')).toEqual(before.ingredients.find((i:Item)=>i.id==='flour'))
  expect(saved.ledger).toEqual(before.ledger)
  expect(saved.products).toEqual(before.products)
  expect(saved.settings[0].taxRates).toEqual(before.settings[0].taxRates)
  session.user='category-owner-b'
  expect((await pantry()).categories.some((c:Item)=>c.id===craft.selectedId)).toBe(false)
  expect((await pantry({operation:'setCategoryActive',categoryId:craft.selectedId,active:true})).status).toBe(400)
  session.user='category-staff'
  expect((await pantry({operation:'saveCategory',category:{name:'Forbidden',scope:'packaging'}})).status).toBe(400)
  session.user='category-owner-a'
})

it('leaves saved rate collections and legacy absence unchanged on a business no-op save', async () => {
  const before=(await call(undefined,'')).workspace
  const rates=structuredClone(before.settings[0].taxRates)
  const result=await call({action:'save',table:'settings',data:before.settings[0]},'')
  expect(result.status,result.error).toBe(200)
  expect(result.workspace.settings[0].taxRates).toEqual(rates)
  expect(result.workspace.sales).toEqual(before.sales)
  expect(result.workspace.settings[0].productCategories).toEqual(before.settings[0].productCategories)
})

it('saves, edits and reopens classification rules with tenant validation and unchanged historical transactions', async () => {
  session.user = 'category-owner-a'
  const configured = await category({ operation: 'saveCategory', category: { name: 'Tax classification fixture', classification: 'non_food' } })
  expect(configured.status, configured.error).toBe(200)
  const before = (await call(undefined, '')).workspace
  const originalRates = structuredClone(before.settings[0].taxRates)
  const classificationRate = { ...rate, id: 'classification-roundtrip', appliesTo: 'classification', classification: 'non_food', ratePercent: 7 }
  const saveRates = async (taxRates: unknown[], extra = {}) => call({ action: 'save', table: 'settings', data: { ...before.settings[0], taxRates, ...extra } }, '')
  try {
    const saved = await saveRates([...originalRates, classificationRate])
    expect(saved.status, saved.error).toBe(200)
    const reopened = (await call(undefined, '')).workspace
    expect(reopened.settings[0].taxRates.find((r: Item) => r.id === classificationRate.id)).toEqual(classificationRate)
    const handmade = { id: 'isolated-handmade', name: 'Bag', productType: 'handmade', productCategoryId: configured.selectedId, taxSource: 'category' }
    expect(applicableTaxes(handmade, reopened.settings[0]).some(r => r.id === classificationRate.id)).toBe(true)
    const edited = { ...classificationRate, classification: 'food', ratePercent: 9 }
    const edit = await saveRates([...originalRates, edited])
    expect(edit.status, edit.error).toBe(200)
    const after = (await call(undefined, '')).workspace
    expect(after.settings[0].taxRates.find((r: Item) => r.id === edited.id)).toEqual(edited)
    expect(after.sales).toEqual(before.sales)
    expect(after.products).toEqual(before.products)
    const invalid = await saveRates([...originalRates, { ...classificationRate, classification: 'foreign-business-classification' }])
    expect(invalid.status).toBe(400)
    expect(invalid.error).toMatch(/classification from this business/)
    // Supplying category data cannot manufacture a target: settings save preserves server-owned categories.
    session.user = 'category-owner-b'
    const foreign = await call({ action: 'save', table: 'settings', data: { ...before.settings[0], taxRates: [{ ...classificationRate, classification: configured.selectedId }] } }, '')
    expect(foreign.status).toBe(400)
    const absent = await call({ action: 'save', table: 'settings', data: { ...before.settings[0], taxRates: [classificationRate] } }, '')
    expect(absent.status).toBe(400)
    expect(absent.error).toMatch(/classification from this business/)
    session.user = 'category-staff'
    expect((await saveRates([...originalRates, classificationRate])).status).toBe(400)
  } finally {
    session.user = 'category-owner-a'
    const restored = await saveRates(originalRates)
    expect(restored.status, restored.error).toBe(200)
  }
})

it('saves and reloads an existing unscoped product category without rewriting its definition', async () => {
  session.user = 'category-owner-a'
  const before = (await call()).categories
  const saved = await saveProduct({
    id: 'legacy-category-save', name: 'Legacy category regression',
    recipeId: 'recipe', productCategoryId: 'unclassified',
    price: 8, unpacked: true, unitsPerPackage: 1,
  })
  expect(saved.status, saved.error).toBe(200)
  const reopened = await call(undefined, '')
  expect(reopened.workspace.products.find((p: Item) => p.id === 'legacy-category-save').productCategoryId).toBe('unclassified')
  expect((await call()).categories).toEqual(before)
})

it('saves optional purchase minimums separately from stock alerts and preserves tenant stock/ledger data', async () => {
  session.user = 'category-owner-a'
  const before = (await call(undefined, '')).workspace
  const current = before.ingredients.find((i: Item) => i.id === 'flour')
  const purchaseUnit = current.purchaseUnit || 'g'
  const data = { ...current, purchaseUnit, minimumOrderQuantity: 2, minimumOrderUnit: purchaseUnit, storageUnit: current.storageUnit || current.unit, threshold: current.threshold || 0, reorderQuantity: current.reorderQuantity || 0, expectedUpdatedAt: current.updatedAt }
  const result = await call({ action:'ingredientUpdate', table:'ingredients', data }, '')
  expect(result.status, result.error).toBe(200)
  const reopened = (await call(undefined, '')).workspace
  expect(reopened.ingredients.find((i: Item) => i.id === 'flour')).toMatchObject({ minimumOrderQuantity: 2, minimumOrderUnit: purchaseUnit, threshold:current.threshold || 0, quantity:current.quantity, cost:current.cost })
  expect(reopened.ledger).toEqual(before.ledger)
  session.user = 'category-owner-b'
  const other = (await call(undefined, '')).workspace.ingredients.find((i: Item) => i.id === 'flour')
  expect(other.minimumOrderQuantity).toBeUndefined()
  session.user = 'category-owner-a'
  const saved = reopened.ingredients.find((i: Item) => i.id === 'flour')
  const invalid = await call({action:'ingredientUpdate',table:'ingredients',data:{...data,expectedUpdatedAt:saved.updatedAt,minimumOrderQuantity:0}}, '')
  expect(invalid.status).not.toBe(200)
  expect(invalid.error).toMatch(/positive/)
})

it('keeps default changes prospective and requires a current, tenant scoped bulk review before updating prices', async () => {
  const org = '00000000-0000-4000-8000-000000000019'
  const owner = 'price-tax-owner'
  await db.exec('RESET ROLE')
  try {
    await db.query('INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3)', [org, 'Price test', owner])
    await db.query('INSERT INTO users(id,business_id,data,identity_id,role) VALUES($1,$2,$3,$4,$5)', ['owner', org, '{}', owner, 'Owner'])
    await db.query('INSERT INTO settings(id,business_id,data) VALUES($1,$2,$3)', ['business', org, JSON.stringify({ id: 'business', name: 'Price test', taxRates: [rate] })])
    for (const p of [
      { id: 'inherit', name: 'Inherited food', workflow: 'food', priceTaxMode: 'inherit', price: 100, wholesale: 40 },
      { id: 'override', name: 'Resale override', workflow: 'resale', priceTaxMode: 'before', price: 50 },
      { id: 'kit', name: 'Exempt kit', workflow: 'kit', taxStatus: 'exempt', price: 50 },
      { id: 'handmade', name: 'Legacy handmade', workflow: 'handmade', price: 50 },
    ]) await db.query('INSERT INTO products(id,business_id,data) VALUES($1,$2,$3)', [p.id, org, JSON.stringify(p)])
    await db.query('INSERT INTO sales(id,business_id,product_id,data) VALUES($1,$2,$3,$4)', ['historical-square', org, 'inherit', JSON.stringify({ id: 'historical-square', name: 'Recorded Square sale', amount: 100, tax: 5, customerTotal: 105, externalSource: 'square', priceTaxMode: 'before' })])
    await db.query('INSERT INTO orders(id,business_id,data) VALUES($1,$2,$3)', ['open-po', org, JSON.stringify({ id: 'open-po', name: 'Open vendor order', status: 'ordered', amount: 27 })])
  } finally {
    await db.exec('SET ROLE category_app')
  }
  const request = (action: string, data: Record<string, unknown>) => call({ action, table: 'settings', data }, '')
  const find = (w: Record<string, Item[]>, id: string) => w.products.find((p) => p.id === id)!
  session.user = owner
  try {
    const before = (await call(undefined, '')).workspace
    const historical = calculateTax(100, applicableTaxes(find(before, 'inherit'), before.settings[0]))
    const saved = await request('priceTaxDefault', { expected: 'before', mode: 'includes' })
    expect(saved.status, saved.error).toBe(200)
    const w = saved.workspace
    expect(w.settings[0].defaultPriceTaxMode).toBe('includes')
    expect(find(w, 'inherit')).toMatchObject({ price: 100, wholesale: 40, priceTaxMode: 'saved-before' })
    expect(calculateTax(100, applicableTaxes(find(w, 'inherit'), w.settings[0]))).toEqual(historical)
    const staleEditor = await saveProduct(find(before, 'inherit'))
    expect(staleEditor.status).not.toBe(200)
    expect(staleEditor.error).toMatch(/price tax treatment changed/)

    const choices = { strategy: 'total', includeOverrides: false }
    const preview = await request('priceTaxPreview', choices)
    expect(preview.status, preview.error).toBe(200)
    expect(preview.plan).toMatchObject({ counts: { Food: 1, Handmade: 1, Resale: 0, Kits: 1 }, overrides: 1, overridesReplaced: 0, failures: 0 })
    expect(preview.plan.rows.find((r: Item) => r.id === 'inherit').prices).toEqual([
      expect.objectContaining({ field: 'price', before: expect.objectContaining({ price: 100, tax: 5, total: 105 }), after: expect.objectContaining({ price: 105, tax: 5, total: 105 }) }),
      expect.objectContaining({ field: 'wholesale', before: expect.objectContaining({ price: 40, total: 42 }), after: expect.objectContaining({ price: 42, total: 42 }) }),
    ])
    expect(preview.plan.rows.find((r: Item) => r.id === 'kit').prices[0].after.tax).toBe(0)
    expect((await request('priceTaxPreview', { ...choices, includeOverrides: true })).plan.overridesReplaced).toBe(1)
    session.user = 'category-owner-b'
    expect((await request('priceTaxApply', { ...choices, review: preview.review })).status).not.toBe(200)
    session.user = owner
    const liveClient = session.client!
    session.client = { ...liveClient, query: (sql, params) => {
      if (sql.startsWith('INSERT INTO activity'))
        return Promise.reject(new Error('Fixture interrupted the audit after updating products'))
      return liveClient.query(sql, params)
    } }
    try {
      const interrupted = await request('priceTaxApply', { ...choices, review: preview.review })
      expect(interrupted.status).not.toBe(200)
      expect(interrupted.error).toMatch(/0 products updated/)
    } finally {
      session.client = liveClient
    }
    const rolledBack = (await call(undefined, '')).workspace
    expect(rolledBack.products).toEqual(w.products)
    expect(rolledBack.activity).toEqual(w.activity)
    const applied = await request('priceTaxApply', { ...choices, review: preview.review })
    expect(applied.status, applied.error).toBe(200)
    expect(applied.priceTaxResult).toEqual({ updated: 3, failed: 0 })
    expect(find(applied.workspace, 'inherit')).toMatchObject({ price: 105, wholesale: 42, priceTaxMode: 'inherit' })
    expect(find(applied.workspace, 'override').priceTaxMode).toBe('before')
    expect(applied.workspace.sales).toEqual(before.sales)
    expect(applied.workspace.orders).toEqual(before.orders)
    expect(applied.workspace.journals).toEqual(before.journals)
    expect(applied.workspace.activity.find((a: Item) => a.type === 'priceTaxApply').details.changes).toHaveLength(3)
    expect((await request('priceTaxApply', { ...choices, review: preview.review })).status).not.toBe(200)
    const reviewedSale = await call({ action: 'simpleSale', table: 'sales', data: {
      date: '2026-11-23', saleLines: [{ productId: 'inherit', quantity: 1, amount: 100, reviewedTax: saleTaxReviewKey(historical) }],
    } }, '')
    expect(reviewedSale.status).not.toBe(200)
    expect(reviewedSale.error).toMatch(/after this sale was reviewed/)
    expect((await call(undefined, '')).workspace.sales).toEqual(before.sales)
  } finally {
    session.user = 'category-owner-a'
  }
})
