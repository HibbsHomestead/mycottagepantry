// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { handleGroceryList } from '../../netlify/lib/grocery-list-handler'
import type { GroceryList } from './grocery-list'

it('persists tenant-scoped snapshots and last-write checks without writing production, purchasing, or stock', async () => {
  const db = new PGlite()
  try {
    const org = randomUUID()
    const foreignOrg = randomUUID()
    await db.exec('CREATE TABLE businesses(id uuid PRIMARY KEY);')
    await db.query('INSERT INTO businesses VALUES ($1), ($2)', [
      org,
      foreignOrg,
    ])
    const sourceTables = [
      'ingredients',
      'recipes',
      'products',
      'batches',
      'vendors',
      'events',
      'event_batch_links',
      'ledger',
      'orders',
      'journals',
      'receipts',
    ]
    for (const table of sourceTables) {
      await db.exec(
        `CREATE TABLE ${table}(id text, business_id uuid, data jsonb, created_at timestamp DEFAULT now());`,
      )
    }
    const ingredient = {
      id: 'apples',
      name: 'Apples',
      unit: 'g',
      quantity: 40,
      cost: 0.01,
    }
    const recipe = {
      id: 'pie',
      name: 'Pie',
      yield: 1,
      yieldUnit: 'each',
      lines: [{ ingredientId: 'apples', unit: 'g', quantity: 150 }],
    }
    const run = {
      id: 'run',
      name: 'Pie bake',
      status: 'scheduled',
      recipeId: 'pie',
      count: 2,
    }
    const completed = { ...run, id: 'completed', status: 'completed' }
    for (const [table, items] of [
      ['ingredients', [ingredient]],
      ['recipes', [recipe]],
      ['batches', [run, completed]],
    ] as const) {
      for (const item of items)
        await db.query(
          `INSERT INTO ${table} (id,business_id,data) VALUES ($1,$2,$3)`,
          [item.id, org, JSON.stringify(item)],
        )
    }
    const migration = new URL(
      '../../netlify/database/migrations/20261222010000_add_grocery_lists/migration.sql',
      import.meta.url,
    )
    await db.exec(await readFile(migration, 'utf8'))
    await db.exec(
      `CREATE ROLE grocery_fixture; GRANT SELECT ON ${sourceTables.join(', ')} TO grocery_fixture; GRANT SELECT, UPDATE ON businesses TO grocery_fixture; GRANT SELECT, INSERT, UPDATE ON grocery_lists TO grocery_fixture; SET ROLE grocery_fixture;`,
    )
    await db.query("SELECT set_config('app.business_id',$1,false)", [org])
    const listId = randomUUID()
    const sources = {
      runs: ['run'],
      events: [],
      recipes: [],
      from: '',
      to: '',
    }
    const address = 'http://grocery.test/api/workspace?groceryList=1'
    const post = (input: object, role = 'Owner') =>
      handleGroceryList(
        new Request(address, {
          method: 'POST',
          body: JSON.stringify({ id: listId, ...input }),
        }),
        db,
        org,
        'fixture',
        role,
      )
    const read = () =>
      handleGroceryList(
        new Request(`${address}&list=${listId}`),
        db,
        org,
        'fixture',
        'Owner',
      )
    expect(
      (await post({ action: 'generate', sources }, 'Read-only Accountant'))
        .status,
    ).toBe(403)
    const response = await post({ action: 'generate', sources })
    expect(response.status).toBe(201)
    const { list }: { list: GroceryList } = await response.json()
    expect(list.lines[0]).toMatchObject({
      name: 'Apples',
      needed: 300,
      onHand: 40,
      toBuy: 260,
    })
    expect((await post({ action: 'generate', sources })).status).toBe(200)
    const checked = {
      row: list.lines[0].id,
      checked: true,
      at: 1000,
      token: randomUUID(),
    }
    const unchecked = {
      ...checked,
      checked: false,
      at: 1001,
      token: randomUUID(),
    }
    await post({ action: 'marks', marks: [unchecked] }, 'Production Staff')
    await post({
      action: 'marks',
      marks: [checked, { ...checked, row: 'missing row' }],
    })
    const item = randomUUID()
    await post({
      action: 'manual',
      item,
      name: 'Parchment',
      amount: 1,
      unit: 'roll',
      vendor: '',
      notes: '',
    })
    await post({
      action: 'manual',
      item,
      name: 'Parchment',
      amount: 1,
      unit: 'roll',
      vendor: '',
      notes: '',
    })
    await post({ action: 'quantity', row: list.lines[0].id, amount: 400 })
    const saved = (await (await read()).json()).list
    expect(saved.lines).toEqual(list.lines)
    expect(saved.marks).toEqual({ [checked.row]: unchecked })
    expect(saved.manual).toHaveLength(1)
    expect(saved.overrides).toEqual({ [checked.row]: 400 })
    expect((await db.query('SELECT data FROM ingredients')).rows).toEqual([
      { data: ingredient },
    ])
    expect((await db.query('SELECT data FROM recipes')).rows).toEqual([
      { data: recipe },
    ])
    expect(
      (await db.query('SELECT data FROM batches ORDER BY id')).rows,
    ).toEqual([{ data: completed }, { data: run }])
    for (const table of ['ledger', 'orders', 'journals', 'receipts'])
      expect((await db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0)
    await db.query("SELECT set_config('app.business_id',$1,false)", [
      foreignOrg,
    ])
    expect((await db.query('SELECT * FROM grocery_lists')).rows).toHaveLength(0)
    expect(
      (
        await handleGroceryList(
          new Request(`${address}&list=${listId}`),
          db,
          foreignOrg,
          'foreign',
          'Owner',
        )
      ).status,
    ).toBe(404)
  } finally {
    await db.close()
  }
})
