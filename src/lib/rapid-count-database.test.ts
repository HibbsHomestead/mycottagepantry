// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
it('extends count status safely, isolates scope by tenant, and freezes applied and cancelled reports', async () => {
  const db = new PGlite(),
    a = '00000000-0000-4000-8000-000000000001',
    b = '00000000-0000-4000-8000-000000000002'
  try {
    await db.exec(
      `CREATE TABLE businesses(id uuid PRIMARY KEY);CREATE TABLE ingredients(id text,business_id uuid);INSERT INTO businesses VALUES('${a}'),('${b}');INSERT INTO ingredients VALUES('own','${a}'),('foreign','${b}');`,
    )
    for (const migration of [
      '20261104010000_add_inventory_counts',
      '20261127010000_add_rapid_inventory_counts',
    ])
      await db.exec(
        await readFile(
          new URL(
            '../../netlify/database/migrations/' +
              migration +
              '/migration.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      )
    await db.exec(
      `CREATE ROLE count_user; GRANT SELECT,INSERT,UPDATE ON inventory_counts,ingredients TO count_user; SET ROLE count_user; SET app.business_id='${a}';`,
    )
    const insert = (id: string, business: string, data: Record<string, unknown>) =>
      db.query(
        'INSERT INTO inventory_counts(id,business_id,data) VALUES($1,$2,$3)',
        [id, business, JSON.stringify(data)],
      )
    const valid = {
      status: 'draft',
      version: 2,
      revision: 0,
      events: [],
      scope: [{ ingredientId: 'own' }],
      lines: [],
      ownerId: 'counter',
    }
    await insert('safe', a, valid)
    await db.query(
      "UPDATE inventory_counts SET data=jsonb_set(data,'{status}','\"ready\"') WHERE id='safe'",
    )
    await db.query(
      "UPDATE inventory_counts SET data=jsonb_set(data,'{status}','\"completed\"') WHERE id='safe'",
    )
    await expect(
      db.query(
        "UPDATE inventory_counts SET data=jsonb_set(data,'{status}','\"draft\"') WHERE id='safe'",
      ),
    ).rejects.toThrow(/immutable/)
    await insert('cancelled', a, { ...valid, status: 'cancelled' })
    await expect(
      db.query(
        "UPDATE inventory_counts SET data=jsonb_set(data,'{revision}','1') WHERE id='cancelled'",
      ),
    ).rejects.toThrow(/immutable/)
    await expect(
      insert('cross', b, {
        ...valid,
        scope: [{ ingredientId: 'foreign' }],
      }),
    ).rejects.toThrow(/row.level security/)
    await expect(
      insert('foreign-scope', a, {
        ...valid,
        scope: [{ ingredientId: 'foreign' }],
      }),
    ).rejects.toThrow(/authorized workspace/)
    await expect(
      insert('shape', a, { ...valid, events: {} }),
    ).rejects.toThrow(/require/)
    await expect(
      insert('owner', a, { ...valid, ownerId: '' }),
    ).rejects.toThrow(/ownership/)
    // Legacy documents and their completed-history rules remain supported.
    await insert('legacy', a, { status: 'draft', revision: 0, lines: [] })
    expect(
      (await db.query('SELECT id FROM inventory_counts')).rows,
    ).toHaveLength(3)
  } finally {
    await db.close()
  }
}, 20000)
