// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  fixtureMigrationNames,
  enrollmentRecoveryMigration,
  legacyEnrollmentRecoveryMigration,
} from '../../tests/database-fixture-migrations'

const database = new PGlite()
const target = 'd62a6cbd-124a-4766-9e82-22cb062ea09a'
const operator = '6adffa3c415f25bd3c09076f'
let recoverySql: string
let legacyRecoverySql: string

beforeAll(async () => {
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root))
    await database.exec(
      await readFile(new URL(name + '/migration.sql', root), 'utf8'),
    )
  recoverySql = await readFile(
    new URL(enrollmentRecoveryMigration + '/migration.sql', root),
    'utf8',
  )
  legacyRecoverySql = await readFile(
    new URL(legacyEnrollmentRecoveryMigration + '/migration.sql', root),
    'utf8',
  )
}, 30000)
beforeEach(async () => {
  await database.exec(
    'TRUNCATE platform_sessions,platform_credentials,platform_admins,platform_audit CASCADE',
  )
  await database.query(
    `INSERT INTO platform_admins(identity_id,role,granted_by,reason,created_at,enrollment_until)
     VALUES('other-owner','owner',$1,'Existing owner',NOW()-INTERVAL '3 days',NULL),
     ($2,'admin',$1,'Original account grant',NOW()-INTERVAL '2 days',NOW()-INTERVAL '1 day')`,
    [operator, target],
  )
  await database.query(
    "INSERT INTO platform_audit(actor_id,action,target,outcome,request_id) VALUES($1,'admin_granted',$2,'success',gen_random_uuid())",
    [operator, target],
  )
  await database.query(
    `INSERT INTO platform_sessions(token_hash,identity_id,epoch,origin,mfa_at,expires_at)
     VALUES('fixture-pending-session',$1,1,'https://admin.mycottagepantry.com',NULL,NOW()+INTERVAL '5 minutes'),
     ('fixture-other-session','other-owner',1,'https://admin.mycottagepantry.com',NOW(),NOW()+INTERVAL '30 minutes')`,
    [target],
  )
})
afterAll(() => database.close())

async function runRecovery(client = database) {
  // Match deployment: the runner owns the transaction and must still be able to
  // write its bookkeeping and commit after executing the migration statement.
  await client.exec('BEGIN')
  try {
    await client.exec(recoverySql)
    await client.exec('SAVEPOINT migration_runner_bookkeeping')
    await client.exec('RELEASE SAVEPOINT migration_runner_bookkeeping')
    await client.exec('COMMIT')
  } catch (error) {
    await client.exec('ROLLBACK')
    throw error
  }
}
async function snapshot(client = database) {
  return {
    grants: (
      await client.query<Record<string, unknown>>(
        'SELECT * FROM platform_admins ORDER BY identity_id',
      )
    ).rows,
    credentials: (
      await client.query<Record<string, unknown>>(
        'SELECT * FROM platform_credentials ORDER BY id',
      )
    ).rows,
    sessions: (
      await client.query<Record<string, unknown>>(
        'SELECT * FROM platform_sessions ORDER BY token_hash',
      )
    ).rows,
    audit: (
      await client.query<Record<string, unknown>>(
        'SELECT * FROM platform_audit ORDER BY created_at,id',
      )
    ).rows,
  }
}

async function openOriginalWindow() {
  await database.query(
    "UPDATE platform_admins SET created_at=NOW()-INTERVAL '1 hour',enrollment_until=NOW()+INTERVAL '23 hours' WHERE identity_id=$1",
    [target],
  )
}

function expectNoRecovery(
  before: Awaited<ReturnType<typeof snapshot>>,
  after: Awaited<ReturnType<typeof snapshot>>,
) {
  expect(after.grants).toEqual(before.grants)
  expect(after.credentials).toEqual(before.credentials)
  expect(after.sessions).toEqual(before.sessions)
  expect(after.audit).toHaveLength(before.audit.length + 1)
  const decision = after.audit.find(
    (row) => row.action === 'mfa_enrollment_recovery',
  )!
  expect(decision).toMatchObject({
    actor_id: operator,
    target,
    outcome: 'not_required',
    after: {
      recoveryApplied: false,
      mfaRequired: true,
      invalidatedPendingSessions: 0,
    },
  })
  expect(decision.before).toMatchObject({
    epoch: 1,
    credentialCount: 0,
  })
  expect(decision.after).toMatchObject(decision.before as object)
  expect(
    after.audit.filter(
      (row) =>
        row.action === 'mfa_enrollment_recovery' && row.outcome === 'success',
    ),
  ).toHaveLength(0)
}

it('preserves an unchanged open original window and all pending access, with an audited no-recovery decision', async () => {
  await openOriginalWindow()
  const before = await snapshot()
  await runRecovery()
  const after = await snapshot()
  expectNoRecovery(before, after)
  await runRecovery()
  expect(await snapshot()).toEqual(after)
  await database.query(
    "UPDATE platform_admins SET created_at=NOW()-INTERVAL '2 days',enrollment_until=NOW()-INTERVAL '1 day' WHERE identity_id=$1",
    [target],
  )
  const expired = await snapshot()
  await runRecovery()
  expect(await snapshot()).toEqual(expired)
})

