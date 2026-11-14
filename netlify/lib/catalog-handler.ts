import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  acceptanceSchema,
  catalogSnapshotSchema,
  externalGTIN,
  type CatalogResult,
} from '../../src/lib/catalog'
import {
  barcodeMatches,
  internalItemId,
  expandedUPCE,
} from '../../src/lib/barcodes'
import type { Item, Workspace } from '../../src/lib/domain'
import { limitedBody } from './support-core'
import { normalizeUnit } from '../../src/lib/domain'
import { packageStatements } from './package-statements'
import { openFoodFactsProduct } from './open-food-facts'

export type CatalogClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Item[] }>
}
export class LookupError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
export const lookupHeaders = { 'Cache-Control': 'private, no-store' }
const response = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: lookupHeaders })
export async function catalogSearch(
  c: CatalogClient,
  kind: string,
  query: string,
  identifier?: string,
) {
  const { rows } = await c.query(
    `SELECT i.id,i.status,r.id AS revision_id,r.data FROM catalog_items i JOIN LATERAL (SELECT id,data FROM catalog_revisions WHERE item_id=i.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true WHERE i.status='active' AND i.kind=$1 AND ($3::text IS NOT NULL AND EXISTS(SELECT 1 FROM catalog_identifiers b WHERE b.item_id=i.id AND b.identifier=$3) OR $3::text IS NULL AND (r.data->'fields'->>'name' ILIKE $2 ESCAPE '\\' OR r.data->'fields'->>'brand' ILIKE $2 ESCAPE '\\')) ORDER BY r.data->'fields'->>'name' LIMIT 20`,
    [kind, `%${query.replace(/[\\%_]/g, '\\$&')}%`, identifier || null],
  )
  return rows.map((r) => ({
    ...r.data,
    id: r.id,
    revisionId: r.revision_id,
    status: r.status,
  })) as CatalogResult[]
}
/** Database counters commit before network calls, so failed attempts also consume quota. */
export async function reserveLookup(
  c: CatalogClient,
  org: string,
  operation: 'fdc' | 'photos' | 'internet',
) {
  const day = new Date().toISOString().slice(0, 10),
    hour = new Date().toISOString().slice(0, 13)
  const id = `${operation}:${day}`
  const activeToken = randomUUID()
  const previous = (
    await c.query(
      'SELECT data FROM product_lookup_usage WHERE business_id=$1 AND id=$2 FOR UPDATE',
      [org, id],
    )
  ).rows[0]?.data || { count: 0 }
  const limit = operation === 'photos' ? 20 : operation === 'internet' ? 10 : 60
  if (
    previous.count >= limit ||
    (operation === 'photos' &&
      Date.parse(previous.activeUntil || '') > Date.now())
  )
    throw new LookupError(
      429,
      'LOOKUP_LIMIT',
      'Import limit reached or another photo import is active. Wait before retrying; manual entry remains available.',
    )
  await c.query("SELECT set_config('app.lookup_counter_worker','true',true)")
  const globalId = `global:${operation}:${hour}`
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [globalId])
  const globalCount =
    (
      await c.query(
        "SELECT COALESCE(SUM((data->>'count')::integer),0) AS count FROM product_lookup_usage WHERE id=$1",
        [globalId],
      )
    ).rows[0]?.count || 0
  if (
    Number(globalCount) >=
    (operation === 'internet' ? 150 : operation === 'fdc' ? 800 : 100)
  )
    throw new LookupError(
      429,
      'PROVIDER_LIMIT',
      'The shared provider allowance is busy. Retry later or continue manually.',
    )
  for (const [key, data] of [
    [
      id,
      {
        count: previous.count + 1,
        activeToken: operation === 'photos' ? activeToken : null,
        activeUntil:
          operation === 'photos'
            ? new Date(Date.now() + 60000).toISOString()
            : null,
      },
    ],
    [
      globalId,
      {
        count:
          Number(
            (
              await c.query(
                'SELECT data FROM product_lookup_usage WHERE business_id=$1 AND id=$2',
                [org, globalId],
              )
            ).rows[0]?.data?.count || 0,
          ) + 1,
      },
    ],
  ])
    await c.query(
      'INSERT INTO product_lookup_usage(id,business_id,data) VALUES($1,$2,$3) ON CONFLICT(business_id,id) DO UPDATE SET data=$3,updated_at=NOW()',
      [key, org, JSON.stringify(data)],
    )
  await c.query('COMMIT')
  return activeToken
}
export async function fdcLookup(
  code: string,
  format?: string,
): Promise<{ results: CatalogResult[]; notice?: string }> {
  code = format === 'upc_e' ? expandedUPCE(code) || code : code
  const key = globalThis.Netlify?.env.get('USDA_FDC_API_KEY')
  if (!key)
    return {
      results: [],
      notice:
        'USDA food lookup is not connected. Use catalog search, a product URL, or manual entry.',
    }
  const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search')
  url.searchParams.set('api_key', key)
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: code,
        pageSize: 25,
        dataType: ['Branded'],
      }),
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    throw new LookupError(
      503,
      'FDC_UNAVAILABLE',
      'USDA lookup took too long or is unavailable. Your draft is preserved; retry or continue manually.',
    )
  }
  if (!res.ok)
    throw new LookupError(
      res.status === 429 ? 429 : 503,
      'FDC_UNAVAILABLE',
      'USDA lookup is unavailable or rate limited. Retry later or continue manually.',
    )
  const body = await res.json().catch(() => null)
  if (!Array.isArray(body?.foods))
    throw new LookupError(
      502,
      'FDC_RESPONSE_INVALID',
      'USDA returned an unreadable result. Your draft is unchanged.',
    )
  const foods = z
    .array(
      z.object({
        description: z.string(),
        brandOwner: z.string().optional(),
        brandName: z.string().optional(),
        gtinUpc: z.string(),
        ingredients: z.string().optional(),
        packageWeight: z.string().optional(),
        fdcId: z.number().int().positive(),
      }),
    )
    .safeParse(body.foods)
  if (!foods.success)
    throw new LookupError(
      502,
      'FDC_RESPONSE_INVALID',
      'USDA returned invalid product fields. Your draft is unchanged.',
    )
  const identifier = externalGTIN(code, format === 'upc_e' ? 'upc_a' : format)
  return {
    results: foods.data
      .filter((f) => {
        try {
          return externalGTIN(String(f.gtinUpc)) === identifier
        } catch {
          return false
        }
      })
      .slice(0, 10)
      .flatMap((f) => {
        const weight = f.packageWeight?.match(
          /^\s*(\d+(?:\.\d+)?)\s*(g|kg|oz|lb|ml|l|fl oz)\s*$/i,
        )
        const weightUnit = weight && normalizeUnit(weight[2])
        const parsed = catalogSnapshotSchema.safeParse({
          kind: 'ingredient',
          entryType: 'branded',
          fields: {
            name: f.description,
            brand: f.brandName || undefined,
            barcode: String(f.gtinUpc),
            ...(weight && weightUnit && Number(weight[1]) > 0
              ? {
                  purchaseQuantity: Number(weight[1]),
                  purchaseUnit: weightUnit,
                }
              : {}),
            ...packageStatements(f.ingredients || ''),
          },
        })
        // Serving size is deliberately never mapped to package contents.
        return parsed.success
          ? [
              {
                ...parsed.data,
                id: `fdc:${f.fdcId}`,
                revisionId: `fdc:${f.fdcId}`,
                status: 'external',
                reviewScope:
                  'USDA barcode match; review the actual package. Allergen statements may be unknown.',
                reviewedAt: new Date().toISOString(),
                sources: [
                  {
                    url: `https://fdc.nal.usda.gov/food-details/${Number(f.fdcId)}/nutrients`,
                    license: 'USDA FoodData Central — CC0',
                  },
                ],
              },
            ]
          : []
      }),
  }
}
export async function internetLookup(code: string) {
  const fallbackUrl = `https://www.google.com/search?q=${encodeURIComponent('"' + code + '"')}`
  const key = globalThis.Netlify?.env.get('SERPAPI_API_KEY')
  // Configuring the supported provider enables search; an explicit false remains an opt-out.
  if (
    !key ||
    globalThis.Netlify?.env.get('CATALOG_INTERNET_SEARCH_ENABLED') === 'false'
  )
    return {
      candidates: [],
      fallbackUrl,
      notice:
        'In-app internet search is not enabled. Open an exact-barcode web search or continue manually.',
    }
  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine', 'google')
  url.searchParams.set('q', '"' + code + '"')
  url.searchParams.set('api_key', key)
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  } catch {
    throw new LookupError(
      503,
      'SEARCH_UNAVAILABLE',
      'Internet search is unavailable. Your draft is unchanged; retry or continue manually.',
    )
  }
  if (!res.ok)
    throw new LookupError(
      res.status === 429 ? 429 : 503,
      'SEARCH_UNAVAILABLE',
      'Internet search is unavailable or rate limited. Retry later.',
    )
  const data = await res.json().catch(() => null)
  if (data?.search_information?.organic_results_state === 'Fully empty')
    return {
      candidates: [],
      fallbackUrl,
      notice:
        'No web results for this exact barcode. Try a product URL or enter details manually.',
      provider: 'Google results via SerpApi.',
    }
  if (!data || data.error || !Array.isArray(data.organic_results))
    throw new LookupError(
      502,
      'SEARCH_RESPONSE_INVALID',
      'Internet search returned no readable candidates. Continue manually or retry.',
    )
  const organic = z
    .array(z.object({ link: z.string(), title: z.string() }))
    .safeParse(data.organic_results)
  if (!organic.success)
    throw new LookupError(
      502,
      'SEARCH_RESPONSE_INVALID',
      'Internet search returned invalid candidates. Continue manually or retry.',
    )
  const candidates = organic.data.slice(0, 8).flatMap((r) => {
    try {
      const u = new URL(r.link)
      return u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        typeof r.title === 'string'
        ? [
            {
              title: r.title.slice(0, 300),
              url: u.href,
              domain: u.hostname,
              confirmed: false,
            },
          ]
        : []
    } catch {
      return []
    }
  })
  return {
    candidates,
    fallbackUrl,
    provider: 'Google results via SerpApi; candidates are unverified.',
  }
}
export async function handleCatalog(
  req: Request,
  {
    client: c,
    org,
    role,
    state,
    actor,
  }: {
    client: CatalogClient
    org: string
    role: string
    state: Workspace
    actor: string
  },
) {
  try {
    if (req.method !== 'POST')
      throw new LookupError(
        405,
        'METHOD_NOT_ALLOWED',
        'Use POST for catalog lookup.',
      )
    const input = z
      .object({
        operation: z.enum([
          'lookup',
          'search',
          'internet',
          'updates',
          'submit',
        ]),
        kind: z
          .enum(['ingredient', 'packaging', 'supply'])
          .default('ingredient'),
        query: z.string().trim().max(512).default(''),
        format: z.string().max(30).optional(),
        snapshot: catalogSnapshotSchema.optional(),
        reason: z.string().max(2000).optional(),
        rights: z.literal(true).optional(),
        requestId: z.uuid().optional(),
        targetId: z.string().max(100).optional(),
      })
      .strict()
      .parse(JSON.parse((await limitedBody(req, 45000)).toString()))
    if (input.operation === 'updates') {
      const sources = state.ingredients
        .filter((i) => i.catalogSource)
        .map((i) => ({ ingredientId: i.id, ...i.catalogSource }))
      const updates = []
      for (const source of sources) {
        const r = (
          await c.query(
            `SELECT i.id,i.status,r.id AS revision_id,r.data FROM catalog_items i JOIN LATERAL(SELECT id,data FROM catalog_revisions WHERE item_id=i.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true WHERE i.id=$1`,
            [source.itemId],
          )
        ).rows[0]
        if (r && (r.revision_id !== source.revisionId || r.status !== 'active'))
          updates.push({
            ingredientId: source.ingredientId,
            ...r.data,
            id: r.id,
            revisionId: r.revision_id,
            status: r.status,
          })
      }
      await c.query('COMMIT')
      return response({ version: 1, updates })
    }
    if (input.operation === 'submit') {
      if (!['Owner', 'Manager'].includes(role))
        throw new LookupError(
          403,
          'ROLE_REQUIRED',
          'Only an Owner or Manager can contribute product information.',
        )
      if (!input.snapshot || !input.rights || !input.requestId)
        throw new LookupError(
          400,
          'REVIEW_REQUIRED',
          'Review exactly what you are sharing and confirm reuse rights.',
        )
      if (
        input.targetId &&
        !(
          await c.query('SELECT id FROM catalog_items WHERE id=$1', [
            input.targetId,
          ])
        ).rows.length
      )
        throw new LookupError(
          400,
          'CATALOG_MISSING',
          'Choose an existing catalog entry for a correction.',
        )
      const duplicate = (
        await c.query(
          "SELECT id FROM catalog_submissions WHERE business_id=$1 AND status='pending' AND data->'snapshot'=$2::jsonb AND COALESCE(data->>'targetId','')=$3",
          [org, JSON.stringify(input.snapshot), input.targetId || ''],
        )
      ).rows[0]
      if (duplicate) {
        await c.query('COMMIT')
        return response({ version: 1, submitted: true })
      }
      await c.query(
        'INSERT INTO catalog_submissions(id,business_id,data,created_by,updated_by) VALUES($1,$2,$3,$4,$4) ON CONFLICT(business_id,id) DO NOTHING',
        [
          input.requestId,
          org,
          JSON.stringify({
            snapshot: input.snapshot,
            reason: input.reason || '',
            targetId: input.targetId || null,
          }),
          actor,
        ],
      )
      await c.query('COMMIT')
      return response({ version: 1, submitted: true })
    }
    if (!input.query)
      throw new LookupError(
        400,
        'QUERY_REQUIRED',
        'Enter a barcode or catalog name.',
      )
    if (input.operation === 'search') {
      const results = await catalogSearch(c, input.kind, input.query)
      await c.query('COMMIT')
      return response({ version: 1, results })
    }
    // Read all private inventory types before shared or external requests.
    const privateMatches = barcodeMatches(
      state.ingredients,
      input.query,
      input.format,
    )
    const internal = internalItemId(input.query)
    if (internal)
      privateMatches.push(
        ...state.ingredients
          .filter((i) => i.id === internal)
          .map((item) => ({ item })),
      )
    if (privateMatches.length && input.operation === 'lookup') {
      await c.query('COMMIT')
      return response({
        version: 1,
        existing: [
          ...new Map(privateMatches.map((m) => [m.item.id, m])).values(),
        ].map((m) => ({
          id: m.item.id,
          name: m.item.name,
          variant: m.item.variant,
          usedAs: m.item.usedAs,
        })),
      })
    }
    let identifier: string
    try {
      identifier = externalGTIN(input.query, input.format)
    } catch (e) {
      await c.query('COMMIT')
      return response({
        version: 1,
        results: [],
        notice: (e as Error).message + ' Manual entry remains available.',
      })
    }
    if (input.operation === 'internet') {
      if (
        globalThis.Netlify?.env.get('SERPAPI_API_KEY') &&
        globalThis.Netlify?.env.get('CATALOG_INTERNET_SEARCH_ENABLED') !==
          'false'
      )
        await reserveLookup(c, org, 'internet')
      else await c.query('COMMIT')
      return response({
        version: 1,
        ...(await internetLookup(
          input.format === 'upc_e' ? expandedUPCE(input.query)! : input.query,
        )),
      })
    }
    const results = await catalogSearch(c, input.kind, '', identifier)
    if (results.length) {
      await c.query('COMMIT')
      return response({ version: 1, results })
    }
    if (input.kind !== 'ingredient') {
      await c.query('COMMIT')
      return response({
        version: 1,
        results: [],
        notice:
          'The external food provider does not cover packaging or supplies. Try internet search or manual entry.',
      })
    }
    await reserveLookup(c, org, 'fdc')
    let food: { results: CatalogResult[]; notice?: string }
    try {
      food = await fdcLookup(input.query, input.format)
    } catch (error) {
      if (!(error instanceof LookupError)) throw error
      food = { results: [], notice: error.message }
    }
    if (food.results.length) return response({ version: 1, ...food })
    try {
      const product = await openFoodFactsProduct(input.query, input.format)
      if (product)
        return response({
          version: 1,
          results: [],
          candidates: [
            {
              title: product.title,
              url: product.sourceUrl,
              domain: 'world.openfoodfacts.org',
              confirmed: false,
            },
          ],
          notice:
            'Exact barcode found in Open Food Facts. Community product details need review: choose the page, then Import details. Unknown allergens are not inferred.',
          provider:
            'Open Food Facts — database ODbL, contents DbCL, images CC BY-SA. Check your package.',
        })
    } catch {
      // A public provider outage must not block the supported web-search fallback.
    }
    // Quota reservation requires a new transaction after the FDC reservation commits.
    if (
      globalThis.Netlify?.env.get('SERPAPI_API_KEY') &&
      globalThis.Netlify?.env.get('CATALOG_INTERNET_SEARCH_ENABLED') !== 'false'
    ) {
      await c.query('BEGIN')
      await c.query("SELECT set_config('app.business_id',$1,true)", [org])
      await reserveLookup(c, org, 'internet')
    }
    try {
      const search = await internetLookup(
        input.format === 'upc_e' ? expandedUPCE(input.query)! : input.query,
      )
      return response({
        version: 1,
        ...food,
        ...search,
        notice:
          [food.notice, search.notice].filter(Boolean).join(' ') ||
          'No exact catalog match. Choose a search result to review product details.',
      })
    } catch (error) {
      if (!(error instanceof LookupError)) throw error
      return response({
        version: 1,
        ...food,
        notice: error.message,
        fallbackUrl: `https://www.google.com/search?q=${encodeURIComponent('"' + input.query + '"')}`,
      })
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    const known = e instanceof LookupError
    return response(
      {
        error: known
          ? e.message
          : e instanceof z.ZodError
            ? 'Check the lookup or shared fields; your draft is unchanged.'
            : 'Catalog lookup could not complete. Retry; your draft is unchanged.',
        code: known ? e.code : 'CATALOG_REQUEST_FAILED',
      },
      known ? e.status : 400,
    )
  }
}
export async function saveCatalogAcceptance(
  c: CatalogClient,
  org: string,
  item: Item,
) {
  if (!item.catalogSource) return
  const source = acceptanceSchema.parse(item.catalogSource)
  const previous = (
    await c.query(
      'SELECT ingredient_id,revision_id,data FROM ingredient_catalog_sources WHERE business_id=$1 AND id=$2',
      [org, source.requestId],
    )
  ).rows[0]
  if (previous) {
    if (
      previous.ingredient_id !== item.id ||
      previous.revision_id !== source.revisionId ||
      previous.data.itemId !== source.itemId ||
      JSON.stringify(previous.data.fields) !== JSON.stringify(source.fields)
    )
      throw new LookupError(
        409,
        'CATALOG_ACCEPTANCE_CHANGED',
        'This source acceptance was already used. Review the catalog fields again before saving.',
      )
    return
  }
  const revision = (
    await c.query(
      'SELECT r.data,i.kind FROM catalog_revisions r JOIN catalog_items i ON i.id=r.item_id WHERE r.id=$1 AND r.item_id=$2',
      [source.revisionId, source.itemId],
    )
  ).rows[0]
  if (
    !revision ||
    revision.kind !== (item.usedAs || 'ingredient') ||
    source.fields.some((k) => revision.data.fields[k] === undefined)
  )
    throw new LookupError(
      400,
      'CATALOG_SOURCE_INVALID',
      'The accepted catalog reference does not match this item type.',
    )
  await c.query(
    'INSERT INTO ingredient_catalog_sources(id,business_id,ingredient_id,revision_id,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(business_id,id) DO NOTHING',
    [
      source.requestId,
      org,
      item.id,
      source.revisionId,
      JSON.stringify({
        ...source,
        catalogValues: Object.fromEntries(
          source.fields.map((k) => [k, revision.data.fields[k]]),
        ),
        savedValues: Object.fromEntries(
          [...source.fields, 'amountPerPackage'].map((k) => [k, item[k]]),
        ),
      }),
    ],
  )
}
