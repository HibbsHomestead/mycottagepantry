// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'

const db = new PGlite()
const legacy = '00000000-0000-4000-8000-000000000091'
const kitchen = '00000000-0000-4000-8000-000000000092'
const mercantile = '00000000-0000-4000-8000-000000000093'
beforeAll(async () => {
  await db.exec(`CREATE TABLE workspace_billing(business_id uuid PRIMARY KEY,plan_id text,source text,status text,environment text,paid_through timestamptz);
    CREATE TABLE users(id text,business_id uuid,identity_id text,active boolean NOT NULL DEFAULT true,role text,PRIMARY KEY(business_id,id));`)
  await db.query(
    "INSERT INTO workspace_billing VALUES($1,'cottage-kitchen','square_sandbox','paid_active','sandbox','2099-01-01')",
    [legacy],
  )
  for (const id of ['owner', 'member', 'third'])
    await db.query(
      "INSERT INTO users(id,business_id,identity_id,role) VALUES($1,$2,$1,'Owner')",
      [id, legacy],
    )
  await db.exec(
    await readFile(
      new URL(
        '../../netlify/database/migrations/20261118010000_add_versioned_plan_policy/migration.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  for (const [business, plan] of [
    [kitchen, 'cottage-kitchen'],
    [mercantile, 'cottage-mercantile'],
  ]) {
    await db.query(
      "INSERT INTO workspace_billing(business_id,plan_id,source,status,environment,paid_through) VALUES($1,$2,'square_sandbox','paid_active','sandbox','2099-01-01')",
      [business, plan],
    )
    await db.query(
      "INSERT INTO users(id,business_id,identity_id,role) VALUES('owner',$1,'owner','Owner')",
      [business],
    )
  }
}, 15000)
afterAll(async () => {
  await db.close()
})

it('preserves existing legacy records and memberships without silently migrating them', async () => {
  expect(
    (
      await db.query<{ entitlement_policy: string }>(
        'SELECT entitlement_policy FROM workspace_billing WHERE business_id=$1',
        [legacy],
      )
    ).rows[0].entitlement_policy,
  ).toBe('legacy')
  expect(
    (await db.query('SELECT id FROM users WHERE business_id=$1', [legacy]))
      .rows,
  ).toHaveLength(3)
  await db.query(
    "INSERT INTO users(id,business_id,identity_id) VALUES('fourth',$1,'fourth')",
    [legacy],
  )
  expect(
    (await db.query('SELECT id FROM users WHERE business_id=$1', [legacy]))
      .rows,
  ).toHaveLength(4)
})

it('counts the owner and rejects a third active Kitchen login through every database writer', async () => {
  await db.query(
    "INSERT INTO users(id,business_id,identity_id) VALUES('second',$1,'second')",
    [kitchen],
  )
  await expect(
    db.query(
      "INSERT INTO users(id,business_id,identity_id) VALUES('third',$1,'third')",
      [kitchen],
    ),
  ).rejects.toThrow(/2 total business users, including the owner/)
  await db.query(
    "INSERT INTO users(id,business_id,identity_id,active) VALUES('inactive',$1,'inactive',false)",
    [kitchen],
  )
  await expect(
    db.query(
      "UPDATE users SET active=true WHERE business_id=$1 AND id='inactive'",
      [kitchen],
    ),
  ).rejects.toThrow(/2 total/)
  expect(
    (
      await db.query(
        'SELECT id FROM users WHERE business_id=$1 AND active=true',
        [kitchen],
      )
    ).rows,
  ).toHaveLength(2)
})

it('does not invent a Mercantile cap and blocks new members while it is undecided', async () => {
  await expect(
    db.query(
      "INSERT INTO users(id,business_id,identity_id) VALUES('second',$1,'second')",
      [mercantile],
    ),
  ).rejects.toThrow(/awaits confirmation/)
  expect(
    (await db.query('SELECT id FROM users WHERE business_id=$1', [mercantile]))
      .rows,
  ).toHaveLength(1)
})

it('keeps existing members after a lapse while rejecting further activation', async () => {
  await db.query(
    "UPDATE workspace_billing SET paid_through='2020-01-01' WHERE business_id=$1",
    [kitchen],
  )
  await db.query(
    "UPDATE users SET role='Production Staff' WHERE business_id=$1 AND id='second'",
    [kitchen],
  )
  expect(
    (
      await db.query(
        'SELECT id FROM users WHERE business_id=$1 AND active=true',
        [kitchen],
      )
    ).rows,
  ).toHaveLength(2)
  await expect(
    db.query(
      "UPDATE users SET active=true WHERE business_id=$1 AND id='inactive'",
      [kitchen],
    ),
  ).rejects.toThrow(/1 total/)
})
