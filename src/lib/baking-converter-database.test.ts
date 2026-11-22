// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { handleBakingConverter } from '../../netlify/lib/baking-converter-handler'
it('seeds sourced defaults and isolates custom factors with database policies and tenant foreign keys', async () => {
  const db = new PGlite(),
    a = '00000000-0000-4000-8000-000000000001',
    b = '00000000-0000-4000-8000-000000000002'
  try {
    await db.exec(
      `CREATE TABLE businesses(id uuid PRIMARY KEY); CREATE TABLE ingredients(id text,business_id uuid,data jsonb DEFAULT '{}',UNIQUE(business_id,id)); INSERT INTO businesses VALUES('${a}'),('${b}'); INSERT INTO ingredients(id,business_id) VALUES('foreign','${b}');`,
    )
    await db.exec(
      await readFile(
        new URL(
          '../../netlify/database/migrations/20261219010000_add_baking_converter/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    )
    expect(
      (await db.query('SELECT * FROM baking_conversion_references')).rows,
    ).toHaveLength(18)
    expect(
      (
        await db.query(
          "SELECT reference_volume_ml::float8 AS ml FROM baking_conversion_references WHERE id='wkb-butter'",
        )
      ).rows,
    ).toEqual([{ ml: 240 }])
    await db.exec(
      `CREATE ROLE baker; GRANT SELECT,INSERT,UPDATE ON baking_conversion_references TO baker; SET ROLE baker; SET app.business_id='${a}';`,
    )
    const insert = (
      id: string,
      owner: string,
      inventory: string | null = null,
    ) =>
      db.query(
        `INSERT INTO baking_conversion_references(id,business_id,reference_id,inventory_ingredient_id,ingredient_name,description,reference_weight_g,reference_volume_ml,original_quantity,original_unit,source_name,source_url,scope) VALUES($1,$2,CASE WHEN $3::text IS NULL THEN 'wkb-butter' ELSE 'wkb-honey' END,$3,'Butter','Measured',240,236.5882365,1,'US cup','Measured','','private')`,
        [id, owner, inventory],
      )
    await insert('custom-a', a)
    await expect(insert('bad-tenant', b)).rejects.toThrow(/row.level security/)
    await expect(insert('bad-inventory', a, 'foreign')).rejects.toThrow(
      /foreign key/,
    )
    expect(
      (
        await db.query(
          "UPDATE baking_conversion_references SET reference_weight_g=999 WHERE id='wkb-butter' RETURNING id",
        )
      ).rows,
    ).toHaveLength(0)
    await db.exec(`SET app.business_id='${b}'`)
    const rows = await db.query<{ id: string }>(
      'SELECT id FROM baking_conversion_references',
    )
    expect(rows.rows).toHaveLength(18)
    expect(rows.rows.some((r) => r.id === 'custom-a')).toBe(false)
    await insert('custom-b', b)
    await db.exec(`SET app.business_id='${a}'`)
    expect(
      (
        await db.query(
          "SELECT id FROM baking_conversion_references WHERE scope='private'",
        )
      ).rows,
    ).toEqual([{ id: 'custom-a' }])
    await db.exec(
      'RESET ROLE; GRANT SELECT,UPDATE ON businesses TO baker; GRANT SELECT ON ingredients TO baker; SET ROLE baker;',
    )
    const client = {
      query: async (sql: string, params?: any[]) => {
        const result = await db.query(sql, params)
        return { ...result, rowCount: result.rows.length }
      },
    }
    const originalInventory = (await db.query('SELECT * FROM ingredients')).rows
    const request = new Request(
      'https://example.com/api/workspace?bakingConverter',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: b,
          referenceId: 'wkb-butter',
          ingredientName: 'Butter',
          description: 'My measured cup',
          referenceWeightG: 250,
          referenceVolumeMl: 236.5882365,
        }),
      },
    )
    const denied = await handleBakingConverter(
      request.clone(),
      client,
      a,
      'Read-only Accountant',
    )
    expect(denied.status).toBe(403)
    const response = await handleBakingConverter(request, client, a, 'Owner')
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(
      data.references.find((r: any) => r.id === 'custom-a').referenceWeightG,
    ).toBe(250)
    expect(
      data.references.find((r: any) => r.id === 'wkb-butter').referenceWeightG,
    ).toBe(226)
    expect(data.references.some((r: any) => r.id === 'custom-b')).toBe(false)
    expect((await db.query('SELECT * FROM ingredients')).rows).toEqual(
      originalInventory,
    )
  } finally {
    await db.close()
  }
})
