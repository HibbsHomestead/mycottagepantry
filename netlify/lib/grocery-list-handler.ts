import { z } from 'zod'
import {
  generateGroceryList,
  newerGroceryMark,
  type GroceryLine,
  type GroceryList,
} from '../../src/lib/grocery-list'
import type { Item, Workspace } from '../../src/lib/domain'

const id = z.string().min(1).max(240)
const uuid = z.uuid()
const quantity = z.number().finite().min(0.000001).max(1e9)
const sources = z.object({
  runs: z
    .array(id)
    .max(200)
    .transform((items) => [...new Set(items)]),
  events: z
    .array(id)
    .max(100)
    .transform((items) => [...new Set(items)]),
  recipes: z
    .array(
      z.object({ id, amount: quantity, basis: z.enum(['batches', 'yield']) }),
    )
    .max(100),
  from: z.string().max(10),
  to: z.string().max(10),
})
const row = z.string().min(1).max(1800)
const requestBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('generate'), id: uuid, sources }),
  z.object({
    action: z.literal('marks'),
    id: uuid,
    marks: z
      .array(
        z.object({
          row,
          checked: z.boolean(),
          at: z.number().int().positive(),
          token: uuid,
        }),
      )
      .min(1)
      .max(200),
  }),
  z.object({
    action: z.literal('manual'),
    id: uuid,
    item: uuid,
    name: z.string().trim().min(1).max(160),
    amount: quantity,
    unit: z.string().trim().max(40),
    vendor: z.string().trim().max(100),
    notes: z.string().trim().max(600),
  }),
  z.object({
    action: z.literal('quantity'),
    id: uuid,
    row,
    amount: quantity.nullable(),
  }),
])

const sourceTables = [
  'ingredients',
  'recipes',
  'products',
  'batches',
  'vendors',
  'events',
  'event_batch_links',
] as const

type GroceryClient = {
  query: (
    sql: string,
    params: unknown[],
  ) => Promise<{ rows: { data: unknown }[] }>
}

export async function handleGroceryList(
  request: Request,
  client: GroceryClient,
  org: string,
  actor: string,
  role: string,
) {
  const response = (data: object, status = 200) =>
    Response.json(
      { serverTime: Date.now(), ...data },
      { status, headers: { 'Cache-Control': 'private, no-store' } },
    )
  if (!['Owner', 'Manager', 'Production Staff'].includes(role))
    return response(
      { error: 'Your oven role does not have access to Grocery & Prep.' },
      403,
    )
  const load = async (listId: string, lock = false) =>
    (
      await client.query(
        `SELECT data FROM grocery_lists WHERE business_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`,
        [org, listId],
      )
    ).rows[0]?.data as GroceryList | undefined
  if (request.method === 'GET') {
    const url = new URL(request.url)
    const listId = url.searchParams.get('list')
    if (listId) {
      if (!uuid.safeParse(listId).success)
        return response({ error: 'Invalid grocery list.' }, 400)
      const list = await load(listId)
      return list
        ? response({ list })
        : response({ error: 'Grocery list is unavailable.' }, 404)
    }
    const { rows } = await client.query(
      "SELECT jsonb_build_object('id',id,'generatedAt',data->'generatedAt','labels',data->'labels') AS data FROM grocery_lists WHERE business_id=$1 ORDER BY created_at DESC, id DESC",
      [org],
    )
    return response({ lists: rows.map((entry) => entry.data) })
  }
  if (request.method !== 'POST')
    return response({ error: 'Method not supported.' }, 405)
  const parsed = requestBody.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return response(
      { error: 'Review the grocery list fields and try again.' },
      400,
    )
  const input = parsed.data
  if (input.action === 'generate') {
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE', [
      org,
    ])
    const previous = await load(input.id)
    if (previous) return response({ list: previous })
    const state: Workspace = {}
    for (const table of sourceTables) {
      const result = await client.query(
        `SELECT data FROM ${table} WHERE business_id=$1 ORDER BY created_at,id`,
        [org],
      )
      state[table] = result.rows.map((entry) => entry.data as Item)
    }
    let list: GroceryList
    try {
      list = generateGroceryList(
        state,
        input.sources,
        input.id,
        new Date().toISOString(),
      )
    } catch (error) {
      return response(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Cannot generate this list.',
        },
        400,
      )
    }
    await client.query(
      'INSERT INTO grocery_lists (id,business_id,data,created_by,updated_by) VALUES ($1,$2,$3,$4,$4)',
      [list.id, org, JSON.stringify(list), actor],
    )
    return response({ list }, 201)
  }
  const list = await load(input.id, true)
  if (!list) return response({ error: 'Grocery list is unavailable.' }, 404)
  const rowsById = new Map(
    [...list.lines, ...list.manual].map((line) => [line.id, line]),
  )
  let changed = false
  switch (input.action) {
    case 'marks':
      for (const mark of input.marks) {
        const line = rowsById.get(mark.row)
        if (!line || line.review?.endsWith('reference only')) continue
        const normalized = {
          ...mark,
          at: Math.min(mark.at, Date.now() + 300_000),
        }
        if (newerGroceryMark(normalized, list.marks[mark.row])) {
          list.marks[mark.row] = normalized
          changed = true
        }
      }
      break
    case 'manual': {
      if (rowsById.has(input.item)) break
      if (list.manual.length >= 250)
        return response(
          { error: 'This list already has 250 manual items.' },
          400,
        )
      const line: GroceryLine = {
        id: input.item,
        name: input.name,
        unit: input.unit,
        kind: 'Manual',
        vendor: input.vendor,
        category: '',
        needed: input.amount,
        toBuy: input.amount,
        manual: true,
        notes: input.notes,
        sources: [],
      }
      list.manual.push(line)
      changed = true
      break
    }
    case 'quantity': {
      const line = rowsById.get(input.row)
      if (!line || line.review)
        return response(
          { error: 'This row is available for reference only.' },
          400,
        )
      if (input.amount === null) delete list.overrides[input.row]
      else list.overrides[input.row] = input.amount
      changed = true
      break
    }
  }
  if (changed) {
    const field = input.action === 'quantity' ? 'overrides' : input.action
    await client.query(
      'UPDATE grocery_lists SET data=jsonb_set(data, ARRAY[$1::text], $2::jsonb), updated_by=$3, updated_at=now() WHERE business_id=$4 AND id=$5',
      [field, JSON.stringify(list[field]), actor, org, list.id],
    )
  }
  return response({ list })
}
