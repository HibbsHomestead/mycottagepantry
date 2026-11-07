// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import { expect, it } from 'vitest'
import { workspaceSeed } from '../../netlify/lib/workspace-seed'

it('starts the requested account empty while keeping anonymous samples', () => {
  const empty = workspaceSeed('CONTACT@HIBBSHOMESTEAD.COM')
  expect(empty.ingredients).toEqual([])
  expect(empty.sales).toEqual([])
  expect(empty.settings[0].address).toBe('')
  expect(workspaceSeed().ingredients.length).toBeGreaterThan(0)
  expect(workspaceSeed('another@example.com').recipes.length).toBeGreaterThan(0)
})

it('resets only the requested owner and restores immutable history protections', async () => {
  const db = new PGlite()
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  const reset = '20261105010000_reset_hibbs_demo'
  const target = '00000000-0000-4000-8000-000000000001'
  const other = '00000000-0000-4000-8000-000000000002'
  try {
    // Apply SQL only to this disposable test database, never a deployed branch.
    for (const name of await fixtureMigrationNames(root)) {
      if (name === reset) continue
      await db.exec(
        await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
      )
    }
    for (const [id, owner, email] of [
      [target, 'target-owner', 'contact@hibbshomestead.com'],
      [other, 'other-owner', 'other@example.com'],
    ]) {
      await db.query(
        'INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3)',
        [id, 'Sample business', owner],
      )
      await db.query(
        'INSERT INTO users(id,business_id,identity_id,role,data) VALUES($1,$2,$3,$4,$5)',
        [owner, id, owner, 'Owner', JSON.stringify({ name: email })],
      )
      await db.query(
        'INSERT INTO ingredients(id,business_id,data) VALUES($1,$2,$3)',
        ['flour', id, '{}'],
      )
      await db.query(
        'INSERT INTO ledger(id,business_id,data,ingredient_id) VALUES($1,$2,$3,$4)',
        ['opening', id, '{}', 'flour'],
      )
      await db.query(
        'INSERT INTO recipes(id,business_id,data) VALUES($1,$2,$3)',
        ['bread', id, '{}'],
      )
      await db.query(
        'INSERT INTO batches(id,business_id,data,recipe_id) VALUES($1,$2,$3,$4)',
        ['batch', id, '{"status":"completed"}', 'bread'],
      )
    }
    await db.exec(
      await readFile(new URL(`${reset}/migration.sql`, root), 'utf8'),
    )
    expect(
      (
        await db.query('SELECT * FROM ingredients WHERE business_id=$1', [
          target,
        ])
      ).rows,
    ).toHaveLength(0)
    expect(
      (await db.query('SELECT * FROM ledger WHERE business_id=$1', [target]))
        .rows,
    ).toHaveLength(0)
    expect(
      (await db.query('SELECT * FROM batches WHERE business_id=$1', [target]))
        .rows,
    ).toHaveLength(0)
    expect(
      (await db.query('SELECT * FROM users WHERE business_id=$1', [target]))
        .rows,
    ).toHaveLength(1)
    expect(
      (
        await db.query('SELECT data FROM settings WHERE business_id=$1', [
          target,
        ])
      ).rows,
    ).toEqual([
      { data: workspaceSeed('contact@hibbshomestead.com').settings[0] },
    ])
    expect(
      (
        await db.query('SELECT * FROM ingredients WHERE business_id=$1', [
          other,
        ])
      ).rows,
    ).toHaveLength(1)
    await expect(
      db.query('DELETE FROM ledger WHERE business_id=$1', [other]),
    ).rejects.toThrow('Inventory history is immutable')
    await expect(
      db.query('DELETE FROM batches WHERE business_id=$1', [other]),
    ).rejects.toThrow('Completed batches are immutable')
  } finally {
    await db.close()
  }
}, 30000)
