// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

const migration = (name: string) =>
  readFile(
    new URL(
      `../../netlify/database/migrations/${name}/migration.sql`,
      import.meta.url,
    ),
    'utf8',
  )
it('enforces six Mercantile seats for Stripe, preserves existing members and matches paid coverage expiry', async () => {
  const db = new PGlite()
  const business = '00000000-0000-4000-8000-000000000099'
  try {
    await db.exec(`
      CREATE TABLE businesses(id uuid PRIMARY KEY,identity_owner text);
      CREATE TABLE users(id text PRIMARY KEY,business_id uuid,identity_id text,active boolean DEFAULT true);
      CREATE TABLE workspace_billing(business_id uuid PRIMARY KEY,plan_id text,source text,status text,environment text,paid_through timestamptz,entitlement_policy text);
      CREATE TABLE complimentary_grants(id uuid PRIMARY KEY,business_id uuid,plan_id text,owner_identity text,created_at timestamptz DEFAULT now(),
        CONSTRAINT complimentary_grants_plan CHECK(plan_id IN ('cottage-kitchen')));
    `)
    await db.exec(await migration('20261126010000_add_operational_access'))
    const stripe = await migration('20261128010000_add_stripe_platform_billing')
    await db.exec(
      stripe.slice(
        stripe.indexOf('-- Extend the existing shared member-limit trigger'),
      ),
    )
    await db.exec(
      'CREATE TRIGGER business_user_limit BEFORE INSERT OR UPDATE OF active,business_id ON users FOR EACH ROW EXECUTE FUNCTION enforce_business_user_limit()',
    )
    await db.query('INSERT INTO businesses VALUES($1,$2)', [business, 'owner'])
    await db.query(
      "INSERT INTO workspace_billing VALUES($1,'cottage-mercantile','stripe_test','paid_active','test','2099-01-01','kitchen-two-v1')",
      [business],
    )
    await db.query("INSERT INTO users VALUES('owner',$1,'owner',true)", [
      business,
    ])
    await db.exec(await migration('20261204010000_confirm_mercantile_seats'))
    for (let i = 1; i <= 5; i++)
      await db.query('INSERT INTO users VALUES($1,$2,$1,true)', [
        `member${i}`,
        business,
      ])
    await expect(
      db.query("INSERT INTO users VALUES('seventh',$1,'seventh',true)", [
        business,
      ]),
    ).rejects.toThrow(/6 total business users/)
    await db.query("INSERT INTO users VALUES('inactive',$1,'inactive',false)", [
      business,
    ])
    await expect(
      db.query("UPDATE users SET active=true WHERE id='inactive'"),
    ).rejects.toThrow(/6 total/)
    // A failed renewal keeps the already-paid six-seat period, with no extra grace.
    await db.query(
      "UPDATE workspace_billing SET status='past_due' WHERE business_id=$1",
      [business],
    )
    await db.query("UPDATE users SET active=false WHERE id='member5'")
    await db.query("UPDATE users SET active=true WHERE id='inactive'")
    await db.query(
      "UPDATE workspace_billing SET paid_through='2020-01-01' WHERE business_id=$1",
      [business],
    )
    await db.query(
      "UPDATE users SET identity_id=identity_id WHERE id='member1'",
    )
    await expect(
      db.query("UPDATE users SET active=true WHERE id='member5'"),
    ).rejects.toThrow(/1 total/)
    expect(
      (await db.query('SELECT * FROM users WHERE active=true')).rows,
    ).toHaveLength(6)
    // Existing Square sandbox paid-through grace and legacy escape remain intact.
    await db.query(
      "UPDATE workspace_billing SET source='square_sandbox',environment='sandbox',paid_through=now()-interval '1 day' WHERE business_id=$1",
      [business],
    )
    await db.query("UPDATE users SET active=false WHERE id='inactive'")
    await db.query("UPDATE users SET active=true WHERE id='member5'")
    await db.query(
      "UPDATE workspace_billing SET entitlement_policy='legacy',paid_through='2020-01-01' WHERE business_id=$1",
      [business],
    )
    await db.query(
      "INSERT INTO users VALUES('legacy-extra',$1,'legacy-extra',true)",
      [business],
    )
  } finally {
    await db.close()
  }
}, 20000)
