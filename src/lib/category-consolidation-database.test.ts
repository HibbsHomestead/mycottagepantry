// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
it('migrates JSON assignments per business and is safe to rerun', async () => {
  const db = new PGlite()
  await db.exec(
    `CREATE TABLE businesses(id uuid PRIMARY KEY); CREATE TABLE settings(id text,business_id uuid,data jsonb); CREATE TABLE recipes(id text,business_id uuid,data jsonb); CREATE TABLE ingredients(id text,business_id uuid,data jsonb); CREATE TABLE products(id text,business_id uuid,data jsonb); INSERT INTO businesses VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`,
  )
  const org = '00000000-0000-0000-0000-000000000001'
  const other = '00000000-0000-0000-0000-000000000002'
  const cats = [
    { id: 'a', name: 'Breads' },
    { id: 'b', name: 'Breads & Rolls' },
    { id: 'c', name: 'Fillings' },
    { id: 'd', name: 'Preps & fillings' },
    { id: 'f', name: 'Frostings, Icings & Glazes' },
  ]
  for (const business of [org, other])
    await db.query('INSERT INTO settings VALUES ($1,$2,$3)', [
      'settings',
      business,
      JSON.stringify({
        recipeCategories: cats,
        productCategories: [
          { id: 'cake', name: 'Cakes' },
          { id: 'destination', name: 'Cakes & Cupcakes' },
        ],
      }),
    ])
  for (const [id, data] of [
    ['a', { category: 'Breads', recipeCategoryId: 'a' }],
    ['b', { category: ' FILLINGS ' }],
    ['c', { category: 'Preps & fillings', recipeCategoryId: 'd' }],
    ['null', { recipeCategoryId: 'a' }],
  ] as const)
    await db.query('INSERT INTO recipes VALUES ($1,$2,$3)', [
      id,
      org,
      JSON.stringify(data),
    ])
  await db.query('INSERT INTO products VALUES ($1,$2,$3)', [
    'p',
    org,
    JSON.stringify({
      category: 'Cakes',
      productCategoryId: 'cake',
      price: 12.35,
    }),
  ])
  await db.query('UPDATE settings SET data=$1 WHERE business_id=$2', [
    JSON.stringify({}),
    other,
  ])
  await db.query('INSERT INTO recipes VALUES ($1,$2,$3)', [
    'implicit',
    other,
    JSON.stringify({ category: 'Breads', recipeCategoryId: 'recipe-breads' }),
  ])
  await db.query(`UPDATE settings SET data=jsonb_set(data,'{pantryCategories}',$1::jsonb) WHERE business_id=$2`,[JSON.stringify([{id:'prep-old',name:'Fillings',scope:'food-ingredients'},{id:'prep-dest',name:'Preps, Fillings & Toppings',scope:'food-ingredients'}]),org])
  await db.query('INSERT INTO ingredients VALUES ($1,$2,$3)',['prep',org,JSON.stringify({name:'Prep',category:'Fillings',sectionCategoryId:'prep-old',categoryId:'prep-old',quantity:7,cost:0.34})])
  const sql = readFileSync(
    'netlify/database/migrations/20261215010000_consolidate_food_categories/migration.sql',
    'utf8',
  )
  await db.exec(sql)
  const records = await db.query<any>(
    'SELECT data FROM recipes WHERE business_id=$1 ORDER BY id',
    [org],
  )
  expect(records.rows.map((r) => r.data.category)).toEqual([
    'Breads & Rolls',
    'Preps, Fillings & Toppings',
    'Preps, Fillings & Toppings',
    'Breads & Rolls',
  ])
  expect(records.rows[0].data.recipeCategoryId).toBe('b')
  const product = await db.query<any>('SELECT data FROM products')
  expect(product.rows[0].data).toEqual({
    category: 'Cakes & Cupcakes',
    productCategoryId: 'destination',
    price: 12.35,
  })
  const recovered = await db.query<any>(
    'SELECT data FROM recipes WHERE business_id=$1',
    [other],
  )
  expect(recovered.rows[0].data).toEqual({
    category: 'Breads & Rolls',
    recipeCategoryId: 'recipe-breads%20%26%20rolls',
  })
  const inventory=await db.query<any>('SELECT data FROM ingredients WHERE business_id=$1',[org])
  expect(inventory.rows[0].data).toEqual({name:'Prep',category:'Preps, Fillings & Toppings',sectionCategoryId:'prep-dest',categoryId:'prep-dest',quantity:7,cost:0.34})
  const first = await db.query('SELECT * FROM settings ORDER BY business_id')
  await db.exec(sql)
  expect(await db.query('SELECT * FROM settings ORDER BY business_id')).toEqual(
    first,
  )
  expect(
    (await db.query<any>('SELECT count(*)::int AS n FROM recipes')).rows[0].n,
  ).toBe(5)
  await db.close()
})