it('preserves the exact historical SQL from the deployment that recorded the recovery decision', () => {
  expect(createHash('sha256').update(legacyRecoverySql).digest('hex')).toBe(
    '4928af87f14630a8654adb06525268e91e311f49b3df1dd5cd0f857424b7d565',
  )
})

it.each([false, true])(
  'runs the full historical and forward migration chain under the runner, with one decision (original window open: %s)',
  async (open) => {
    const fresh = new PGlite()
    try {
      await fresh.exec('BEGIN')
      const root = new URL(
        '../../netlify/database/migrations/',
        import.meta.url,
      )
      for (const name of await fixtureMigrationNames(root))
        await fresh.exec(
          await readFile(new URL(name + '/migration.sql', root), 'utf8'),
        )
      if (!open)
        await fresh.query(
          "UPDATE platform_admins SET created_at=NOW()-INTERVAL '2 days',enrollment_until=NOW()-INTERVAL '1 day' WHERE identity_id=$1",
          [target],
        )
      const before = await snapshot(fresh)
      await fresh.exec(legacyRecoverySql)
      const recorded = await snapshot(fresh)
      // The immutable legacy SQL commits. The continuation must leave the
      // runner in an active transaction even on a branch running it afresh.
      await fresh.exec(recoverySql)
      await fresh.exec('SAVEPOINT runner_bookkeeping')
      await fresh.exec('RELEASE SAVEPOINT runner_bookkeeping')
      await fresh.exec('COMMIT')
      const after = await snapshot(fresh)
      expect(after).toEqual(recorded)
      if (open) expectNoRecovery(before, after)
      else {
        expect(
          after.grants.find((row) => row.identity_id === target),
        ).toMatchObject({
          role: 'admin',
          epoch: 2,
        })
        expect(
          after.audit.filter((row) => row.action === 'mfa_enrollment_recovery'),
        ).toHaveLength(1)
        expect(
          after.audit.find((row) => row.action === 'mfa_enrollment_recovery'),
        ).toMatchObject({
          outcome: 'success',
          after: { enrollmentHours: 24, credentialCount: 0, mfaRequired: true },
        })
      }
      await runRecovery(fresh)
      expect(await snapshot(fresh)).toEqual(after)
    } finally {
      await fresh.close()
    }
  },
  30000,
)

it.each([false, true])(
  'keeps all recovery changes inside the runner transaction when later bookkeeping fails (original window open: %s)',
  async (open) => {
    if (open) await openOriginalWindow()
    const before = await snapshot()
    await database.exec('BEGIN')
    try {
      await database.exec(recoverySql)
      const during = await snapshot()
      expect(during.audit).toHaveLength(before.audit.length + 1)
      if (open) expectNoRecovery(before, during)
      else {
        expect(
          during.grants.find((row) => row.identity_id === target),
        ).toMatchObject({
          epoch: 2,
        })
        expect(during.sessions).toHaveLength(before.sessions.length - 1)
      }
      // A failed later runner statement must roll back the migration as well.
      await expect(
        database.query('SELECT 1 / 0 AS fixture_failed_bookkeeping'),
      ).rejects.toThrow()
    } finally {
      await database.exec('ROLLBACK')
    }
    expect(await snapshot()).toEqual(before)
  },
)

it('applies the approved migration as one bounded audited recovery, invalidates only target pending sessions and preserves other access', async () => {
  const before = await snapshot()
  await runRecovery()
  const after = await snapshot()
  expect(
    after.grants.find((grant) => grant.identity_id === 'other-owner'),
  ).toEqual(before.grants.find((grant) => grant.identity_id === 'other-owner'))
  expect(after.sessions).toEqual(
    before.sessions.filter((session) => session.identity_id !== target),
  )
  expect(after.credentials).toEqual(before.credentials)
  const grant = after.grants.find((row) => row.identity_id === target)!
  expect(grant).toMatchObject({
    role: 'admin',
    enabled: true,
    epoch: 2,
    granted_by: operator,
  })
  const remaining = (
    await database.query<{ seconds: number }>(
      'SELECT EXTRACT(EPOCH FROM enrollment_until-NOW())::integer AS seconds FROM platform_admins WHERE identity_id=$1',
      [target],
    )
  ).rows[0].seconds
  expect(remaining).toBeGreaterThan(86300)
  expect(remaining).toBeLessThanOrEqual(86400)
  const audit = after.audit.find(
    (row) => row.action === 'mfa_enrollment_recovery',
  )!
  expect(audit).toMatchObject({
    actor_id: operator,
    target,
    outcome: 'success',
  })
  expect(audit.before).toMatchObject({
    role: 'admin',
    enabled: true,
    epoch: 1,
    credentialCount: 0,
  })
  expect(audit.after).toMatchObject({
    role: 'admin',
    enabled: true,
    epoch: 2,
    credentialCount: 0,
    enrollmentHours: 24,
    mfaRequired: true,
    invalidatedPendingSessions: 1,
  })
  expect(JSON.stringify(audit)).not.toContain('fixture-pending-session')
  expect(JSON.stringify(audit)).not.toContain('fixture-other-session')
})

