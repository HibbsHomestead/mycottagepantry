// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
it('isolates secrets and events, blocks cross-provider checkout in both directions, and retains history', async () => {
  const db = new PGlite(),
    a = '10000000-0000-4000-8000-000000000001',
    b = '10000000-0000-4000-8000-000000000002'
  try {
    await db.exec(`CREATE TABLE businesses(id uuid PRIMARY KEY); INSERT INTO businesses VALUES('${a}'),('${b}');
   CREATE TABLE workspace_billing(business_id uuid,source text,environment text,CONSTRAINT workspace_billing_source CHECK(source IN ('square_sandbox')),CONSTRAINT workspace_billing_environment CHECK(environment IN ('sandbox')));
   CREATE TABLE billing_subscriptions(business_id uuid,status text);
   CREATE TABLE billing_attempts(business_id uuid,status text);
   CREATE FUNCTION enforce_business_user_limit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;`)
    const previous = await readFile(
      new URL(
        '../../netlify/database/migrations/20261126010000_add_operational_access/migration.sql',
        import.meta.url,
      ),
      'utf8',
    )
    await db.exec(
      previous.slice(
        previous.indexOf(
          'CREATE OR REPLACE FUNCTION enforce_business_user_limit()',
        ),
      ),
    )
    await db.exec(
      await readFile(
        new URL(
          '../../netlify/database/migrations/20261128010000_add_stripe_platform_billing/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    )
    expect(
      JSON.stringify(
        (
          await db.query(
            "SELECT pg_get_functiondef('enforce_business_user_limit()'::regprocedure)",
          )
        ).rows,
      ),
    ).toContain('stripe_test')
    await db.exec(
      `CREATE ROLE stripe_app; GRANT SELECT,INSERT,UPDATE ON stripe_provider_settings,stripe_events,stripe_checkouts TO stripe_app; GRANT SELECT ON businesses,billing_subscriptions,billing_attempts TO stripe_app; SET ROLE stripe_app;`,
    )
    expect(
      (await db.query('SELECT * FROM stripe_provider_settings')).rows,
    ).toHaveLength(0)
    await expect(
      db.query(
        "INSERT INTO stripe_provider_settings(environment,ciphertext) VALUES('test','encrypted-fixture')",
      ),
    ).rejects.toThrow(/row.level security/)
    await db.exec("SET app.platform_gateway='true'")
    await db.query(
      "INSERT INTO stripe_provider_settings(environment,ciphertext) VALUES('test','encrypted-fixture')",
    )
    await db.exec("RESET app.platform_gateway; SET app.business_id='" + a + "'")
    expect(
      (await db.query('SELECT * FROM stripe_provider_settings')).rows,
    ).toHaveLength(0)
    expect((await db.query('SELECT * FROM stripe_events')).rows).toHaveLength(0)
    await db.exec("RESET ROLE; SET app.billing_worker='true'")
    await db.query("INSERT INTO billing_subscriptions VALUES($1,'ACTIVE')", [a])
    const insert = (business: string) =>
      db.query(
        "INSERT INTO stripe_checkouts(business_id,identity_id,environment,plan_id,price_id) VALUES($1,'fixture','test','cottage-kitchen','price_fixture')",
        [business],
      )
    await expect(insert(a)).rejects.toThrow(/Existing Square/)
    await db.query(
      "UPDATE billing_subscriptions SET status='CANCELED' WHERE business_id=$1",
      [a],
    )
    await insert(a)
    await expect(insert(a)).rejects.toThrow(/unique/)
    await expect(
      db.query("INSERT INTO billing_attempts VALUES($1,'checkout_pending')", [
        a,
      ]),
    ).rejects.toThrow(/Existing Stripe/)
    await expect(
      db.query("INSERT INTO billing_subscriptions VALUES($1,'ACTIVE')", [a]),
    ).rejects.toThrow(/Cross-provider/)
    await insert(b)
    await db.query(
      "UPDATE stripe_checkouts SET status='cancelled' WHERE business_id=$1",
      [a],
    )
    await db.query("INSERT INTO billing_subscriptions VALUES($1,'ACTIVE')", [a])
    expect(
      (await db.query('SELECT * FROM stripe_checkouts')).rows,
    ).toHaveLength(2)
  } finally {
    await db.close()
  }
}, 20000)
