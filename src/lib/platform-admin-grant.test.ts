// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'

const database = new PGlite()
const identity = 'd62a6cbd-124a-4766-9e82-22cb062ea09a'
const grantName = '20261112010000_grant_confirmed_platform_admin'
let grantSql: string

beforeAll(async () => {
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root)) {
    const sql = await readFile(new URL(name + '/migration.sql', root), 'utf8')
    if (name === grantName) grantSql = sql
    else await database.exec(sql)
  }
}, 30000)
beforeEach(async () => {
  await database.exec(
    'TRUNCATE platform_sessions,platform_credentials,platform_admins,platform_audit CASCADE',
  )
  await database.query(
    "INSERT INTO platform_admins(identity_id,role,granted_by,reason) VALUES('existing-owner','owner','operator','Existing owner')",
  )
})
afterAll(() => database.close())

it('grants only the verified account admin access alongside the existing owner, with bounded MFA enrollment and audit', async () => {
  const owner = (
    await database.query(
      "SELECT * FROM platform_admins WHERE identity_id='existing-owner'",
    )
  ).rows
  const businesses = (
    await database.query('SELECT COUNT(*) AS count FROM businesses')
  ).rows

  await database.exec(grantSql)

  const grants = (
    await database.query<{
      identity_id: string
      role: string
      enabled: boolean
      remaining: number
    }>(`SELECT identity_id,role,enabled,
      EXTRACT(EPOCH FROM enrollment_until-NOW())::integer AS remaining
      FROM platform_admins WHERE identity_id<>'existing-owner'`)
  ).rows
  expect(grants).toHaveLength(1)
  expect(grants[0]).toMatchObject({
    identity_id: identity,
    role: 'admin',
    enabled: true,
  })
  expect(grants[0].remaining).toBeGreaterThan(86300)
  expect(grants[0].remaining).toBeLessThanOrEqual(86400)
  expect(
    (
      await database.query(
        "SELECT * FROM platform_admins WHERE identity_id='existing-owner'",
      )
    ).rows,
  ).toEqual(owner)
  expect(
    (await database.query('SELECT COUNT(*) AS count FROM businesses')).rows,
  ).toEqual(businesses)
  expect(
    (await database.query('SELECT * FROM platform_sessions')).rows,
  ).toEqual([])
  expect(
    (await database.query('SELECT * FROM platform_credentials')).rows,
  ).toEqual([])
  expect(
    (
      await database.query(
        'SELECT actor_id,action,target,outcome,before,after FROM platform_audit',
      )
    ).rows,
  ).toEqual([
    {
      actor_id: '6adffa3c415f25bd3c09076f',
      action: 'admin_granted',
      target: identity,
      outcome: 'success',
      before: { platformAccess: false },
      after: {
        role: 'admin',
        enabled: true,
        enrollmentHours: 24,
        mfaRequired: true,
      },
    },
  ])
})

it('does not reopen expired enrollment or duplicate the audit on replay', async () => {
  await database.exec(grantSql)
  await database.query(
    "UPDATE platform_admins SET enrollment_until=NOW()-INTERVAL '1 day' WHERE identity_id=$1",
    [identity],
  )
  const before = (await database.query('SELECT * FROM platform_admins')).rows
  await database.exec(grantSql)
  expect((await database.query('SELECT * FROM platform_admins')).rows).toEqual(
    before,
  )
  expect(
    (await database.query('SELECT * FROM platform_audit')).rows,
  ).toHaveLength(1)
})

it('preserves a revoked grant', async () => {
  await database.query(
    "INSERT INTO platform_admins(identity_id,enabled,granted_by,reason) VALUES($1,false,'operator','Revoked')",
    [identity],
  )
  const before = (await database.query('SELECT * FROM platform_admins')).rows
  await database.exec(grantSql)
  expect((await database.query('SELECT * FROM platform_admins')).rows).toEqual(
    before,
  )
  expect((await database.query('SELECT * FROM platform_audit')).rows).toEqual(
    [],
  )
})

it('preserves existing owner access, enrolled credentials, and sessions for the account', async () => {
  await database.query(
    "INSERT INTO platform_admins(identity_id,role,granted_by,reason) VALUES($1,'owner','operator','Existing grant')",
    [identity],
  )
  await database.query(
    "INSERT INTO platform_credentials(id,identity_id,public_key) VALUES('existing-key',$1,'test-public-key')",
    [identity],
  )
  await database.query(
    "INSERT INTO platform_sessions(token_hash,identity_id,epoch,origin,mfa_at,expires_at) VALUES('test-session-hash',$1,1,'https://admin.mycottagepantry.com',NOW(),NOW()+INTERVAL '10 minutes')",
    [identity],
  )
  const grants = (await database.query('SELECT * FROM platform_admins')).rows
  const credentials = (
    await database.query('SELECT * FROM platform_credentials')
  ).rows
  const sessions = (await database.query('SELECT * FROM platform_sessions'))
    .rows

  await database.exec(grantSql)

  expect((await database.query('SELECT * FROM platform_admins')).rows).toEqual(
    grants,
  )
  expect(
    (await database.query('SELECT * FROM platform_credentials')).rows,
  ).toEqual(credentials)
  expect(
    (await database.query('SELECT * FROM platform_sessions')).rows,
  ).toEqual(sessions)
  expect((await database.query('SELECT * FROM platform_audit')).rows).toEqual(
    [],
  )
})
