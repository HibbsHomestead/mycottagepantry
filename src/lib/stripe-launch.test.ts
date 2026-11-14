// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { afterEach, expect, it, vi } from 'vitest'
import { activateHostedStripe } from '../../netlify/lib/stripe-setup'
import type { AdminMetadata } from './platform-admin-types'

afterEach(() => vi.unstubAllEnvs())

it('activates completed hosted setup only after signed delivery and respects an explicit disable', async () => {
  vi.stubEnv('CONTEXT', 'production')
  const db = new PGlite()
  await db.exec(`CREATE TABLE stripe_provider_settings (
    environment text, validated_at timestamptz, webhook_verified_at timestamptz,
    checkout_enabled boolean DEFAULT false, updated_at timestamptz,
    account_id text, configuration jsonb
  )`)
  const config = {
    hostedLaunchReady: true,
    policy: { portal: 'bpc_fixture' },
    mappings: {
      'mixing-bowl': {
        purchase: true,
        account: 'acct_fixture',
        verifiedAt: 'now',
      },
    },
  }
  const c = { query: async (sql: string) => db.query<AdminMetadata>(sql) }
  try {
    await db.query(
      `INSERT INTO stripe_provider_settings
      (environment,validated_at,account_id,configuration) VALUES ('live',NOW(),'acct_fixture',$1)`,
      [config],
    )
    const enabled = async () =>
      (
        await db.query<{ checkout_enabled: boolean }>(
          'SELECT checkout_enabled FROM stripe_provider_settings',
        )
      ).rows[0].checkout_enabled
    await activateHostedStripe(c)
    expect(await enabled()).toBe(false)
    await db.exec(
      'UPDATE stripe_provider_settings SET webhook_verified_at=NOW()',
    )
    await activateHostedStripe(c)
    expect(await enabled()).toBe(true)
    for (const blocked of [
      { ...config, launchDisabled: true },
      { ...config, hostedLaunchReady: false },
      { ...config, apiError: 'CONNECTION_TEST_FAILED' },
      {
        ...config,
        mappings: {
          tier: { purchase: true, account: 'acct_other', verifiedAt: 'now' },
        },
      },
    ]) {
      await db.query(
        'UPDATE stripe_provider_settings SET checkout_enabled=false,configuration=$1',
        [blocked],
      )
      await activateHostedStripe(c)
      expect(await enabled()).toBe(false)
    }
    await db.query('UPDATE stripe_provider_settings SET configuration=$1', [
      config,
    ])
    vi.stubEnv('CONTEXT', 'deploy-preview')
    await activateHostedStripe(c)
    expect(await enabled()).toBe(false)
  } finally {
    await db.close()
  }
})
