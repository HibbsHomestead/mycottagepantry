// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { hasRecentAdminVerification } from '../../netlify/lib/platform-admin-core'

it('accepts only recent server verification, distinguishes password from MFA and rejects retired methods', () => {
  const state = {
    verified_at: new Date().toISOString(),
    verification_method: 'password',
  }
  expect(hasRecentAdminVerification(state)).toBe(true)
  expect(hasRecentAdminVerification({ ...state, totp_enabled: true })).toBe(
    false,
  )
  for (const method of ['totp', 'recovery', 'sms'])
    expect(
      hasRecentAdminVerification({
        ...state,
        totp_enabled: true,
        verification_method: method,
      }),
    ).toBe(true)
  for (const verified_at of [
    null,
    '',
    'invalid',
    new Date(Date.now() - 11 * 60000).toISOString(),
    new Date(Date.now() + 60000).toISOString(),
  ])
    expect(hasRecentAdminVerification({ ...state, verified_at })).toBe(false)
  for (const verification_method of [null, 'passkey', 'frontend'])
    expect(hasRecentAdminVerification({ ...state, verification_method })).toBe(
      false,
    )
  expect(
    hasRecentAdminVerification({
      verified: true,
      mfa_at: new Date().toISOString(),
    }),
  ).toBe(false)
})
it('retires old sessions and pending public-key ceremonies without changing grants, authenticator records or billing data', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE TABLE platform_sessions(token_hash text, mfa_method text, challenge text, challenge_kind text,challenge_purpose text,challenge_until timestamptz);
      INSERT INTO platform_sessions VALUES('old-key-session','passkey','old-challenge','authentication','totp-enroll',NOW()),('password-session',NULL,'old-challenge','registration',NULL,NOW()),('code-session','totp',NULL,NULL,NULL,NULL);
      CREATE TABLE retained_records(kind text, value text);
      INSERT INTO retained_records VALUES('grant','unchanged'),('authenticator','unchanged'),('recovery','unchanged'),('stripe-ciphertext','unchanged'),('stripe-account-binding','unchanged'),('stripe-prices','unchanged'),('stripe-webhook','unchanged');`)
    const before = (await db.query('SELECT * FROM retained_records')).rows
    await db.exec(`CREATE ROLE retirement_runner NOLOGIN;
      ALTER TABLE platform_sessions OWNER TO retirement_runner;
      ALTER TABLE platform_sessions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE platform_sessions FORCE ROW LEVEL SECURITY;
      CREATE POLICY session_gateway ON platform_sessions
        USING(current_setting('app.platform_gateway',true)='true')
        WITH CHECK(current_setting('app.platform_gateway',true)='true');
      SET ROLE retirement_runner;`)
    await db.exec(
      await readFile(
        'netlify/database/migrations/20261207010000_retire_admin_passkeys/migration.sql',
        'utf8',
      ),
    )
    await db.exec('RESET ROLE')
    const sessions = (
      await db.query<Record<string, unknown>>(
        'SELECT * FROM platform_sessions ORDER BY token_hash',
      )
    ).rows
    expect(sessions).toHaveLength(2)
    for (const row of sessions) {
      expect(row.challenge).toBeNull()
      expect(row.challenge_kind).toBeNull()
      expect(row.challenge_purpose).toBeNull()
      expect(row.challenge_until).toBeNull()
      expect(row.verified_at).toBeNull()
      expect(row.verification_method).toBeNull()
    }
    expect((await db.query('SELECT * FROM retained_records')).rows).toEqual(
      before,
    )
    await expect(
      db.query("UPDATE platform_sessions SET verification_method='passkey'"),
    ).rejects.toThrow()
  } finally {
    await db.close()
  }
})
it('has no application public-key browser calls, server ceremonies or WebAuthn dependencies', async () => {
  const roots = ['src', 'netlify/functions', 'netlify/lib', 'scripts']
  const forbidden =
    /@simplewebauthn|navigator\.credentials|PublicKeyCredential|generateAuthenticationOptions|generateRegistrationOptions|verifyAuthenticationResponse|verifyRegistrationResponse/
  async function check(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = dir + '/' + entry.name
      if (entry.isDirectory()) await check(path)
      else if (/\.(ts|tsx|mts)$/.test(path) && !/\.test\./.test(path))
        expect(await readFile(path, 'utf8'), path).not.toMatch(forbidden)
    }
  }
  for (const root of roots) await check(root)
  expect(await readFile('package.json', 'utf8')).not.toContain(
    '@simplewebauthn',
  )
  expect(await readFile('pnpm-lock.yaml', 'utf8')).not.toContain(
    '@simplewebauthn',
  )
})