it('does not extend again or duplicate the audit on replay, including after the new window expires', async () => {
  await runRecovery()
  await database.query(
    "UPDATE platform_admins SET enrollment_until=NOW()-INTERVAL '1 hour' WHERE identity_id=$1",
    [target],
  )
  const before = await snapshot()
  await runRecovery()
  expect(await snapshot()).toEqual(before)
})

it.each([
  [
    'revoked grant',
    'UPDATE platform_admins SET enabled=false WHERE identity_id=$1',
  ],
  [
    'changed role',
    "UPDATE platform_admins SET role='owner' WHERE identity_id=$1",
  ],
  [
    'changed grantor',
    "UPDATE platform_admins SET granted_by='different-operator' WHERE identity_id=$1",
  ],
  [
    'missing deadline',
    'UPDATE platform_admins SET enrollment_until=NULL WHERE identity_id=$1',
  ],
  [
    'changed active deadline',
    "UPDATE platform_admins SET enrollment_until=NOW()+INTERVAL '1 hour' WHERE identity_id=$1",
  ],
  [
    'previously changed deadline',
    "UPDATE platform_admins SET enrollment_until=created_at+INTERVAL '25 hours' WHERE identity_id=$1",
  ],
  ['missing grant', 'DELETE FROM platform_admins WHERE identity_id=$1'],
])(
  'refuses %s without changing any access, credentials or audit history',
  async (_, sql) => {
    if (sql.startsWith('DELETE'))
      await database.query(
        'DELETE FROM platform_sessions WHERE identity_id=$1',
        [target],
      )
    await database.query(sql, [target])
    const before = await snapshot()
    await expect(runRecovery()).rejects.toThrow('Enrollment recovery refused')
    expect(await snapshot()).toEqual(before)
  },
)

it.each(
  ['usb', 'internal', 'hybrid'].flatMap((transport) =>
    [false, true].map((open) => ({ transport, open })),
  ),
)(
  'preserves an existing $transport credential (original window open: $open) and refuses to replace its access',
  async ({ transport, open }) => {
    if (open) await openOriginalWindow()
    await database.query(
      'INSERT INTO platform_credentials(id,identity_id,public_key,transports) VALUES($1,$2,$3,$4)',
      [
        'fixture-existing-credential',
        target,
        'fixture-existing-public-key',
        JSON.stringify([transport]),
      ],
    )
    const before = await snapshot()
    await expect(runRecovery()).rejects.toThrow('existing or prior MFA access')
    expect(await snapshot()).toEqual(before)
  },
)

it.each([false, true])(
  'requires the original grant audit (original window open: %s)',
  async (open) => {
    if (open) await openOriginalWindow()
    await database.exec('TRUNCATE platform_audit')
    const before = await snapshot()
    await expect(runRecovery()).rejects.toThrow(
      'original grant audit is missing',
    )
    expect(await snapshot()).toEqual(before)
  },
)

it.each([false, true])(
  'refuses prior successful enrollment even if a credential is no longer present (original window open: %s)',
  async (open) => {
    if (open) await openOriginalWindow()
    await database.query(
      "INSERT INTO platform_audit(actor_id,action,target,outcome,request_id) VALUES($1,'mfa_enrolled',$1,'success',gen_random_uuid())",
      [target],
    )
    const before = await snapshot()
    await expect(runRecovery()).rejects.toThrow('existing or prior MFA access')
    expect(await snapshot()).toEqual(before)
  },
)

it.each([false, true])(
  'refuses an existing MFA-verified session without invalidating it (original window open: %s)',
  async (open) => {
    if (open) await openOriginalWindow()
    await database.query(
      'UPDATE platform_sessions SET mfa_at=NOW() WHERE identity_id=$1',
      [target],
    )
    const before = await snapshot()
    await expect(runRecovery()).rejects.toThrow('existing or prior MFA access')
    expect(await snapshot()).toEqual(before)
  },
)

it.each([false, true])(
  'rolls back every change if the mandatory recovery or no-recovery audit cannot be recorded (original window open: %s)',
  async (open) => {
    if (open) await openOriginalWindow()
    await database.exec(
      "ALTER TABLE platform_audit ADD CONSTRAINT fixture_recovery_audit_failure CHECK (action <> 'mfa_enrollment_recovery')",
    )
    const before = await snapshot()
    try {
      await expect(runRecovery()).rejects.toThrow()
      expect(await snapshot()).toEqual(before)
    } finally {
      await database.exec(
        'ALTER TABLE platform_audit DROP CONSTRAINT fixture_recovery_audit_failure',
      )
    }
  },
)
