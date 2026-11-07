// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'

const database = new PGlite()
const confirmedOwner = '8a87b82e-1393-4c4d-9885-62f946204b6e'
const bootstrapName = '20261111010000_bootstrap_confirmed_platform_owner'
let bootstrapSql: string

beforeAll(async () => {
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root)) {
    const sql = await readFile(new URL(name + '/migration.sql', root), 'utf8')
    if (name === bootstrapName) bootstrapSql = sql
    else await database.exec(sql)
  }
}, 30000)
beforeEach(async () => {
  await database.exec(
    'TRUNCATE platform_sessions,platform_credentials,platform_admins,platform_audit CASCADE',
  )
})
afterAll(() => database.close())

it('grants only the explicitly confirmed owner, requires MFA, and records safe audit metadata', async () => {
  const before = (
    await database.query('SELECT COUNT(*) AS count FROM businesses')
  ).rows
  await database.exec(bootstrapSql)
  const grants = (
    await database.query<{
      identity_id: string
      role: string
      enabled: boolean
      remaining: number
    }>(`SELECT identity_id,role,enabled,
        EXTRACT(EPOCH FROM enrollment_until-NOW())::integer AS remaining
        FROM platform_admins`)
  ).rows
  expect(grants).toHaveLength(1)
  expect(grants[0]).toMatchObject({
    identity_id: confirmedOwner,
    role: 'owner',
    enabled: true,
  })
  expect(grants[0].remaining).toBeGreaterThan(86300)
  expect(grants[0].remaining).toBeLessThanOrEqual(86400)
  expect(
    (await database.query('SELECT * FROM platform_sessions')).rows,
  ).toEqual([])
  expect(
    (await database.query('SELECT * FROM platform_credentials')).rows,
  ).toEqual([])
  const audit = (
    await database.query(
      'SELECT action,target,outcome,before,after FROM platform_audit',
    )
  ).rows
  expect(audit).toEqual([
    {
      action: 'owner_bootstrap',
      target: confirmedOwner,
      outcome: 'success',
      before: { platformAccess: false },
      after: { role: 'owner', enrollmentHours: 24, mfaRequired: true },
    },
  ])
  expect(
    (await database.query('SELECT COUNT(*) AS count FROM businesses')).rows,
  ).toEqual(before)
})

it('does not extend an enrollment window or duplicate audit when replayed', async () => {
  await database.exec(bootstrapSql)
  await database.query(
    "UPDATE platform_admins SET enrollment_until=NOW()-INTERVAL '1 day'",
  )
  const original = (await database.query('SELECT * FROM platform_admins')).rows
  await database.exec(bootstrapSql)
  expect((await database.query('SELECT * FROM platform_admins')).rows).toEqual(
    original,
  )
  expect(
    (await database.query('SELECT * FROM platform_audit')).rows,
  ).toHaveLength(1)
})

it('preserves an existing administrator instead of adding or replacing an owner', async () => {
  await database.query(
    "INSERT INTO platform_admins(identity_id,role,granted_by,reason) VALUES('existing-admin','admin','trusted-operator','Existing decision')",
  )
  await database.exec(bootstrapSql)
  expect(
    (await database.query('SELECT identity_id FROM platform_admins')).rows,
  ).toEqual([{ identity_id: 'existing-admin' }])
  expect((await database.query('SELECT * FROM platform_audit')).rows).toEqual(
    [],
  )
})

it('never restores a disabled grant', async () => {
  await database.query(
    "INSERT INTO platform_admins(identity_id,role,enabled,granted_by,reason) VALUES($1,'owner',false,'trusted-operator','Previously revoked')",
    [confirmedOwner],
  )
  await database.exec(bootstrapSql)
  expect(
    (
      await database.query(
        'SELECT enabled,enrollment_until FROM platform_admins',
      )
    ).rows,
  ).toEqual([{ enabled: false, enrollment_until: null }])
  expect((await database.query('SELECT * FROM platform_audit')).rows).toEqual(
    [],
  )
})
