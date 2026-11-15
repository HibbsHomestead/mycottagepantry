// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { launchPricing } from './launch-plans'

it('enforces every tier, counts the owner once, preserves over-limit teams and rejects racing additions', async () => {
  const db = new PGlite()
  await db.exec(`CREATE TABLE businesses(id uuid PRIMARY KEY,identity_owner text);
    CREATE TABLE workspace_billing(business_id uuid,plan_id text,source text,status text,paid_through timestamptz,environment text,entitlement_policy text);
    CREATE TABLE complimentary_grants(id text,business_id uuid,plan_id text,grant_source text,operation text,owner_identity text,created_at timestamptz,expires_at timestamptz);
    CREATE TABLE stripe_subscription_changes(business_id uuid,to_plan text,kind text,status text,created_at timestamptz,preview jsonb);
    CREATE TABLE users(id text,business_id uuid,identity_id text,active boolean DEFAULT true,role text);`)
  await db.exec(
    await readFile(
      'netlify/database/migrations/20261212010000_update_business_user_allowances/migration.sql',
      'utf8',
    ),
  )
  try {
    for (const [index, plan] of launchPricing.plans.entries()) {
      const business = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      await db.query('INSERT INTO businesses VALUES($1,$2)', [
        business,
        'owner',
      ])
      await db.query(
        "INSERT INTO workspace_billing VALUES($1,$2,'stripe_live','paid_active','2099-01-01','live','legacy')",
        [business, plan.id],
      )
      expect(
        (
          await db.query<{ cap: number }>(
            'SELECT business_plan_user_limit($1) cap',
            [plan.id],
          )
        ).rows[0].cap,
      ).toBe(plan.users)
      // Owner is reserved even before provisioning, then counted once.
      for (let i = 1; i < plan.users; i++)
        await db.query('INSERT INTO users VALUES($1,$2,$1,true)', [
          'member' + i,
          business,
        ])
      await db.query("INSERT INTO users VALUES('owner',$1,'owner',true)", [
        business,
      ])
      const results = await Promise.allSettled(
        ['extra-a', 'extra-b'].map((id) =>
          db.query('INSERT INTO users VALUES($1,$2,$1,true)', [id, business]),
        ),
      )
      expect(results.every((r) => r.status === 'rejected')).toBe(true)
      await db.query("UPDATE users SET role='Manager' WHERE business_id=$1", [
        business,
      ])
      if (plan.id === 'cottage-mercantile') {
        await db.query(
          "UPDATE workspace_billing SET plan_id='free' WHERE business_id=$1",
          [business],
        )
        expect(
          (
            await db.query(
              'SELECT * FROM users WHERE business_id=$1 AND active',
              [business],
            )
          ).rows,
        ).toHaveLength(6)
        await db.query(
          "UPDATE users SET active=false WHERE business_id=$1 AND id='owner'",
          [business],
        )
        await db.query(
          "UPDATE users SET active=true WHERE business_id=$1 AND id='owner'",
          [business],
        )
        await expect(
          db.query("INSERT INTO users VALUES('seventh',$1,'seventh',true)", [
            business,
          ]),
        ).rejects.toThrow(/allowance of 5/)
      }
    }

    const raceBusiness = '00000000-0000-4000-8000-000000000099'
    await db.query("INSERT INTO businesses VALUES($1,'race-owner')", [
      raceBusiness,
    ])
    for (let i = 1; i <= 3; i++)
      await db.query('INSERT INTO users VALUES($1,$2,$1,true)', [
        'race' + i,
        raceBusiness,
      ])
    const race = await Promise.allSettled(
      ['last-a', 'last-b'].map((id) =>
        db.query('INSERT INTO users VALUES($1,$2,$1,true)', [id, raceBusiness]),
      ),
    )
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(race.filter((r) => r.status === 'rejected')).toHaveLength(1)
    // A valid business override has its own allowance. It grants no platform seat.
    await db.query(
      "INSERT INTO complimentary_grants VALUES('override',$1,'cottage-mercantile','support_override','grant','race-owner',now(),null)",
      [raceBusiness],
    )
    await db.query("INSERT INTO users VALUES('sixth',$1,'sixth',true)", [
      raceBusiness,
    ])
    await expect(
      db.query("INSERT INTO users VALUES('seventh',$1,'seventh',true)", [
        raceBusiness,
      ]),
    ).rejects.toThrow(/allowance of 6/)
    // A previously saved two-seat review must not resurrect the retired allowance.
    await db.query(
      "INSERT INTO stripe_subscription_changes VALUES($1,'cottage-kitchen','downgrade','scheduled',now(),'{\"toUsers\":2}')",
      [raceBusiness],
    )
    await db.query(
      "UPDATE users SET active=false WHERE business_id=$1 AND id='sixth'",
      [raceBusiness],
    )
    await expect(
      db.query("INSERT INTO users VALUES('extra',$1,'extra',true)", [
        raceBusiness,
      ]),
    ).rejects.toThrow(/scheduled plan allows 5/)
  } finally {
    await db.close()
  }
}, 20000)
