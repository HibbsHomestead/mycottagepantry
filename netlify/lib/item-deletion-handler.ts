import {
  deletableTables,
  itemDeletionBlockers,
  recipeDeletionPlan,
  type DeletableTable,
} from '../../src/lib/item-deletion'
import type { Item, Workspace } from '../../src/lib/domain'

type Client = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>
}
const ownDefinitions: Record<DeletableTable, Record<string, string>> = {
  ingredients: {},
  recipes: { recipe_lines: 'recipe_id' },
  products: {
    product_packaging_lines: 'product_id',
    product_tax_assignments: 'product_id',
  },
}
/** Called after the owned business lock and a fresh workspace load, in the same
 * transaction as all normal writes. Foreign keys remain the final safeguard. */
export async function handleItemDeletion(
  action: string,
  table: string,
  data: Item,
  ctx: {
    client: Client
    org: string
    role: string
    state: Workspace
    audit: (name: string, detail: string) => Promise<unknown>
  },
) {
  const { client, org, role, state, audit } = ctx
  if (!['Owner', 'Manager'].includes(role))
    throw new Error('Only an Owner or Manager can delete items.')
  if (!(deletableTables as readonly string[]).includes(table))
    throw new Error('Choose an ingredient, product, or recipe.')
  const entity = table as DeletableTable
  const item = state[table].find((row) => row.id === data.id)
  if (!item)
    throw new Error(
      'This item is unavailable in this business. Refresh the list.',
    )
  if (action === 'itemArchive') {
    if (
      entity !== 'products' ||
      item.workflow !== 'kit' ||
      data.confirmed !== true
    )
      throw new Error('Only a confirmed basket archive is supported here.')
    await client.query(
      "UPDATE products SET data=jsonb_set(data,'{archived}','true'::jsonb),updated_at=NOW() WHERE business_id=$1 AND id=$2",
      [org, item.id],
    )
    await audit(
      'Basket archived',
      `${item.name}: definition, stock, links and history preserved.`,
    )
    return null
  }
  const plan =
    entity === 'recipes'
      ? recipeDeletionPlan(state, item)
      : {
          output: undefined,
          blockers: itemDeletionBlockers(state, entity, item),
        }
  const blockers = plan.blockers
  const targets = [
    { entity, item },
    ...(plan.output
      ? [{ entity: 'ingredients' as const, item: plan.output }]
      : []),
  ]
  for (const { entity, item } of targets) {
    if (entity !== 'recipes') {
      const stock = await client.query(
        `SELECT quantity FROM ${entity} WHERE business_id=$1 AND id=$2`,
        [org, item.id],
      )
      if (
        stock.rows.some(
          (row) =>
            !Number.isFinite(Number(row.quantity)) ||
            Number(row.quantity) !== 0,
        )
      )
        blockers.push(
          'Stored stock remains. Resolve stock through the inventory workflow before deletion.',
        )
    }

    // Also inspect actual relational references. Some normalized historical rows
    // have no corresponding JSON parent in the client workspace.
    const foreignKeys = await client.query(
      `
    SELECT conrelid::regclass::text AS source, a.attname AS column_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    JOIN pg_attribute target ON target.attrelid=c.confrelid
      AND target.attnum=c.confkey[array_position(c.conkey,a.attnum)]
    WHERE c.contype='f' AND c.confrelid=to_regclass($1)
      AND target.attname='id'`,
      [entity],
    )
    for (const fk of foreignKeys.rows) {
      const source = String(fk.source).replace(/^public\./, '')
      const column = String(fk.column_name)
      if (!/^[a-z_]+$/.test(source) || !/^[a-z_]+$/.test(column))
        throw new Error(
          'A dependency could not be verified. Contact support before deleting.',
        )
      if (ownDefinitions[entity][source] === column) continue
      const found = await client.query(
        `SELECT ref.id, to_jsonb(ref)->'data'->>'name' AS name
         FROM "${source}" AS ref
         WHERE ref.business_id=$1 AND ref."${column}"=$2 LIMIT 20`,
        [org, item.id],
      )
      for (const row of found.rows) {
        blockers.push(
          `${source.replaceAll('_', ' ')}: ${row.name || row.id} (ID: ${row.id}) uses this ${entity === 'recipes' ? 'recipe/prep' : 'inventory item'} through ${column.replaceAll('_', ' ')}. Review current links; historical records must be retained.`,
        )
      }
    }
  }
  const unique = [...new Set(blockers)]
  if (action === 'itemDeleteCheck')
    return {
      item: { id: item.id, name: item.name },
      blockers: unique,
      ownedOutput: plan.output
        ? { id: plan.output.id, name: plan.output.name }
        : null,
      canArchive:
        entity === 'products' && item.workflow === 'kit' && !item.archived,
    }
  if (action !== 'itemDelete' || data.confirmed !== true)
    throw new Error('Confirm permanent deletion first.')
  if (data.expectedName !== item.name)
    throw new Error(
      'This item was renamed. Cancel and review its current name before deleting.',
    )
  if (unique.length) throw new Error(`Deletion blocked. ${unique.join(' · ')}`)
  if (!plan.output && data.confirmedOutputId)
    throw new Error(
      'The linked output changed. Cancel and review the current records before deleting.',
    )
  if (
    plan.output &&
    (data.confirmedOutputId !== plan.output.id ||
      data.expectedOutputName !== plan.output.name)
  )
    throw new Error(
      'The linked output changed. Cancel and review both records before deleting.',
    )
  for (const { entity, item } of [...targets].reverse()) {
    if (entity === 'ingredients')
      await client.query(
        "DELETE FROM ingredient_conversions WHERE business_id=$1 AND data->>'ingredientId'=$2",
        [org, item.id],
      )
    for (const [source, column] of Object.entries(ownDefinitions[entity]))
      await client.query(
        `DELETE FROM ${source} WHERE business_id=$1 AND ${column}=$2`,
        [org, item.id],
      )
    await client.query(`DELETE FROM ${entity} WHERE business_id=$1 AND id=$2`, [
      org,
      item.id,
    ])
  }
  // Audit both IDs so a stale editor cannot recreate either deleted record.
  for (const { entity, item } of targets)
    await audit(
      'Item permanently deleted',
      JSON.stringify({ table: entity, recordId: item.id, name: item.name }),
    )
  return null
}
