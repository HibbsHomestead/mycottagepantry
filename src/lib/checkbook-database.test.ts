// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { it, expect } from 'vitest'
it('database rejects closed-period postings from any source and allows later corrections', async () => {
  const db = new PGlite()
  try {
    await db.exec(
      'CREATE TABLE journals (id text, business_id text, data jsonb); CREATE TABLE finance_reviews (business_id text, data jsonb);',
    )
    await db.exec(
      await readFile(
        'netlify/database/migrations/20261213010000_guard_bookkeeping_statements/migration.sql',
        'utf8',
      ),
    )
    await db.query('INSERT INTO finance_reviews VALUES ($1,$2)', [
      'business-a',
      { kind: 'statement', date: '2026-11-12', account: 'Cash' },
    ])
    const posting = (business: string, date: string) =>
      db.query('INSERT INTO journals VALUES ($1,$2,$3)', [
        'disposable',
        business,
        {
          status: 'posted',
          date,
          lines: [
            { account: 'Cash', debit: 12, credit: 0 },
            { account: 'Sales revenue', debit: 0, credit: 12 },
          ],
        },
      ])
    await expect(posting('business-a', '2026-11-01')).rejects.toThrow(
      /balanced statement/,
    )
    await expect(posting('business-a', '2026-11-13')).resolves.toBeDefined()
    await expect(posting('business-b', '2026-11-01')).resolves.toBeDefined()
  } finally {
    await db.close()
  }
})
