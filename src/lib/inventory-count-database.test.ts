// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
it('isolates counts with real SQL policies, rejects foreign items and protects completed history', async () => {
  const db = new PGlite(),
    a = '00000000-0000-4000-8000-000000000001',
    b = '00000000-0000-4000-8000-000000000002'
  try {
    await db.exec(
      `CREATE TABLE businesses(id uuid PRIMARY KEY);CREATE TABLE ingredients(id text,business_id uuid);INSERT INTO businesses VALUES('${a}'),('${b}');INSERT INTO ingredients VALUES('item-a','${a}'),('item-b','${b}');`,
    )
    // Isolated disposable database only; this never connects to Netlify or applies a deployed migration.
    await db.exec(
      await readFile(
        new URL(
          '../../netlify/database/migrations/20261104010000_add_inventory_counts/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    )
    await db.query(
      'INSERT INTO inventory_counts(id,business_id,data) VALUES($1,$2,$3)',
      [
        'count-b',
        b,
        JSON.stringify({ status: 'draft', revision: 0, lines: [] }),
      ],
    )
    await db.exec(
      `CREATE ROLE count_app;GRANT USAGE ON SCHEMA public TO count_app;GRANT SELECT,INSERT,UPDATE ON inventory_counts,ingredients TO count_app;SET ROLE count_app;SET app.business_id='${a}';`,
    )
    expect(
      (await db.query('SELECT * FROM inventory_counts')).rows,
    ).toHaveLength(0)
    await expect(
      db.query(
        'INSERT INTO inventory_counts(id,business_id,data) VALUES($1,$2,$3)',
        [
          'forged',
          b,
          JSON.stringify({ status: 'draft', revision: 0, lines: [] }),
        ],
      ),
    ).rejects.toThrow(/row.level security/i)
    await expect(
      db.query(
        'INSERT INTO inventory_counts(id,business_id,data) VALUES($1,$2,$3)',
        [
          'foreign-line',
          a,
          JSON.stringify({
            status: 'draft',
            revision: 0,
            lines: [{ ingredientId: 'item-b' }],
          }),
        ],
      ),
    ).rejects.toThrow(/authorized workspace/i)
    await expect(
      db.query(
        'INSERT INTO inventory_counts(id,business_id,data) VALUES($1,$2,$3)',
        ['invalid', a, '{}'],
      ),
    ).rejects.toThrow()
    await db.query(
      'INSERT INTO inventory_counts(id,business_id,data) VALUES($1,$2,$3)',
      [
        'count-a',
        a,
        JSON.stringify({
          status: 'completed',
          revision: 2,
          lines: [{ ingredientId: 'item-a' }],
        }),
      ],
    )
    await expect(
      db.query(
        "UPDATE inventory_counts SET data=jsonb_set(data,'{status}','\"draft\"') WHERE id='count-a'",
      ),
    ).rejects.toThrow(/immutable/)
    expect((await db.query('SELECT id FROM inventory_counts')).rows).toEqual([
      { id: 'count-a' },
    ])
  } finally {
    await db.close()
  }
}, 20000)
