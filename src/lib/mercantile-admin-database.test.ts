// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { handleAdminAccess } from '../../netlify/lib/admin-access'
import {
  effectiveAccess,
  latestManualGrant,
} from '../../netlify/lib/manual-access'
import { planWriteAllowed } from '../../netlify/lib/billing-state'
import { launchFeatures, launchPricing, planIncludes } from './launch-plans'
import { selectedPlan } from './registration'
const migration = (name: string) =>
  readFile(`netlify/database/migrations/${name}/migration.sql`, 'utf8')
it('previews, applies and reloads a disposable Mercantile assignment with six seats and immutable access history', async () => {
  const db = new PGlite(),
    business = '00000000-0000-4000-8000-000000000098'
  const c = {
    query: (sql: string, params: any[] = []) => db.query<any>(sql, params),
    release: () => {},
  }
  const session = {
    identity_id: 'authorized-admin',
    role: 'owner',
    mfa_at: new Date().toISOString(),
  }
  const input = {
    businessId: business,
    operation: 'grant',
    plan: 'cottage-mercantile',
    source: 'owner_internal',
    expiresAt: null,
    reason: 'Approved internal assignment test',
  }
  const request = (data: unknown) =>
    new Request(
      'https://admin.mycottagepantry.com/api/admin?action=business-access',
      { method: 'POST', body: JSON.stringify(data) },
    )
  try {
    await db.exec(`CREATE TABLE businesses(id uuid PRIMARY KEY,business_name text,identity_owner text);
      CREATE TABLE users(id text PRIMARY KEY,business_id uuid,identity_id text,active boolean DEFAULT true);
      CREATE TABLE workspace_billing(business_id uuid PRIMARY KEY,plan_id text,source text,status text,environment text,paid_through timestamptz,entitlement_policy text,subscription_id text,updated_at timestamptz);
      CREATE TABLE complimentary_grants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid,plan_id text,owner_identity text,actor_identity text,reason text,created_at timestamptz DEFAULT now(),CONSTRAINT complimentary_grants_plan CHECK(plan_id IN ('cottage-kitchen')));
      CREATE TABLE platform_audit(actor_id text,action text,target text,outcome text,request_id text,reason text,before jsonb,after jsonb);`)
    await db.exec(await migration('20261126010000_add_operational_access'))
    const stripe = await migration('20261128010000_add_stripe_platform_billing')
    await db.exec(
      stripe.slice(
        stripe.indexOf('-- Extend the existing shared member-limit trigger'),
      ),
    )
    await db.exec(await migration('20261204010000_confirm_mercantile_seats'))
    await db.query('INSERT INTO businesses VALUES($1,$2,$3)', [
      business,
      'Disposable support test oven',
      'owner',
    ])
    await db.query("INSERT INTO users VALUES('owner',$1,'owner',true)", [
      business,
    ])
    const preview = await handleAdminAccess(
      c,
      request(input),
      session,
      'test-preview',
    )
    expect(preview.preview.memberLimit).toBe(6)
    expect(preview.preview.after.plan).toBe('cottage-mercantile')
    expect(
      (await db.query('SELECT * FROM complimentary_grants')).rows,
    ).toHaveLength(0)
    await expect(
      handleAdminAccess(
        c,
        request(input),
        { ...session, mfa_at: null },
        'denied',
      ),
    ).rejects.toThrow(/Verified platform administrator/)
    const applied = await handleAdminAccess(
      c,
      request({ ...input, confirmation: preview.confirmation }),
      session,
      'test-apply',
    )
    expect(applied.applied).toBe(true)
    const grant = await latestManualGrant(c, business)
    const reloaded = effectiveAccess(null, grant, 'owner')
    expect(reloaded).toMatchObject({
      plan: 'cottage-mercantile',
      source: 'owner_internal',
      manualValid: true,
    })
    for (const f of launchFeatures.filter((f) =>
      planIncludes('cottage-mercantile', f.id),
    ))
      expect(planWriteAllowed(reloaded.access!, f.id)).toBe(true)
    for (let i = 1; i <= 5; i++)
      await db.query('INSERT INTO users VALUES($1,$2,$1,true)', [
        'member-' + i,
        business,
      ])
    await expect(
      db.query("INSERT INTO users VALUES('seventh',$1,'seventh',true)", [
        business,
      ]),
    ).rejects.toThrow(/6 total business users/)
    expect(
      (await db.query('SELECT * FROM users WHERE active')).rows,
    ).toHaveLength(6)
    const history = (await db.query<any>('SELECT * FROM platform_audit')).rows
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      action: 'access:grant',
      actor_id: 'authorized-admin',
      reason: input.reason,
    })
    expect(history[0].after.effective.plan).toBe('cottage-mercantile')
    expect(
      effectiveAccess(
        {
          plan_id: 'free',
          status: 'suspended',
          source: 'stripe_live',
          entitlement_policy: 'kitchen-two-v1',
        },
        grant,
        'owner',
      ).access?.write,
    ).toBe(false)
    expect(
      effectiveAccess(null, { ...grant!, operation: 'revoke' }, 'owner')
        .manualValid,
    ).toBe(false)
    expect(
      effectiveAccess(null, { ...grant!, expires_at: '2020-01-01' }, 'owner')
        .manualValid,
    ).toBe(false)
    expect(effectiveAccess(null, grant, 'different-owner').manualValid).toBe(
      false,
    )
    expect(launchPricing.checkoutEnabled).toBe(false)
    expect(selectedPlan('cottage-mercantile')).toBe('free')
  } finally {
    await db.close()
  }
}, 20000)
