// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import type { Context } from '@netlify/functions'
import { bestCrumbleSource } from '../test/fixtures/best-crumble'
import { convert } from './domain'
import { inventoryMovementView } from './inventory-adjustment'
import {
  parseRecipeText,
  parseIngredient,
  recipeDraftSchema,
} from './recipe-import'
const database = vi.hoisted(() => ({
  role: 'Owner',
  userId: 'verified-owner',
  expired: false,
  billing: null as null | { plan_id: string; status: string; source: string },
  records: {} as Record<string, any[]>,
  before: {} as Record<string, any[]>,
  queries: [] as { sql: string; params: any[] }[],
}))
const receiptProvider = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: receiptProvider.generate }
  },
}))
const labelFiles = vi.hoisted(() => new Map<string, ArrayBuffer>())
vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    set: async (key: string, bytes: ArrayBuffer) => {
      labelFiles.set(key, bytes)
    },
    get: async (key: string) => labelFiles.get(key) || null,
  }),
}))
vi.mock('@netlify/identity', () => ({
  getUser: async () => ({
    id: database.userId,
    confirmedAt: '2026-01-01T00:00:00Z',
  }),
}))
vi.mock('../../netlify/lib/verified-session', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../netlify/lib/verified-session')
  >()),
  verifiedSession: async () =>
    database.expired
      ? null
      : {
          id: database.userId,
          confirmedAt: '2026-01-01T00:00:00Z',
        },
  selectedWorkspace: () => undefined,
}))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({
    pool: {
      connect: async () => ({
        release() {},
        async query(sql: string, params: any[] = []) {
          database.queries.push({ sql, params })
          if (sql === 'BEGIN')
            database.before = structuredClone(database.records)
          if (sql === 'ROLLBACK') database.records = database.before
          if (
            sql.startsWith(
              'SELECT plan_id,status,source FROM workspace_billing',
            )
          )
            return { rows: database.billing ? [database.billing] : [] }
          if (sql.startsWith('SELECT b.*'))
            return { rows: [{ id: 'private-business', role: database.role }] }
          if (sql.startsWith('SELECT role FROM users'))
            return { rows: [{ role: database.role }] }
          const select = sql.match(/^SELECT data(?:,.*?)? FROM (\w+)/)
          if (select)
            return {
              rows: (database.records[select[1]] || []).map((data) => ({
                data: structuredClone(data),
              })),
            }
          const insert = sql.match(/^INSERT INTO (\w+)\(/)
          if (insert && typeof params[2] === 'string') {
            const table = insert[1],
              item = JSON.parse(params[2]),
              rows = (database.records[table] ||= [])
            const existing = rows.findIndex((r) => r.id === item.id)
            if (existing < 0) rows.push(item)
            else rows[existing] = item
          }
          return { rows: [] }
        },
      }),
    },
  }),
}))
import handler from '../../netlify/functions/workspace.mts'
function shoppingRuntime(apiKey?: string) {
  return {
    env: {
      get: (name: string) =>
        name === 'SHOPPING_SEARCH_ENABLED'
          ? 'true'
          : name === 'SERPAPI_API_KEY'
            ? apiKey
            : undefined,
    },
  }
}

const context = {
  cookies: {
    get: (name: string) =>
      name === 'cp_print_device' ? 'a'.repeat(64) : undefined,
  },
} as unknown as Context
async function post(action: string, table: string, data: any) {
  const response = await handler(
    new Request('https://cottage-pantry.test/api/workspace', {
      method: 'POST',
      body: JSON.stringify({ action, table, data }),
    }),
    context,
  )
  const result = await response.json()
  return { status: response.status, ...result }
}
beforeEach(() => {
  vi.stubGlobal('Netlify', {
    env: {
      get: (name: string) => (name === 'AI_ENABLED' ? 'true' : undefined),
    },
  })
  database.expired = false
  database.billing = null
  database.role = 'Owner'
  database.userId = 'verified-owner'
  database.records = {
    settings: [{ id: 'business', name: 'Test bakery', taxRate: 0 }],
    ingredients: [],
    recipes: [],
    products: [],
    batches: [],
    sales: [],
  }
  database.queries = []
})
it('completes the purchase → conversion → recipe → packaging → batch → taxed sale → refund slice', async () => {
  let result = await post('save', 'ingredients', {
    id: 'flour',
    name: 'Bread flour',
    purchaseQuantity: 25,
    purchaseUnit: 'lb',
    packagePrice: 10.95,
    unit: 'lb',
    usedAs: 'ingredient',
  })
  expect(result.status).toBe(200)
  expect(result.workspace.ingredients[0].unit).toBe('g')
  expect(result.workspace.ingredients[0].quantity).toBeCloseTo(11339.80925)
  result = await post('conversion', 'ingredients', {
    ingredientId: 'flour',
    from: 'cup',
    to: 'g',
    amountFrom: 1,
    amountTo: 120,
    verified: true,
    notes: 'Measured bread flour',
  })
  expect(result.status).toBe(200)
  for (const [id, price] of [
    ['bag', 8],
    ['label', 4],
    ['seal', 2],
  ] as const) {
    expect(
      (
        await post('save', 'ingredients', {
          id,
          name: id,
          purchaseQuantity: 100,
          purchaseUnit: 'each',
          packagePrice: price,
          unit: 'each',
          usedAs: 'packaging',
        })
      ).status,
    ).toBe(200)
  }
  expect(
    (
      await post('save', 'recipes', {
        id: 'bread',
        name: 'Bread',
        yield: 4,
        laborMinutes: 30,
        laborRate: 18,
        overhead: 2,
        wastePercent: 5,
        lines: [{ ingredientId: 'flour', quantity: 20, unit: 'oz' }],
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await post('save', 'products', {
        id: 'loaf',
        name: 'Loaf',
        recipeId: 'bread',
        unitsPerPackage: 1,
        price: 11,
        targetMargin: 65,
        packagingLines: ['bag', 'label', 'seal'].map((ingredientId) => ({
          ingredientId,
          quantity: 1,
          unit: 'each',
        })),
      })
    ).status,
  ).toBe(200)
  const rates = [
    {
      id: 'state',
      name: 'State',
      jurisdiction: 'State',
      ratePercent: 6,
      behavior: 'inclusive',
      order: 1,
    },
    {
      id: 'city',
      name: 'City',
      jurisdiction: 'City',
      ratePercent: 4,
      behavior: 'inclusive',
      order: 2,
    },
    {
      id: 'district',
      name: 'District',
      jurisdiction: 'District',
      ratePercent: 2,
      behavior: 'exclusive',
      order: 3,
    },
  ]
  expect(
    (
      await post('save', 'settings', {
        id: 'business',
        name: 'Test bakery',
        taxRates: rates,
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await post('save', 'batches', {
        id: 'run',
        name: 'Bread run',
        recipeId: 'bread',
        productId: 'loaf',
        count: 1,
      })
    ).status,
  ).toBe(200)
  result = await post('complete', 'batches', {
    id: 'run',
    actualYield: 4,
    laborMinutes: 30,
  })
  expect(result.status).toBe(200)
  const batch = result.workspace.batches[0]
  expect(batch.costSnapshot.ingredient).toBeCloseTo(0.5475)
  expect(batch.costSnapshot.packagingCost).toBeCloseTo(0.56)
  expect(batch.historicalCost).toBeCloseTo((0.5475 + 0.56 + 9 + 2) * 1.05)
  expect(
    result.workspace.ingredients.find((i: any) => i.id === 'bag').quantity,
  ).toBe(96)
  expect(
    result.workspace.ledger.filter((l: any) => l.type === 'batch_consumption'),
  ).toHaveLength(4)
  const snapshot = structuredClone(batch)
  result = await post('receive', 'ingredients', {
    id: 'flour',
    quantity: 25,
    unit: 'lb',
    price: 21.9,
  })
  expect(result.status).toBe(200)
  expect(result.workspace.batches[0]).toEqual(snapshot)
  result = await post('save', 'sales', {
    id: 'sale',
    name: 'Market loaf',
    productId: 'loaf',
    batchId: 'run',
    quantity: 1,
    amount: 11,
    date: '2026-10-28',
    tax: 999,
  })
  expect(result.status).toBe(200)
  const sale = result.workspace.sales[0]
  expect(sale.amount).toBe(10)
  expect(sale.tax).toBe(1.2)
  expect(sale.customerTotal).toBe(11.2)
  expect(sale.taxSnapshot).toHaveLength(3)
  expect(sale.historicalCogs).toBeCloseTo(
    Math.round(batch.costSnapshot.perPackage * 100) / 100,
  )
  const journal = result.workspace.journals.find(
    (j: any) => j.sourceId === sale.id && j.name.startsWith('Sale:'),
  )
  expect(
    journal.lines
      .filter((l: any) => l.account === 'Sales Tax Payable')
      .reduce((s: number, l: any) => s + l.credit, 0),
  ).toBe(1.2)
  expect(
    journal.lines.find((l: any) => l.account === 'Sales revenue').credit,
  ).toBe(10)
  expect(
    journal.lines.reduce((s: number, l: any) => s + l.debit - l.credit, 0),
  ).toBeCloseTo(0)
  expect(
    (
      await post('save', 'settings', {
        id: 'business',
        name: 'Test bakery',
        taxRates: rates.map((r) => ({ ...r, ratePercent: 20 })),
      })
    ).status,
  ).toBe(200)
  expect(database.records.sales[0].taxSnapshot).toEqual(sale.taxSnapshot)
  expect((await post('save', 'sales', { ...sale, amount: 1 })).status).toBe(400)
  expect(
    (await post('complete', 'batches', { id: 'run', actualYield: 4 })).status,
  ).toBe(400)
  result = await post('refund', 'sales', { id: 'sale' })
  expect(result.status).toBe(200)
  const refund = result.workspace.sales.find((s: any) => s.refundOf === 'sale')
  expect(refund.tax).toBe(-1.2)
  expect(refund.taxSnapshot.map((r: any) => r.amount)).toEqual([
    -0.6, -0.4, -0.2,
  ])
  expect((await post('refund', 'sales', { id: 'sale' })).status).toBe(400)
  expect(
    database.queries
      .filter((q) => q.sql.startsWith('SELECT data'))
      .every(
        (q) =>
          q.sql.includes('business_id=$1') &&
          q.params[0] === 'private-business',
      ),
  ).toBe(true)
})
it('rolls back every stock change when packaging is short', async () => {
  database.records.ingredients = [
    { id: 'flour', name: 'Flour', unit: 'g', quantity: 1000, cost: 0.001 },
    {
      id: 'bag',
      name: 'Bag',
      usedAs: 'packaging',
      unit: 'each',
      quantity: 0,
      cost: 0.08,
    },
  ]
  database.records.recipes = [
    {
      id: 'bread',
      name: 'Bread',
      yield: 1,
      lines: [{ ingredientId: 'flour', quantity: 100, unit: 'g' }],
    },
  ]
  database.records.products = [
    {
      id: 'loaf',
      name: 'Loaf',
      recipeId: 'bread',
      unitsPerPackage: 1,
      packagingId: 'bag',
    },
  ]
  database.records.batches = [
    { id: 'b', name: 'Run', recipeId: 'bread', count: 1, status: 'scheduled' },
  ]
  const before = structuredClone(database.records)
  const result = await post('complete', 'batches', { id: 'b', actualYield: 1 })
  expect(result.status).toBe(400)
  expect(result.error).toContain('short')
  expect(database.records).toEqual(before)
})
it('persists a validated business appearance without replacing business settings', async () => {
  const result = await post('appearance', 'settings', {
    appearance: { theme: 'berry', mode: 'dark' },
    name: 'Untrusted replacement',
  })
  expect(result.status).toBe(200)
  expect(result.workspace.settings[0]).toMatchObject({
    name: 'Test bakery',
    appearance: { theme: 'berry', mode: 'dark' },
  })
  expect(database.records.settings[0].appearance).toEqual({
    theme: 'berry',
    mode: 'dark',
  })
  const invalid = await post('appearance', 'settings', {
    appearance: { theme: 'invalid', mode: 'dark' },
  })
  expect(invalid.status).toBe(400)
  expect(database.records.settings[0].appearance).toEqual({
    theme: 'berry',
    mode: 'dark',
  })
})
it('saves private editable labels, snapshots versions, rejects stale revisions and system overwrites', async () => {
  const { blankLabel, newElement } = await import('./label-studio')
  const document = {
    ...blankLabel(),
    id: 'my-label',
    name: 'Bread label',
    elements: [newElement('text', 'Bread')],
  }
  let result = await post('labelSave', 'label_templates', {
    document,
    expectedRevision: 0,
  })
  expect(result.status).toBe(200)
  expect(result.workspace.label_templates[0].revision).toBe(1)
  expect(result.workspace.label_versions).toHaveLength(1)
  expect(result.workspace.label_elements[0].templateId).toBe('my-label')
  result = await post('labelSave', 'label_templates', {
    document: { ...document, name: 'Updated' },
    expectedRevision: 1,
  })
  expect(result.status).toBe(200)
  expect(result.workspace.label_versions).toHaveLength(2)
  expect(result.workspace.label_versions[0].document.name).toBe('Bread label')
  expect(
    (
      await post('labelSave', 'label_templates', {
        document,
        expectedRevision: 0,
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await post('labelSave', 'label_templates', {
        document: { ...document, id: 'system-farmhouse' },
        expectedRevision: 0,
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await post('labelSave', 'label_templates', {
        document: {
          ...document,
          elements: [
            {
              ...document.elements[0],
              type: 'image',
              assetId: 'another-business',
            },
          ],
        },
        expectedRevision: 2,
      })
    ).status,
  ).toBe(400)
})
it('preserves the rendered label data and design at print preparation time', async () => {
  const { blankLabel, newElement } = await import('./label-studio')
  database.records.products = [
    {
      id: 'bread',
      name: 'Market loaf',
      recipeId: 'r',
      price: 8,
      netQuantity: 'Net Wt. 18 oz',
    },
  ]
  database.records.recipes = [
    { id: 'r', name: 'Bread', yield: 1, yieldUnit: 'loaf', lines: [] },
  ]
  const document = {
    ...blankLabel(),
    id: 'printable',
    name: 'Market label',
    elements: [newElement('text', '', 'product.name')],
  }
  expect(
    (
      await post('labelSave', 'label_templates', {
        document,
        expectedRevision: 0,
      })
    ).status,
  ).toBe(200)
  const result = await post('labelPrint', 'label_print_jobs', {
    templateId: 'printable',
    source: { kind: 'product', id: 'bread' },
    copies: 2,
    outputType: 'png',
  })
  expect(result.status).toBe(200)
  const job = result.workspace.label_print_jobs[0]
  expect(job.renderedDataSnapshot.values['product.name']).toBe('Market loaf')
  expect(job.documentSnapshot.elements[0].binding).toBe('product.name')
  database.records.products[0].name = 'New product name'
  expect(
    database.records.label_print_jobs[0].renderedDataSnapshot.values[
      'product.name'
    ],
  ).toBe('Market loaf')
  expect(
    (
      await post('labelPrint', 'label_print_jobs', {
        templateId: 'printable',
        source: { kind: 'product', id: 'foreign-product' },
        copies: 1,
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await post('labelPrint', 'label_print_jobs', {
        templateId: 'printable',
        source: { kind: 'product', id: 'bread' },
        copies: 0,
      })
    ).status,
  ).toBe(400)
})

it('stores original graphics privately and rejects unsafe upload formats', async () => {
  const sharp = (await import('sharp')).default
  const bytes = await sharp({
    create: {
      width: 20,
      height: 10,
      channels: 4,
      background: { r: 20, g: 30, b: 40, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer()
  const form = new FormData()
  form.set('file', new File([bytes], 'logo.png', { type: 'image/png' }))
  form.set('category', 'logo')
  form.set('collection', 'Bakery')
  const upload = await handler(
    new Request('https://cottage-pantry.test/api/workspace?upload=1', {
      method: 'POST',
      body: form,
    }),
    context,
  )
  expect(upload.status).toBe(200)
  const result = await upload.json(),
    asset = result.asset
  expect(asset).toMatchObject({
    widthPx: 20,
    heightPx: 10,
    fileType: 'image/png',
    category: 'logo',
    transparentBackground: true,
  })
  expect(labelFiles.has('private-business/' + asset.id)).toBe(true)
  const image = await handler(
    new Request('https://cottage-pantry.test' + asset.fileUrl),
    context,
  )
  expect(image.headers.get('Content-Type')).toBe('image/png')
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(
    new Uint8Array(bytes),
  )
  const foreign = await handler(
    new Request('https://cottage-pantry.test/api/workspace?asset=not-owned'),
    context,
  )
  expect(foreign.status).toBe(400)
  const unsafe = new FormData()
  unsafe.set(
    'file',
    new File(['<svg><script>alert(1)</script></svg>'], 'unsafe.svg', {
      type: 'image/svg+xml',
    }),
  )
  expect(
    (
      await handler(
        new Request('https://cottage-pantry.test/api/workspace?upload=1', {
          method: 'POST',
          body: unsafe,
        }),
        context,
      )
    ).status,
  ).toBe(400)
})
it('renders a dimensioned PDF on the server and records its exact source snapshot', async () => {
  const { blankLabel, newElement } = await import('./label-studio')
  database.records.products = [
    { id: 'bread', name: 'Country loaf', recipeId: 'r', price: 7 },
  ]
  database.records.recipes = [
    { id: 'r', name: 'Bread', yield: 1, yieldUnit: 'loaf', lines: [] },
  ]
  const document = {
    ...blankLabel(),
    id: 'server-pdf',
    name: 'Thermal label',
    width: 144,
    height: 72,
    elements: [
      {
        ...newElement('text', '', 'product.name'),
        width: 110,
        height: 25,
        fontSize: 10,
      },
    ],
  }
  expect(
    (
      await post('labelSave', 'label_templates', {
        document,
        expectedRevision: 0,
      })
    ).status,
  ).toBe(200)
  const response = await handler(
    new Request('https://cottage-pantry.test/api/workspace?labelPdf=1', {
      method: 'POST',
      body: JSON.stringify({
        templateId: 'server-pdf',
        source: { kind: 'product', id: 'bread' },
        copies: 1,
      }),
    }),
    context,
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toBe('application/pdf')
  expect(
    new TextDecoder().decode((await response.arrayBuffer()).slice(0, 5)),
  ).toBe('%PDF-')
  expect(database.records.label_print_jobs[0]).toMatchObject({
    status: 'exported',
    copies: 1,
    renderedDataSnapshot: { values: { 'product.name': 'Country loaf' } },
  })
})

it('posts a receipt inventory split atomically and prevents posting it twice', async () => {
  database.records.receipt_extractions = [
    {
      id: 'receipt',
      name: 'Original upload',
      status: 'draft',
      fileHash: 'saved-private-original',
      history: [],
    },
  ]
  database.records.ingredients = [
    {
      id: 'flour',
      name: 'Flour',
      unit: 'g',
      quantity: 1000,
      cost: 0.002,
      currentCost: 0.002,
    },
  ]
  const data = {
    id: 'receipt',
    vendor: 'The mill',
    date: '2026-10-29',
    subtotal: 20,
    tax: 1,
    total: 21,
    lines: [
      {
        description: 'Flour',
        amount: 10,
        quantity: 25,
        unit: 'lb',
        decision: 'inventory',
        itemId: 'flour',
      },
      { description: 'Personal', amount: 10, decision: 'personal' },
    ],
  }
  const result = await post('receiptPost', '', data)
  expect(result.status).toBe(200)
  expect(result.workspace.ingredients[0].quantity).toBeCloseTo(12339.80925)
  expect(result.workspace.ledger[0]).toMatchObject({
    receiptId: 'receipt',
    type: 'purchase_receipt',
    priorCost: 0.002,
  })
  expect(result.workspace.journals[0].lines).toContainEqual({
    account: 'Owner draws',
    debit: 10.5,
    credit: 0,
  })
  expect(result.workspace.receipt_extractions[0].fileHash).toBe(
    'saved-private-original',
  )
  const again = await post('receiptPost', '', data)
  expect(again.status).toBe(400)
  expect(database.records.ledger).toHaveLength(1)
})
it('rolls back a receipt when a later line references another oven', async () => {
  database.records.receipt_extractions = [
    { id: 'r', name: 'Receipt', status: 'draft', history: [] },
  ]
  database.records.ingredients = [
    { id: 'flour', name: 'Flour', unit: 'g', quantity: 0, cost: 0 },
  ]
  const result = await post('receiptPost', '', {
    id: 'r',
    vendor: 'Mill',
    date: '2026-10-29',
    subtotal: 20,
    tax: 0,
    total: 20,
    lines: [
      {
        description: 'Flour',
        amount: 10,
        quantity: 1,
        unit: 'lb',
        decision: 'inventory',
        itemId: 'flour',
      },
      {
        description: 'Other stock',
        amount: 10,
        quantity: 1,
        unit: 'each',
        decision: 'inventory',
        itemId: 'foreign-item',
      },
    ],
  })
  expect(result.status).toBe(400)
  expect(database.records.ingredients[0].quantity).toBe(0)
  expect(database.records.receipt_extractions[0].status).toBe('draft')
  expect(database.records.ledger).toBeUndefined()
  expect(database.records.journals).toBeUndefined()
})
it('keeps a consignment sale and payout separate from own-product revenue and expenses', async () => {
  database.records.consignors = [
    {
      id: 'maker',
      name: 'Local maker',
      commissionType: 'percentage',
      commissionRate: 10,
    },
  ]
  database.records.consignment_items = [
    {
      id: 'hat',
      name: 'Crocheted hat',
      consignorId: 'maker',
      available: 1,
      received: 1,
      sold: 0,
      returned: 0,
      price: 30,
    },
  ]
  const result = await post('consignmentSale', '', {
    itemId: 'hat',
    quantity: 1,
    gross: 30,
    tax: 2.4,
    date: '2026-10-29',
  })
  expect(result.status).toBe(200)
  expect(result.workspace.sales).toHaveLength(0)
  expect(result.workspace.consignment_sales[0].payable).toBe(27)
  const payout = await post('consignmentPayout', '', {
    consignorId: 'maker',
    amount: 27,
    date: '2026-10-29',
    method: 'Cash',
  })
  expect(payout.status).toBe(200)
  expect(payout.workspace.expenses).toHaveLength(0)
  expect(payout.workspace.consignment_sales[0].status).toBe('paid')
  expect(payout.workspace.consignment_payouts[0].allocations[0].applied).toBe(
    27,
  )
})
it('records a multi-product sale once, snapshots each tax calculation, and rejects a retry', async () => {
  database.records.ingredients = [
    { id: 'flour', name: 'Flour', unit: 'g', quantity: 1000, cost: 0.01 },
  ]
  database.records.recipes = [
    {
      id: 'r',
      name: 'Loaf',
      yield: 1,
      laborMinutes: 0,
      laborRate: 0,
      overhead: 0,
      wastePercent: 0,
      lines: [{ ingredientId: 'flour', quantity: 100, unit: 'g' }],
    },
  ]
  database.records.products = [
    {
      id: 'loaf',
      name: 'Loaf',
      recipeId: 'r',
      price: 10,
      unitsPerPackage: 1,
      packagingLines: [],
      taxStatus: 'taxable',
    },
  ]
  database.records.settings = [
    {
      id: 'business',
      name: 'Bakery',
      taxRates: [
        {
          id: 'state',
          name: 'State',
          jurisdiction: 'State',
          jurisdictionType: 'state',
          ratePercent: 10,
          order: 1,
          behavior: 'exclusive',
          active: true,
          appliesTo: 'all_products',
        },
      ],
    },
  ]
  const data = {
    requestId: 'unique-sale-request',
    date: '2026-10-29',
    channel: 'Market',
    fees: 1,
    method: 'Card',
    saleLines: [
      { productId: 'loaf', quantity: 1, amount: 10, discounts: 0 },
      { productId: 'loaf', quantity: 2, amount: 20, discounts: 0 },
    ],
  }
  const result = await post('simpleSale', '', data)
  expect(result.status).toBe(200)
  expect(result.workspace.sales).toHaveLength(2)
  expect(result.workspace.finance_transactions[0]).toMatchObject({
    revenue: 30,
    tax: 3,
    amount: 33,
    fees: 1,
  })
  expect(result.workspace.sales[0].taxSnapshot[0].amount).toBe(1)
  expect(
    result.workspace.sales.reduce((a: number, s: any) => a + s.fees, 0),
  ).toBe(1)
  const again = await post('simpleSale', '', data)
  expect(again.status).toBe(400)
  expect(database.records.sales).toHaveLength(2)
})
it('creates a newly reviewed pantry item before its inventory movement foreign key', async () => {
  database.records.receipt_extractions = [
    { id: 'r', name: 'Receipt', status: 'draft', history: [] },
  ]
  const result = await post('receiptPost', '', {
    id: 'r',
    vendor: 'Packaging shop',
    date: '2026-10-29',
    subtotal: 8,
    tax: 0,
    total: 8,
    lines: [
      {
        description: 'Bread bags',
        amount: 8,
        quantity: 100,
        unit: 'each',
        decision: 'inventory',
        createNew: true,
        usedAs: 'packaging',
      },
    ],
  })
  expect(result.status).toBe(200)
  const item = result.workspace.ingredients[0]
  expect(item).toMatchObject({
    name: 'Bread bags',
    usedAs: 'packaging',
    quantity: 100,
    cost: 0.08,
  })
  const ingredientInsert = database.queries.findIndex((q) =>
    q.sql.startsWith('INSERT INTO ingredients('),
  )
  const ledgerInsert = database.queries.findIndex((q) =>
    q.sql.startsWith('INSERT INTO ledger('),
  )
  expect(ingredientInsert).toBeGreaterThan(-1)
  expect(ledgerInsert).toBeGreaterThan(ingredientInsert)
  expect(result.workspace.ledger[0].ingredientId).toBe(item.id)
})

it('persists actual PNG, JPG and multipage PDF originals and reopens private previews without posting', async () => {
  const sharp = (await import('sharp')).default
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  pdf.addPage()
  pdf.addPage()
  const png = await sharp({
    create: { width: 100, height: 100, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer()
  const jpg = await sharp(png).jpeg().toBuffer()
  for (const [name, bytes] of [
    ['receipt.png', png],
    ['receipt.jpg', jpg],
    ['receipt.pdf', await pdf.save()],
  ] as const) {
    const form = new FormData()
    form.set('file', new File([new Uint8Array(bytes)], name))
    const upload = await handler(
      new Request('https://cottage-pantry.test/api/workspace?receiptUpload=1', {
        method: 'POST',
        body: form,
      }),
      context,
    )
    expect(upload.status).toBe(200)
    const { receipt } = await upload.json()
    expect(receipt.total).toBeNull()
    expect(receipt.extractionStatus).toBe('queued')
    expect(receipt.originalObjectKey).toBe(
      `private-business/${receipt.id}/original`,
    )
    for (const original of [false, true]) {
      const reopened = await handler(
        new Request(
          `https://cottage-pantry.test/api/workspace?receiptFile=${receipt.id}${original ? '&original=1' : ''}`,
        ),
        context,
      )
      expect(reopened.status).toBe(200)
      expect(reopened.headers.get('cache-control')).toBe('private, no-store')
      const body = new Uint8Array(await reopened.arrayBuffer())
      if (original) expect(body).toEqual(new Uint8Array(bytes))
      else expect(body.length).toBeGreaterThan(0)
    }
    const duplicate = await handler(
      new Request('https://cottage-pantry.test/api/workspace?receiptUpload=1', {
        method: 'POST',
        body: form,
      }),
      context,
    )
    expect(duplicate.status).not.toBe(200)
  }
  expect(database.records.finance_transactions || []).toHaveLength(0)
  expect(database.records.ledger || []).toHaveLength(0)
})

it('preserves manual edits, original bytes and previous attempts when retrying extraction', async () => {
  const sharp = (await import('sharp')).default
  const bytes = await sharp({
    create: { width: 100, height: 100, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer()
  const form = new FormData()
  form.set('file', new File([new Uint8Array(bytes)], 'original.png'))
  const uploaded = await handler(
    new Request('https://cottage-pantry.test/api/workspace?receiptUpload=1', {
      method: 'POST',
      body: form,
    }),
    context,
  )
  const { receipt } = await uploaded.json()
  await post('receiptDraft', '', {
    id: receipt.id,
    vendor: 'My correction',
    subtotal: null,
    tax: null,
    total: null,
  })
  receiptProvider.generate.mockResolvedValue({
    text: JSON.stringify({
      vendor: 'Printed merchant',
      total: 12,
      lines: [{ description: 'Flour', amount: 12 }],
    }),
  })
  let result = await post('receiptExtract', '', {
    id: receipt.id,
    preserveEdits: true,
  })
  expect(result.status).toBe(200)
  let draft = result.workspace.receipt_extractions[0]
  expect(draft.vendor).toBe('My correction')
  expect(draft.total).toBeNull()
  expect(draft.pendingExtraction.vendor).toBe('Printed merchant')
  expect(
    receiptProvider.generate.mock.calls.at(-1)![0].contents[0].parts[0]
      .inlineData.data,
  ).toBe(bytes.toString('base64'))
  expect(draft.extractionAttempts).toHaveLength(1)
  result = await post('receiptDismissExtraction', '', { id: receipt.id })
  expect(result.workspace.receipt_extractions[0].vendor).toBe('My correction')
  receiptProvider.generate.mockRejectedValue({ status: 503 })
  result = await post('receiptExtract', '', {
    id: receipt.id,
    preserveEdits: true,
  })
  draft = result.workspace.receipt_extractions[0]
  expect(draft.extractionStatus).toBe('failed')
  expect(draft.vendor).toBe('My correction')
  expect(draft.extractionAttempts).toHaveLength(2)
  receiptProvider.generate.mockRejectedValue(new Error('API key must be set'))
  result = await post('receiptExtract', '', {
    id: receipt.id,
    preserveEdits: true,
  })
  expect(result.workspace.receipt_extractions[0].extractionStatus).toBe(
    'not_configured',
  )
  expect(database.records.finance_transactions || []).toHaveLength(0)
})

it('attaches a receipt to an existing purchase without another posting and prevents reopening it', async () => {
  database.records.finance_transactions = [
    {
      id: 'existing-expense',
      name: 'Shop supplies',
      kind: 'expense',
      date: '2026-10-29',
      amount: 12,
      status: 'posted',
    },
  ]
  database.records.receipt_extractions = [
    { id: 'attach', name: 'Receipt', status: 'draft', total: 12, history: [] },
  ]
  const result = await post('receiptMatch', '', {
    id: 'attach',
    transactionId: 'existing-expense',
  })
  expect(result.status).toBe(200)
  expect(result.workspace.receipt_extractions[0]).toMatchObject({
    status: 'attached',
    matchedTransactionId: 'existing-expense',
  })
  expect(result.workspace.finance_transactions).toHaveLength(1)
  expect(result.workspace.journals).toHaveLength(0)
  expect((await post('receiptPost', '', { id: 'attach' })).status).toBe(400)
  expect(
    (await post('receiptDraft', '', { id: 'attach', total: 15 })).status,
  ).toBe(400)
})
it('edits ingredient references without receiving stock, creating journals or changing historical snapshots', async () => {
  await post('save', 'ingredients', {
    id: 'flour',
    name: 'Flour',
    purchaseQuantity: 25,
    purchaseUnit: 'lb',
    packagePrice: 10.95,
    unit: 'oz',
    threshold: 16,
    usedAs: 'ingredient',
    reviewed: true,
    allergens: ['Wheat'],
  })
  const original = structuredClone(database.records.ingredients[0]),
    ledger = structuredClone(database.records.ledger),
    journals = structuredClone(database.records.journals)
  const result = await post('ingredientUpdate', 'ingredients', {
    id: 'flour',
    expectedUpdatedAt: original.updatedAt,
    name: 'Bread flour',
    packagePrice: 12,
    storageUnit: 'lb',
    threshold: 1,
    reorderQuantity: 25,
    barcode: '0012345',
    reviewed: true,
    quantity: 999999,
    cost: 999,
    unit: 'lb',
  })
  expect(result.status).toBe(200)
  const saved = result.workspace.ingredients[0]
  expect(saved.quantity).toBe(original.quantity)
  expect(saved.cost).toBe(original.cost)
  expect(saved.unit).toBe(original.unit)
  expect(saved.threshold).toBeCloseTo(453.59237)
  expect(saved.currentCost).toBeCloseTo(12 / 11339.80925)
  expect(saved.barcode).toBe('0012345')
  expect(database.records.ledger).toEqual(ledger)
  expect(database.records.journals).toEqual(journals)
  const stale = await post('ingredientUpdate', 'ingredients', {
    id: 'flour',
    expectedUpdatedAt: original.updatedAt,
    name: 'Stale',
  })
  expect(stale.status).toBe(400)
})
it('keeps store offers, preferred vendors, and confirmed reference changes separate', async () => {
  await post('save', 'ingredients', {
    id: 'flour',
    name: 'Flour',
    purchaseQuantity: 25,
    purchaseUnit: 'lb',
    packagePrice: 10.95,
    unit: 'lb',
    threshold: 1,
    usedAs: 'ingredient',
    vendor: 'Original',
    brand: 'Original brand',
    reviewed: true,
    allergens: ['Wheat'],
  })
  database.records.vendors = [{ id: 'store-b', name: 'Store B' }]
  let original = database.records.ingredients[0]
  const cost = original.currentCost,
    qty = original.quantity,
    value = original.cost,
    ledgerCount = database.records.ledger.length,
    journalCount = database.records.journals.length
  let result = await post('ingredientOffer', 'ingredients', {
    id: 'flour',
    expectedUpdatedAt: original.updatedAt,
    operation: 'save',
    offer: {
      id: 'offer',
      vendorId: 'store-b',
      brand: 'Different brand',
      purchaseQuantity: 10,
      purchaseUnit: 'lb',
      packagePrice: 4,
      priceCheckedAt: '2026-10-30',
      includesTax: false,
      includesShipping: false,
    },
  })
  expect(result.status).toBe(200)
  original = result.workspace.ingredients[0]
  expect(original.currentCost).toBe(cost)
  result = await post('ingredientOffer', 'ingredients', {
    id: 'flour',
    expectedUpdatedAt: original.updatedAt,
    operation: 'preferred',
    offerId: 'offer',
  })
  expect(result.status).toBe(200)
  original = result.workspace.ingredients[0]
  expect(original.vendor).toBe('Store B')
  expect(original.currentCost).toBe(cost)
  expect(original.referenceVendor).toBe('Original')
  result = await post('ingredientOffer', 'ingredients', {
    id: 'flour',
    expectedUpdatedAt: original.updatedAt,
    operation: 'reference',
    offerId: 'offer',
  })
  expect(result.status).toBe(400)
  result = await post('ingredientOffer', 'ingredients', {
    id: 'flour',
    expectedUpdatedAt: original.updatedAt,
    operation: 'reference',
    offerId: 'offer',
    confirmed: true,
  })
  expect(result.status).toBe(200)
  expect(result.workspace.ingredients[0]).toMatchObject({
    quantity: qty,
    cost: value,
    reviewed: false,
    referenceOfferId: 'offer',
  })
  expect(result.workspace.ingredients[0].currentCost).toBeCloseTo(4 / 4535.9237)
  expect(database.records.ledger).toHaveLength(ledgerCount)
  expect(database.records.journals).toHaveLength(journalCount)
})
it('persists a private per-user pantry sort preference', async () => {
  const result = await post('pantrySort', 'settings', {
    key: 'quantity',
    direction: 'desc',
  })
  expect(result.status).toBe(200)
  expect(result.workspace.settings[0].currentPantrySort).toEqual({
    key: 'quantity',
    direction: 'desc',
  })
  expect(result.workspace.settings[0].pantrySortPreferences).toBeUndefined()
  expect(
    database.records.settings[0].pantrySortPreferences['verified-owner'],
  ).toEqual({ key: 'quantity', direction: 'desc' })
})
it('receives a defined case into a physical storage unit without guessing case contents', async () => {
  const result = await post('save', 'ingredients', {
    id: 'case-flour',
    name: 'Case flour',
    purchaseQuantity: 1,
    purchaseUnit: 'case',
    packagePrice: 10.95,
    unit: 'oz',
    threshold: 16,
    usedAs: 'ingredient',
    conversions: [
      { from: 'case', to: 'lb', amountFrom: 1, amountTo: 25, verified: true },
    ],
  })
  expect(result.status).toBe(200)
  expect(result.workspace.ingredients[0].unit).toBe('g')
  expect(result.workspace.ingredients[0].quantity).toBeCloseTo(11339.80925)
  expect(
    result.workspace.ingredients[0].currentCost * 28.349523125,
  ).toBeCloseTo(0.027375)
  const failed = await post('save', 'ingredients', {
    id: 'unknown',
    name: 'Unknown case',
    purchaseQuantity: 1,
    purchaseUnit: 'case',
    packagePrice: 10,
    unit: 'oz',
    threshold: 1,
  })
  expect(failed.status).toBe(400)
  expect(database.records.ingredients.some((i) => i.id === 'unknown')).toBe(
    false,
  )
})
it('scopes printer profiles to the current device and hides private maps', async () => {
  const result = await post('labelPrinterProfile', 'settings', {
    operation: 'save',
    profile: {
      name: 'Thermal test',
      method: 'browser',
      width: 2,
      height: 1,
      unit: 'in',
      orientation: 'landscape',
      offsetX: 0,
      offsetY: 0,
      preferred: true,
    },
  })
  expect(result.status).toBe(200)
  expect(result.workspace.settings[0].currentPrinterProfiles).toHaveLength(1)
  expect(result.workspace.settings[0].printerProfilesByDevice).toBeUndefined()
  const other = await handler(
    new Request('https://cottage-pantry.test/api/workspace'),
    {
      cookies: {
        get: (name: string) =>
          name === 'cp_print_device' ? 'b'.repeat(64) : undefined,
      },
    } as unknown as Context,
  )
  expect(
    (await other.json()).workspace.settings[0].currentPrinterProfiles,
  ).toEqual([])
})
it('saves exact committed alpha colors and preserves named Brand Kit swatches', async () => {
  database.records.brand_kits = [
    { id: 'brand', name: 'Brand', colors: ['#000000'] },
  ]
  const color = { hex: '#71315f', opacity: 0.42 }
  expect(
    (
      await post('labelBrandColor', 'brand_kits', {
        brandId: 'brand',
        color,
        name: 'Plum ink',
      })
    ).status,
  ).toBe(200)
  const result = await post('labelColorRecent', 'settings', { color })
  expect(result.status).toBe(200)
  expect(result.workspace.settings[0].currentLabelColors).toEqual([color])
  expect(result.workspace.settings[0].labelColorPreferences).toBeUndefined()
  expect(database.records.brand_kits[0].colorSwatches).toContainEqual({
    ...color,
    name: 'Plum ink',
  })
  expect(
    (
      await post('labelColorRecent', 'settings', {
        color: { hex: '#71315f', opacity: 2 },
      })
    ).status,
  ).toBe(400)
})
it('authorizes a prepared direct test job once and ignores caller-supplied print data', async () => {
  const { generateKeyPairSync } = await import('node:crypto')
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  vi.stubEnv('QZ_CERTIFICATE', 'test public certificate')
  vi.stubEnv(
    'QZ_PRIVATE_KEY',
    privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  )
  try {
    const saved = await post('labelPrinterProfile', 'settings', {
      operation: 'save',
      profile: {
        name: 'Approved printer',
        method: 'qz',
        width: 2,
        height: 1,
        unit: 'in',
        orientation: 'landscape',
        offsetX: 0,
        offsetY: 0,
      },
    })
    const request = async (query: string, body: any) =>
      handler(
        new Request('https://cottage-pantry.test/api/workspace?' + query, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
        context,
      )
    const test = await request('printerTest=1', {
      profileId: saved.workspace.settings[0].currentPrinterProfiles[0].id,
    })
    expect(test.status, JSON.stringify(await test.clone().json())).toBe(200)
    const { jobId } = await test.json()
    const body = {
      operation: 'print',
      jobId,
      params: { printer: { name: 'Unapproved printer' }, data: ['arbitrary'] },
    }
    const first = await request('printerSign=1', body)
    expect(first.status).toBe(200)
    const signed = await first.json()
    expect(signed.params.printer.name).toBe('Approved printer')
    expect(signed.params.options.copies).toBe(1)
    expect(
      Buffer.from(signed.params.data[0].data, 'base64')
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-')
    const repeated = await request('printerSign=1', body)
    expect(repeated.status).toBe(400)
    expect((await repeated.json()).error).toMatch(/already authorized/)
  } finally {
    vi.unstubAllEnvs()
  }
})
it('edits a legacy ingredient with no purchase package without inventing cost or stock activity', async () => {
  const ingredient = {
    id: 'legacy-flour',
    name: 'Legacy flour',
    unit: 'g',
    storageUnit: 'lb',
    cost: 0.001,
    currentCost: 0.002,
    quantity: 1000,
    threshold: 0,
    allergens: ['Wheat'],
    reviewed: true,
    barcode: '001234',
  }
  database.records.ingredients = [ingredient]
  const result = await post('ingredientUpdate', 'ingredients', {
    id: ingredient.id,
    name: 'Updated flour',
    purchaseQuantity: '',
    packagePrice: '',
    purchaseUnit: '',
    storageUnit: 'lb',
    recipeUnit: 'g',
    threshold: 0,
    reorderQuantity: 0,
    reviewed: true,
  })
  expect(result.status).toBe(200)
  expect(result.workspace.ingredients[0]).toMatchObject({
    ...ingredient,
    name: 'Updated flour',
  })
  expect(result.workspace.ingredients[0].purchaseQuantity).toBeUndefined()
  expect(result.workspace.ingredients[0].packagePrice).toBeUndefined()
  expect(result.workspace.ledger).toHaveLength(0)
  expect(result.workspace.journals).toHaveLength(0)
  expect(result.workspace.ingredients[0].costReferenceHistory).toBeUndefined()
})
async function priceRequest(id: string, body?: any) {
  const response = await handler(
    new Request(
      'https://cottage-pantry.test/api/workspace?priceSearch=' + id,
      body ? { method: 'POST', body: JSON.stringify(body) } : {},
    ),
    context,
  )
  return { status: response.status, ...(await response.json()) }
}
it('defaults Pantry to cards and persists the authenticated user’s explicit table preference', async () => {
  let response = await handler(
    new Request('https://cottage-pantry.test/api/workspace'),
    context,
  )
  expect((await response.json()).workspace.settings[0].currentPantryView).toBe(
    'cards',
  )
  const result = await post('pantryView', 'settings', { view: 'table' })
  expect(result.status).toBe(200)
  expect(result.workspace.settings[0].currentPantryView).toBe('table')
  expect(result.workspace.settings[0].pantryViewPreferences).toBeUndefined()
})
it('retains vendor, price, source, approved quote and history data with shopping search disabled', async () => {
  vi.stubGlobal('Netlify', { env: { get: () => undefined } })
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  database.records.vendors = [{ id: 'v', name: 'Preferred store' }]
  database.records.ingredients = [
    {
      id: 'flour',
      name: 'Flour',
      unit: 'g',
      quantity: 100,
      cost: 0.02,
      vendor: 'Preferred store',
      referenceVendor: 'Verified quote',
      purchaseQuantity: 1,
      purchaseUnit: 'kg',
      packagePrice: 20,
      productSourceUrl: 'https://store.example/flour',
      conversions: [
        { from: 'cup', to: 'g', amountFrom: 1, amountTo: 120, verified: true },
      ],
      purchaseOffers: [
        {
          id: 'approved',
          vendorId: 'v',
          vendor: 'Preferred store',
          source: 'connected_provider',
          provider: 'SerpApi',
          productUrl: 'https://store.example/flour',
          purchaseQuantity: 1,
          purchaseUnit: 'kg',
          packagePrice: 18,
        },
      ],
      costReferenceHistory: [{ packagePrice: 19 }],
    },
  ]
  database.records.ledger = [
    { id: 'receipt', ingredientId: 'flour', quantity: 100, amount: 2 },
  ]
  database.records.journals = [
    { id: 'posted', name: 'Prior posting', status: 'posted' },
  ]
  const before = structuredClone(database.records)
  try {
    const response = await handler(
      new Request('https://cottage-pantry.test/api/workspace'),
      context,
    )
    expect(response.status).toBe(200)
    const { workspace } = await response.json()
    for (const table of ['ingredients', 'vendors', 'ledger', 'journals']) {
      expect(
        table === 'ingredients'
          ? workspace[table].map(({ inventoryRevision, ...item }: any) => item)
          : workspace[table],
      ).toEqual(before[table])
      expect(database.records[table]).toEqual(before[table])
    }
    expect(fetcher).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})
it('reports missing price setup without changing ingredients, stock or journals', async () => {
  vi.stubGlobal('Netlify', shoppingRuntime())
  try {
    database.records.ingredients = [
      {
        id: 'flour',
        name: 'Bread flour',
        brand: 'Example Mills',
        unit: 'g',
        quantity: 20,
        cost: 0.01,
      },
    ]
    const original = structuredClone(database.records.ingredients)
    expect((await priceRequest('flour')).configured).toBe(false)
    const result = await priceRequest('flour', {
      operation: 'search',
      query: 'Example Mills Bread flour',
    })
    expect(result.status).toBe(503)
    expect(result.error).toBe(
      'Missing configuration. Price comparison isn’t configured.',
    )
    expect(database.records.ingredients).toEqual(original)
    expect(database.records.inventory_transactions || []).toEqual([])
    expect(database.records.journal_entries || []).toEqual([])
    expect((await priceRequest('other-business-ingredient')).status).toBe(400)
  } finally {
    vi.unstubAllGlobals()
  }
})
it('caches actual provider results and saves a quote separately from cost and inventory', async () => {
  vi.stubGlobal('Netlify', shoppingRuntime('test-credential'))
  const fetcher = vi.fn(async () =>
    Response.json({
      shopping_results: [
        {
          title: 'Example Mills Bread flour 10 lb',
          brand: 'Example Mills',
          source: 'Test store',
          extracted_price: 4,
          price: '$4.00',
          link: 'https://retailer.example/flour',
        },
      ],
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  try {
    database.records.ingredients = [
      {
        id: 'flour',
        name: 'Bread flour',
        brand: 'Example Mills',
        unit: 'g',
        storageUnit: 'lb',
        quantity: 20,
        cost: 0.01,
        currentCost: 0.02,
        purchaseQuantity: 25,
        purchaseUnit: 'lb',
        packagePrice: 10.95,
        includesTax: false,
        includesShipping: false,
        currency: 'USD',
      },
    ]
    const original = structuredClone(database.records.ingredients[0]),
      query = {
        operation: 'search',
        query: 'Example Mills Bread flour',
        preference: 'both',
      }
    const result = await priceRequest('flour', query)
    expect(result.status).toBe(200)
    expect(result.cache.offers).toHaveLength(1)
    expect(database.records.ingredients[0]).toEqual(original)
    const cached = await priceRequest('flour', query)
    expect(cached.cached).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(
      (
        await priceRequest('flour', {
          operation: 'save',
          offerId: 'caller-invented-price',
        })
      ).status,
    ).toBe(400)
    const saved = await priceRequest('flour', {
      operation: 'save',
      offerId: result.cache.offers[0].id,
      price: 0.01,
    })
    expect(saved.status).toBe(200)
    expect(database.records.ingredients[0].purchaseOffers[0]).toMatchObject({
      packagePrice: 4,
      source: 'connected_provider',
      provider: 'SerpApi',
    })
    const { purchaseOffers, createdBy, updatedBy, updatedAt, ...unchanged } =
      database.records.ingredients[0]
    expect(unchanged).toEqual(original)
    expect(database.records.inventory_transactions || []).toEqual([])
    expect(database.records.journal_entries || []).toEqual([])
    expect(database.records.activity.at(-1).type).toBe('priceSearchOffer')
    expect(
      (await priceRequest('flour', { ...query, refresh: true })).error,
    ).toMatch(/wait/)
    expect(fetcher).toHaveBeenCalledTimes(1)
  } finally {
    vi.unstubAllGlobals()
  }
})
it('keeps stale results visible and consumes quota on an unavailable provider', async () => {
  vi.stubGlobal('Netlify', shoppingRuntime('test-credential'))
  vi.stubGlobal('fetch', async () => new Response('', { status: 503 }))
  try {
    database.records.ingredients = [
      { id: 'flour', name: 'Bread flour', unit: 'g', quantity: 20, cost: 0.01 },
    ]
    const previous = {
      checkedAt: new Date(Date.now() - 7200000).toISOString(),
      offers: [],
      request: {
        query: 'Bread flour',
        zip: '',
        preference: 'both',
        alternativeBrands: false,
      },
    }
    database.records.settings[0].priceSearchCaches = { flour: previous }
    const result = await priceRequest('flour', {
      operation: 'search',
      query: 'Bread flour',
    })
    expect(result.status).toBe(502)
    expect(database.records.settings[0].priceSearchCaches.flour).toEqual(
      previous,
    )
    expect(database.records.settings[0].priceSearchRequests).toHaveLength(1)
    expect(database.records.ingredients[0].cost).toBe(0.01)
    expect(database.records.ingredients[0].quantity).toBe(20)
    expect(
      (await priceRequest('flour', { operation: 'save', offerId: 'expired' }))
        .error,
    ).toMatch(/expired/)
  } finally {
    vi.unstubAllGlobals()
  }
})
async function recipeImportRequest(body?: any) {
  const response = await handler(
    new Request(
      'https://cottage-pantry.test/api/workspace?recipeImports=1',
      body instanceof FormData
        ? { method: 'POST', body }
        : body
          ? { method: 'POST', body: JSON.stringify(body) }
          : {},
    ),
    context,
  )
  return { status: response.status, ...(await response.json()) }
}
it('keeps pasted imports separate, then atomically approves confirmed Pantry lines exactly once', async () => {
  database.records.ingredients = [
    {
      id: 'flour',
      name: 'Bread flour',
      aliases: ['strong flour'],
      unit: 'g',
      quantity: 1000,
      cost: 0.01,
      usedAs: 'ingredient',
    },
  ]
  const before = structuredClone(database.records.ingredients)
  const created = await recipeImportRequest({
    operation: 'create',
    kind: 'text',
    text: 'Imported bread\nYield: 2 loaves\nPrep time: 15 minutes\nCook time: 30 minutes\nIngredients:\nDough:\n100 g strong flour\nInstructions:\n1. Mix.\n2. Bake.',
  })
  expect(created.status).toBe(200)
  const record = created.imports[0]
  expect(record.draft.lines[0]).toMatchObject({
    ingredientId: 'flour',
    confirmed: false,
    group: 'Dough',
  })
  expect(database.records.recipes).toHaveLength(0)
  expect(database.records.ingredients).toEqual(before)
  expect((await recipeImportRequest()).imports[0].summary).toBe(true)
  const draft = {
    ...record.draft,
    lines: record.draft.lines.map((l: any) => ({ ...l, confirmed: true })),
  }
  const request = {
    operation: 'approve',
    id: record.id,
    draft,
    expectedUpdatedAt: record.updatedAt,
  }
  const approved = await recipeImportRequest(request)
  expect(approved.status).toBe(200)
  expect(database.records.recipes).toHaveLength(1)
  expect(database.records.recipes[0]).toMatchObject({
    yield: 2,
    laborMinutes: 0,
    prepMinutes: 15,
    cookMinutes: 30,
    instructions: 'Mix.\n\nBake.',
  })
  expect(
    database.queries.filter((q) =>
      q.sql.startsWith('INSERT INTO recipe_lines'),
    ),
  ).toHaveLength(1)
  expect(database.records.ingredients).toEqual(before)
  expect(database.records.ledger || []).toEqual([])
  expect(database.records.journals || []).toEqual([])
  expect((await recipeImportRequest(request)).alreadyApproved).toBe(true)
  expect(database.records.recipes).toHaveLength(1)
})
it('saves missing-yield and unresolved drafts, cancels without creating recipes, and scopes sources', async () => {
  const created = await recipeImportRequest({
      operation: 'create',
      kind: 'text',
      text: 'Unfinished\nIngredients:\n2 cups flour\nInstructions:\nMix.',
    }),
    r = created.imports[0]
  expect(r.draft.yieldQuantity).toBeNull()
  expect(
    (
      await recipeImportRequest({
        operation: 'approve',
        id: r.id,
        draft: r.draft,
        expectedUpdatedAt: r.updatedAt,
      })
    ).status,
  ).toBe(400)
  const saved = await recipeImportRequest({
    operation: 'save',
    id: r.id,
    draft: { ...r.draft, title: 'Saved draft' },
    expectedUpdatedAt: r.updatedAt,
  })
  expect(saved.status).toBe(200)
  expect(
    (
      await recipeImportRequest({
        operation: 'cancel',
        id: r.id,
        expectedUpdatedAt: saved.import.updatedAt,
      })
    ).status,
  ).toBe(200)
  expect(database.records.recipes).toHaveLength(0)
  expect(database.records.ingredients).toHaveLength(0)
  const response = await handler(
    new Request(
      'https://cottage-pantry.test/api/workspace?recipeImportFile=another-workspace',
    ),
    context,
  )
  expect(response.status).toBe(400)
})
it('requires explicit duplicate decisions, keeps existing recipes intact, and creates reviewed versions', async () => {
  const existing = {
    id: 'old',
    name: 'Bread',
    yield: 1,
    yieldUnit: 'loaf',
    lines: [],
    instructions: 'Old instructions',
  }
  database.records.recipes = [existing]
  database.records.ingredients = [
    { id: 'flour', name: 'Flour', unit: 'g', quantity: 10, cost: 0.01 },
  ]
  const {
    imports: [r],
  } = await recipeImportRequest({
    operation: 'create',
    kind: 'text',
    text: 'Bread\nYield: 2 loaves\nIngredients:\n100 g flour\nInstructions:\nNew instructions',
  })
  const draft = {
      ...r.draft,
      lines: r.draft.lines.map((l: any) => ({ ...l, confirmed: true })),
    },
    request = {
      operation: 'approve',
      id: r.id,
      draft,
      expectedUpdatedAt: r.updatedAt,
    }
  expect((await recipeImportRequest(request)).error).toMatch(/duplicate/)
  expect(
    (
      await recipeImportRequest({
        ...request,
        duplicateDecision: 'version',
        targetRecipeId: 'old',
      })
    ).status,
  ).toBe(200)
  expect(database.records.recipes.find((r) => r.id === 'old')).toEqual(existing)
  expect(
    database.records.recipes.find((r) => r.id !== 'old').supersedesRecipeId,
  ).toBe('old')
})
it('creates approved new ingredients with no purchase, stock or invented price and rolls back invalid matches', async () => {
  const {
    imports: [r],
  } = await recipeImportRequest({
    operation: 'create',
    kind: 'text',
    text: 'New filling\nYield: 1 batch\nIngredients:\n100 g new ingredient\n20 g another ingredient',
  })
  let draft = {
    ...r.draft,
    lines: r.draft.lines.map((l: any) => ({
      ...l,
      decision: 'new',
      confirmed: true,
    })),
  }
  const invalid = {
    ...draft,
    lines: [
      draft.lines[0],
      {
        ...draft.lines[1],
        decision: 'match',
        ingredientId: 'foreign-ingredient',
      },
    ],
  }
  expect(
    (
      await recipeImportRequest({
        operation: 'approve',
        id: r.id,
        draft: invalid,
        expectedUpdatedAt: r.updatedAt,
      })
    ).status,
  ).toBe(400)
  expect(database.records.ingredients).toHaveLength(0)
  expect(database.records.recipes).toHaveLength(0)
  expect(
    (
      await recipeImportRequest({
        operation: 'approve',
        id: r.id,
        draft,
        expectedUpdatedAt: r.updatedAt,
      })
    ).status,
  ).toBe(200)
  expect(database.records.ingredients).toHaveLength(2)
  for (const i of database.records.ingredients)
    expect(i).toMatchObject({
      quantity: 0,
      packagePrice: null,
      purchaseQuantity: null,
      currentCost: null,
      needsCostSetup: true,
      reviewed: false,
    })
  expect(database.records.recipes[0].importCostIssues).toBe(2)
  expect(database.records.ledger || []).toEqual([])
  expect(database.records.journals || []).toEqual([])
})
it('retains uploaded originals and manual review when recipe OCR is unconfigured', async () => {
  const { PDFDocument } = await import('pdf-lib'),
    pdf = await PDFDocument.create()
  pdf.addPage()
  const form = new FormData()
  form.set(
    'file',
    new File([new Uint8Array(await pdf.save())], 'Recipe.pdf', {
      type: 'application/pdf',
    }),
  )
  receiptProvider.generate.mockRejectedValueOnce(
    new Error('API key must be set'),
  )
  const created = await recipeImportRequest(form)
  expect(created.status).toBe(200)
  const r = created.imports[0]
  expect(r.status).toBe('not_configured')
  expect(r.error).toMatch(/Recipe extraction is not configured/)
  expect(r.draft.lines).toEqual([])
  expect(r.draft.yieldQuantity).toBeNull()
  const original = await handler(
    new Request(
      'https://cottage-pantry.test/api/workspace?recipeImportFile=' + r.id,
    ),
    context,
  )
  expect(original.status).toBe(200)
  expect(original.headers.get('content-type')).toBe('application/pdf')
  expect(
    new TextDecoder().decode((await original.arrayBuffer()).slice(0, 5)),
  ).toBe('%PDF-')
  expect(database.records.recipes).toHaveLength(0)
})
it('links, retries and unlinks an existing product through the authorized API without stock, price or history changes', async () => {
  database.records.recipes = [
    {
      id: 'recipe-link',
      name: 'Bread',
      yield: 4,
      yieldUnit: 'loaves',
      lines: [],
    },
  ]
  database.records.products = [
    {
      id: 'existing-product',
      name: 'Bread pack',
      sku: 'B001',
      price: 15,
      quantity: 7,
      imageAssetId: 'photo',
      unpacked: true,
      unitsPerPackage: 1,
    },
  ]
  database.records.sales = [
    { id: 'historical-sale', name: 'Sale', historicalCogs: 4 },
  ]
  const before = structuredClone(database.records)
  const data = {
    operation: 'link',
    productId: 'existing-product',
    recipeId: 'recipe-link',
    expectedRecipeId: '',
    outputQuantity: 2,
    outputUnit: 'loaves',
    sellingUnit: 'pack',
    confirm: true,
    mappingConfirmed: true,
  }
  let result = await post('productRecipeLink', 'products', data)
  expect(result.status).toBe(200)
  expect(database.records.products[0]).toMatchObject({
    recipeId: 'recipe-link',
    unitsPerPackage: 2,
    price: 15,
    quantity: 7,
    sku: 'B001',
    imageAssetId: 'photo',
  })
  result = await post('productRecipeLink', 'products', data)
  expect(result.status).toBe(200)
  expect(database.records.products).toHaveLength(1)
  result = await post('productRecipeLink', 'products', {
    ...data,
    operation: 'unlink',
    expectedRecipeId: 'recipe-link',
  })
  expect(result.status).toBe(200)
  expect(database.records.products[0].recipeId).toBeNull()
  expect(database.records.recipes).toEqual(before.recipes)
  expect(database.records.sales).toEqual(before.sales)
  expect(database.records.ingredients).toEqual(before.ingredients)
  expect(
    database.queries.some((q) =>
      /^INSERT INTO (ledger|batches|sales|expenses|journals|finance_transactions)\(/.test(
        q.sql,
      ),
    ),
  ).toBe(false)
})
it('reports owner-only nonsensitive setup status without paid lookups and records explicit test results', async () => {
  database.records.settings = [{ id: 'business', name: 'Oven' }]
  database.records.ingredients = [
    { id: 'flour', name: 'Bread flour', unit: 'g', cost: 0.01, quantity: 10 },
  ]
  const fetcher = vi.fn(async () => Response.json({ shopping_results: [] }))
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('Netlify', shoppingRuntime())
  const request = async (body?: any) => {
    const response = await handler(
      new Request(
        'https://cottage-pantry.test/api/workspace?priceSearchStatus=1',
        body ? { method: 'POST', body: JSON.stringify(body) } : undefined,
      ),
      context,
    )
    return { status: response.status, ...(await response.json()) }
  }
  try {
    expect(await request()).toMatchObject({
      configured: false,
      status: 'Missing configuration',
    })
    expect(fetcher).not.toHaveBeenCalled()
    vi.stubGlobal('Netlify', shoppingRuntime('test-credential'))
    expect(await request()).toMatchObject({
      configured: true,
      status: 'Configured, not tested',
    })
    expect(fetcher).not.toHaveBeenCalled()
    expect(
      (await request({ ingredientId: 'flour', confirmAllowance: false }))
        .status,
    ).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
    const result = await request({
      ingredientId: 'flour',
      confirmAllowance: true,
    })
    expect(result.status).toBe('Connection successful')
    expect(result.outcome).toBe('no_matching_products')
    expect(result.message).toContain('No matching products')
    expect(result.lastTest).toBeTruthy()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain('test-credential')
    expect(database.records.settings[0].priceSearchConnection.status).toBe(
      'Connection successful',
    )
    database.records.settings[0].priceSearchRequests = []
    fetcher.mockImplementation(
      async () => new Response('blocked', { status: 401 }),
    )
    const failed = await request({
      ingredientId: 'flour',
      confirmAllowance: true,
    })
    expect(failed.status).toBe('Authentication failed')
    expect(failed.outcome).toBe('authentication_failed')
    expect(failed.message).toContain('rejected the API key')
    database.role = 'Manager'
    expect((await request()).status).toBe(403)
  } finally {
    vi.unstubAllGlobals()
  }
})
it('denies link mutations to staff and rejects cross-workspace recipe IDs', async () => {
  database.records.recipes = [
    { id: 'r', name: 'Recipe', yield: 1, yieldUnit: 'each', lines: [] },
  ]
  database.records.products = [{ id: 'p', name: 'Product', price: 8 }]
  const data = {
    operation: 'link',
    productId: 'p',
    recipeId: 'outside',
    expectedRecipeId: '',
    outputQuantity: 1,
    outputUnit: 'each',
    sellingUnit: 'item',
    confirm: true,
    mappingConfirmed: true,
  }
  expect((await post('productRecipeLink', 'products', data)).status).toBe(400)
  database.role = 'Production Staff'
  expect(
    (await post('productRecipeLink', 'products', { ...data, recipeId: 'r' }))
      .status,
  ).toBe(400)
  expect(database.records.products[0].recipeId).toBeUndefined()
})
it('keeps assistant usage and connection records server-owned when settings are saved', async () => {
  database.records.settings[0].assistantRequests = [
    { actor: 'server-actor', at: Date.now() },
  ]
  database.records.settings[0].assistantConnections = {
    'server-actor': { status: 'Last request failed' },
  }
  const result = await post('save', 'settings', {
    id: 'business',
    name: 'Renamed bakery',
    taxRate: 0,
    assistantRequests: [],
    assistantConnections: { forged: { status: 'Connection successful' } },
  })
  expect(result.status).toBe(200)
  expect(database.records.settings[0].assistantRequests).toHaveLength(1)
  expect(database.records.settings[0].assistantConnections).toEqual({
    'server-actor': { status: 'Last request failed' },
  })
  expect(result.workspace.settings[0]).not.toHaveProperty('assistantRequests')
  expect(result.workspace.settings[0]).not.toHaveProperty(
    'assistantConnections',
  )
})
it('authorizes assistant access from verified membership and rejects cross-site requests', async () => {
  database.role = 'Production Staff'
  const denied = await handler(
    new Request('https://cottage-pantry.test/api/workspace?assistant=1'),
    context,
  )
  expect(denied.status).toBe(403)
  const csrf = await handler(
    new Request('https://cottage-pantry.test/api/workspace?assistant=1', {
      method: 'POST',
      headers: { origin: 'https://another.test' },
      body: JSON.stringify({ mode: 'research', text: 'Some product research' }),
    }),
    context,
  )
  expect(csrf.status).toBe(403)
  expect(await csrf.json()).toMatchObject({ code: 'ORIGIN_FORBIDDEN' })
})
it('binds shopping test success to the current deployment and makes no changes to ingredients, stock or accounts', async () => {
  database.records.ingredients = [
    {
      id: 'flour',
      name: 'Bread flour',
      unit: 'g',
      quantity: 42,
      packagePrice: 7.5,
    },
  ]
  const before = structuredClone(database.records)
  vi.stubGlobal('Netlify', shoppingRuntime('test-credential'))
  const fetcher = vi.fn(async () =>
    Response.json({
      shopping_results: [
        {
          title: 'Bread flour 5 lb',
          source: 'Fixture store',
          price: '$8.00',
          extracted_price: 8,
          link: 'https://store.example/flour',
        },
      ],
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  const request = async (deployment: string, body?: any) => {
    const response = await handler(
      new Request(
        'https://cottage-pantry.test/api/workspace?priceSearchStatus=1',
        body ? { method: 'POST', body: JSON.stringify(body) } : undefined,
      ),
      { ...context, deploy: { id: deployment } } as Context,
    )
    expect(response.headers.get('cache-control')).toContain('no-store')
    return response.json()
  }
  try {
    expect(
      await request('deploy-a', {
        ingredientId: 'flour',
        confirmAllowance: true,
      }),
    ).toMatchObject({
      status: 'Connection successful',
      outcome: 'search_successful',
    })
    expect(await request('deploy-a')).toMatchObject({
      configured: true,
      status: 'Connection successful',
    })
    expect(await request('deploy-b')).toMatchObject({
      configured: true,
      status: 'Configured, not tested',
      lastTest: null,
      message: null,
    })
    vi.stubGlobal('Netlify', shoppingRuntime())
    expect(await request('deploy-a')).toMatchObject({
      configured: false,
      status: 'Missing configuration',
      lastTest: null,
      message: null,
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    for (const table of [
      'ingredients',
      'products',
      'recipes',
      'batches',
      'sales',
    ])
      expect(database.records[table]).toEqual(before[table])
    expect(
      database.queries.some((q) =>
        /^INSERT INTO (ledger|sales|journals|finance_transactions)\(/.test(
          q.sql,
        ),
      ),
    ).toBe(false)
  } finally {
    vi.unstubAllGlobals()
  }
})
it.each([
  [429, 'Allowance exhausted', 'allowance_exhausted'],
  [503, 'Provider unavailable', 'provider_unavailable'],
])(
  'persists safe shopping test outcome for HTTP %s and does not retry',
  async (httpStatus, status, outcome) => {
    database.records.ingredients = [
      { id: 'flour', name: 'Bread flour', unit: 'g', quantity: 10 },
    ]
    vi.stubGlobal('Netlify', shoppingRuntime('test-credential'))
    const fetcher = vi.fn(
      async () =>
        new Response('untrusted provider internals', { status: httpStatus }),
    )
    vi.stubGlobal('fetch', fetcher)
    const request = (body?: string) =>
      handler(
        new Request(
          'https://cottage-pantry.test/api/workspace?priceSearchStatus=1',
          body ? { method: 'POST', body } : undefined,
        ),
        context,
      )
    try {
      const tested = await request(
        JSON.stringify({ ingredientId: 'flour', confirmAllowance: true }),
      )
      expect(await tested.json()).toMatchObject({ status, outcome })
      expect(database.records.settings[0].priceSearchRequests).toHaveLength(1)
      expect(await (await request()).json()).toMatchObject({ status, outcome })
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(
        (
          await request(
            JSON.stringify({ ingredientId: 'flour', confirmAllowance: true }),
          )
        ).status,
      ).toBe(400)
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(database.records.settings)).not.toContain(
        'untrusted provider internals',
      )
    } finally {
      vi.unstubAllGlobals()
    }
  },
)
it('persists the actual crumble method, groups and source through draft save/reopen, approval, recipe edit and refresh with no stock or Pantry creation', async () => {
  const parsed = parseRecipeText(bestCrumbleSource)
  // Explicit reviewer decisions establish US spoon measures for this fixture.
  const reviewedUnits = parsed.lines.map(
    (line, index) => line.unit || (index === 3 ? 'tbsp' : 'tsp'),
  )
  database.records.ingredients = parsed.lines.map((line, index) => ({
    id: 'pantry-' + index,
    name: line.name,
    unit: reviewedUnits[index],
    quantity: 50,
    cost: 1,
    usedAs: 'ingredient',
  }))
  const pantryBefore = structuredClone(database.records.ingredients)
  const created = await recipeImportRequest({
    operation: 'create',
    kind: 'text',
    text: bestCrumbleSource,
  })
  expect(created.status).toBe(200)
  let record = created.imports[0]
  expect(record.sourceText).toBe(bestCrumbleSource)
  expect(record.sourceUrl).toContain('best-crumble-topping-recipe')
  expect(record.draft.description).toBe('')
  expect(record.draft.lines).toHaveLength(6)
  expect(record.draft.optionalAdditions).toHaveLength(1)
  const draft = {
    ...record.draft,
    yieldQuantity: 1,
    yieldUnit: 'batch',
    lines: record.draft.lines.map((line: any, index: number) => ({
      ...line,
      quantity: line.quantity ?? 5,
      unit: reviewedUnits[index],
      decision: 'match',
      ingredientId: 'pantry-' + index,
      confirmed: true,
      cupStandard: 'us',
    })),
  }
  // Quantities/yield above are explicit user review decisions for this fixture.
  draft.instructions[0] += '\nKeep the butter warm.'
  const saved = await recipeImportRequest({
    operation: 'save',
    id: record.id,
    draft,
    expectedUpdatedAt: record.updatedAt,
  })
  expect(saved.status).toBe(200)
  const reopen = await handler(
    new Request(
      'https://cottage-pantry.test/api/workspace?recipeImports=1&id=' +
        record.id,
    ),
    context,
  )
  record = (await reopen.json()).import
  expect(record.draft.instructions).toEqual(draft.instructions)
  expect(record.draft.instructionGroups).toEqual(
    Array(5).fill('Crumble topping:'),
  )
  expect(record.draft.sourceUrl).toBe(parsed.sourceUrl)
  const approved = await recipeImportRequest({
    operation: 'approve',
    id: record.id,
    draft: record.draft,
    expectedUpdatedAt: record.updatedAt,
  })
  expect(approved.status).toBe(200)
  let recipe = database.records.recipes[0]
  expect(recipe.instructions).toBe(
    'Crumble topping:\n\n' + draft.instructions.join('\n\n'),
  )
  expect(recipe.sourceUrl).toBe(parsed.sourceUrl)
  expect(recipe.importProvenance.sourceUrl).toBe(parsed.sourceUrl)
  expect(recipe.optionalAdditions[0].original).toContain(
    'pecans, walnuts and/or oats',
  )
  expect(recipe.lines).toHaveLength(6)
  const edited = await post('save', 'recipes', {
    ...recipe,
    instructions: recipe.instructions + '\n\nLet it rest.',
  })
  expect(edited.status).toBe(200)
  const refreshed = await handler(
    new Request('https://cottage-pantry.test/api/workspace'),
    context,
  )
  recipe = (await refreshed.json()).workspace.recipes[0]
  expect(recipe.instructions).toBe(
    'Crumble topping:\n\n' +
      draft.instructions.join('\n\n') +
      '\n\nLet it rest.',
  )
  expect(recipe.optionalAdditions).toHaveLength(1)
  expect(database.records.ingredients).toEqual(pantryBefore)
  expect(database.records.recipes).toHaveLength(1)
  expect(
    database.queries.some((q) =>
      /^INSERT INTO (ingredients|ledger|batches|sales|expenses|journals|finance_transactions)\(/.test(
        q.sql,
      ),
    ),
  ).toBe(false)
})
it('previews and confirms repair of five legacy method rows without losing valid Pantry matches, original source or prior edits', async () => {
  const parsed = parseRecipeText(bestCrumbleSource)
  database.records.ingredients = [
    {
      id: 'flour',
      name: 'all-purpose flour',
      unit: 'g',
      quantity: 100,
      cost: 1,
    },
  ]
  const created = await recipeImportRequest({
    operation: 'create',
    kind: 'text',
    text: bestCrumbleSource,
  })
  const record = created.imports[0]
  const legacy = recipeDraftSchema.parse({
    title: 'User-edited title',
    description: 'User-edited description',
    lines: [
      ...parsed.lines,
      ...parsed.optionalAdditions,
      ...parsed.instructions.map((step, index) =>
        parseIngredient(`${index + 1}. ${step}`, 'Crumble topping'),
      ),
    ],
  })
  legacy.lines[0] = {
    ...legacy.lines[0],
    decision: 'match',
    ingredientId: 'flour',
    confirmed: true,
    cupStandard: 'us',
  }
  const saved = await recipeImportRequest({
    operation: 'save',
    id: record.id,
    expectedUpdatedAt: record.updatedAt,
    draft: legacy,
  })
  const before = structuredClone(database.records.recipe_imports[0])
  const request = {
    id: record.id,
    draft: saved.import.draft,
    expectedUpdatedAt: saved.import.updatedAt,
  }
  const preview = await recipeImportRequest({
    ...request,
    operation: 'previewReprocess',
  })
  expect(preview.status).toBe(200)
  expect(preview.repair).toMatchObject({
    movedInstructions: 5,
    preservedMatches: 1,
  })
  expect(database.records.recipe_imports[0]).toEqual(before)
  expect(
    (
      await recipeImportRequest({
        ...request,
        operation: 'reprocess',
        confirmReplaceEdits: false,
      })
    ).status,
  ).toBe(400)
  expect(database.records.recipe_imports[0]).toEqual(before)
  const repaired = await recipeImportRequest({
    ...request,
    operation: 'reprocess',
    confirmReplaceEdits: true,
  })
  expect(repaired.status).toBe(200)
  expect(repaired.import.id).toBe(record.id)
  expect(repaired.import.draft.lines).toHaveLength(6)
  expect(repaired.import.draft.instructions).toEqual(parsed.instructions)
  expect(repaired.import.draft.lines[0]).toMatchObject({
    ingredientId: 'flour',
    confirmed: true,
    cupStandard: 'us',
  })
  expect(repaired.import.reprocessPreviousDraft.title).toBe('User-edited title')
  for (const key of ['sourceText', 'sourceHash', 'originalKey'])
    expect(repaired.import[key]).toEqual(before[key])
  expect(database.records.recipe_imports).toHaveLength(1)
  expect(database.records.recipes).toHaveLength(0)
  expect(database.records.ingredients).toHaveLength(1)
  expect(
    (
      await recipeImportRequest({
        ...request,
        operation: 'reprocess',
        confirmReplaceEdits: true,
      })
    ).error,
  ).toMatch(/changed in another window/)
  database.records.recipe_imports[0].status = 'approved'
  database.records.recipe_imports[0].recipeId = 'existing-recipe'
  database.records.recipes = [
    {
      id: 'existing-recipe',
      name: 'Already approved',
      instructions: 'Existing method',
    },
  ]
  expect(
    (await recipeImportRequest({ ...request, operation: 'previewReprocess' }))
      .error,
  ).toMatch(/Approved recipes cannot/)
  expect(
    (
      await recipeImportRequest({
        ...request,
        operation: 'reprocess',
        confirmReplaceEdits: true,
      })
    ).error,
  ).toMatch(/Approved recipes cannot/)
  expect(database.records.recipes).toEqual([
    {
      id: 'existing-recipe',
      name: 'Already approved',
      instructions: 'Existing method',
    },
  ])
})
it('blocks approval with method prose in Pantry rows or unresolved source content, and requires review if extracted method is empty', async () => {
  const created = await recipeImportRequest({
    operation: 'create',
    kind: 'text',
    text: 'Bread\nIngredients:\n100 g flour\nMethod:\n1. Mix the flour with water.',
  })
  const record = created.imports[0]
  database.records.ingredients = [
    { id: 'flour', name: 'Flour', unit: 'g', quantity: 100, cost: 1 },
  ]
  const draft = {
    ...record.draft,
    yieldQuantity: 1,
    yieldUnit: 'loaf',
    lines: [
      {
        ...record.draft.lines[0],
        ingredientId: 'flour',
        decision: 'match',
        confirmed: true,
      },
    ],
  }
  const request = (changes: any) =>
    recipeImportRequest({
      operation: 'approve',
      id: record.id,
      expectedUpdatedAt: record.updatedAt,
      draft: { ...draft, ...changes },
    })
  expect(
    (
      await request({
        lines: [
          ...draft.lines,
          {
            ...parseIngredient('1. Mix the flour with water.'),
            quantity: 1,
            unit: 'g',
            ingredientId: 'flour',
            decision: 'match',
            confirmed: true,
          },
        ],
      })
    ).error,
  ).toMatch(/move method text/)
  expect((await request({ unclassified: ['Uncertain text'] })).error).toMatch(
    /Classify the remaining/,
  )
  expect((await request({ instructions: [] })).error).toMatch(
    /missing instructions/,
  )
  expect(database.records.recipes).toHaveLength(0)
  expect(
    (await request({ instructions: [], missingInstructionsReviewed: true }))
      .status,
  ).toBe(200)
  expect(database.records.recipes[0].instructions).toBe('')
  expect(database.records.ingredients).toHaveLength(1)
  expect(database.records.ledger || []).toEqual([])
  expect(database.records.journals || []).toEqual([])
})

it('keeps receipt attachments and manual review available with receipt reading off without extraction attempts or stock/finance changes', async () => {
  vi.stubGlobal('Netlify', {
    env: {
      get: (name: string) =>
        name === 'RECEIPT_READING_ENABLED' ? 'false' : undefined,
    },
  })
  receiptProvider.generate.mockClear()
  const sharp = (await import('sharp')).default
  const bytes = await sharp({
    create: { width: 20, height: 20, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer()
  const form = new FormData()
  form.set('file', new File([new Uint8Array(bytes)], 'manual-receipt.png'))
  const response = await handler(
    new Request('https://cottage-pantry.test/api/workspace?receiptUpload=1', {
      method: 'POST',
      body: form,
    }),
    context,
  )
  expect(response.status).toBe(200)
  const { receipt } = await response.json()
  expect(receipt.extractionStatus).toBe('manual')
  expect(receipt.extractionAttempts).toBeUndefined()
  const before = structuredClone(database.records)
  const rejected = await post('receiptExtract', '', { id: receipt.id })
  expect(rejected.status).toBe(404)
  expect(database.records).toEqual(before)
  const manual = await post('receiptDraft', '', {
    id: receipt.id,
    vendor: 'Entered manually',
    total: 12,
    subtotal: 12,
    tax: 0,
  })
  expect(manual.status).toBe(200)
  expect(receiptProvider.generate).not.toHaveBeenCalled()
  expect(database.records.finance_transactions || []).toHaveLength(0)
  expect(database.records.ledger || []).toHaveLength(0)
  expect(database.records.journals || []).toHaveLength(0)
})

it.each(['Owner', 'Manager', 'Production Staff', 'Read-only Accountant'])(
  'stores only the current member’s Pantry navigation preference for %s without business writes',
  async (role) => {
    database.role = role
    database.records.settings[0].pantryNavigationPreferences = {
      'other-user': true,
    }
    const before = structuredClone(database.records)
    const result = await post('pantryNavigation', 'settings', {
      expanded: false,
    })
    expect(result.status).toBe(200)
    expect(result.expanded).toBe(false)
    expect(database.records.settings[0].pantryNavigationPreferences).toEqual({
      'other-user': true,
      'verified-owner': false,
    })
    expect({ ...database.records, settings: [] }).toEqual({
      ...before,
      settings: [],
    })
    expect(database.records.settings[0]).toMatchObject({
      ...before.settings[0],
      pantryNavigationPreferences: {
        'other-user': true,
        'verified-owner': false,
      },
      updatedBy: 'verified-owner',
    })
    expect(
      database.queries
        .filter((q) => /^INSERT INTO /.test(q.sql))
        .map((q) => q.sql.match(/^INSERT INTO (\w+)/)?.[1]),
    ).toEqual(['settings'])
    const reopened = await handler(
      new Request('https://cottage-pantry.test/api/workspace'),
      context,
    )
    const settings = (await reopened.json()).workspace.settings[0]
    expect(settings.currentPantryNavigationExpanded).toBe(false)
    expect(settings.pantryNavigationPreferences).toBeUndefined()
    database.userId = 'other-user'
    const other = await handler(
      new Request('https://cottage-pantry.test/api/workspace'),
      context,
    )
    expect(
      (await other.json()).workspace.settings[0]
        .currentPantryNavigationExpanded,
    ).toBe(true)
  },
)
it('defaults the Pantry group to expanded and rejects invalid or impersonated preference changes', async () => {
  const initial = await handler(
    new Request('https://cottage-pantry.test/api/workspace'),
    context,
  )
  expect(
    (await initial.json()).workspace.settings[0]
      .currentPantryNavigationExpanded,
  ).toBe(true)
  for (const data of [
    { expanded: 'false' },
    { expanded: false, userId: 'other-user' },
    {},
  ]) {
    expect((await post('pantryNavigation', 'settings', data)).status).toBe(400)
  }
  expect(
    database.records.settings[0].pantryNavigationPreferences,
  ).toBeUndefined()
})
it('preserves private navigation preferences through an ordinary business-settings save', async () => {
  await post('pantryNavigation', 'settings', { expanded: false })
  const result = await post('save', 'settings', {
    id: 'business',
    name: 'Updated bakery',
    pantryNavigationPreferences: { 'verified-owner': true },
    currentPantryNavigationExpanded: true,
  })
  expect(result.status).toBe(200)
  expect(result.workspace.settings[0].currentPantryNavigationExpanded).toBe(
    false,
  )
  expect(
    result.workspace.settings[0].pantryNavigationPreferences,
  ).toBeUndefined()
  expect(database.records.settings[0].pantryNavigationPreferences).toEqual({
    'verified-owner': false,
  })
  expect(
    database.records.settings[0].currentPantryNavigationExpanded,
  ).toBeUndefined()
})

it('shelf media profiles save without stock or journal writes and reject invalid dimensions', async () => {
  database.records.ingredients = [
    { id: 'i', name: 'Flour', unit: 'lb', quantity: 10, cost: 2, threshold: 1 },
  ]
  const { defaultShelfMedia } = await import('./shelf-labels')
  const saved = await post('shelfMedia', 'settings', {
    profile: { ...defaultShelfMedia, id: 'media' },
  })
  expect(saved.status).toBe(200)
  expect(saved.workspace.settings[0].currentShelfMediaProfiles[0].width).toBe(
    60,
  )
  expect(database.records.ledger || []).toEqual([])
  expect(database.records.journals || []).toEqual([])
  expect(
    (
      await post('shelfMedia', 'settings', {
        profile: { ...defaultShelfMedia, height: 5, marginY: 4 },
      })
    ).status,
  ).toBe(400)
})
it('count drafts do not move stock, stale movements require recount, completion is idempotent', async () => {
  database.records.ingredients = [
    { id: 'i', name: 'Flour', unit: 'lb', quantity: 10, cost: 2, threshold: 1 },
  ]
  let response = await post('inventoryCountStart', 'inventory_counts', {
    id: 'count1',
  })
  expect(response.status).toBe(200)
  const originalRevision = response.workspace.ingredients[0].inventoryRevision
  response = await post('inventoryCountLine', 'inventory_counts', {
    id: 'count1',
    revision: 0,
    ingredientId: 'i',
    quantity: '8.5',
    unit: 'lb',
    inventoryRevision: originalRevision,
  })
  expect(response.status).toBe(200)
  expect(database.records.ingredients[0].quantity).toBe(10)
  expect(database.records.ledger || []).toEqual([])
  expect(database.records.journals || []).toEqual([])
  database.records.ledger = [
    { id: 'intervening', ingredientId: 'i', quantity: 1, unit: 'lb' },
  ]
  response = await post('inventoryCountComplete', 'inventory_counts', {
    id: 'count1',
    revision: 1,
    confirm: true,
  })
  expect(response.status).toBe(400)
  expect(response.error).toMatch(/recount/)
  expect(database.records.ingredients[0].quantity).toBe(10)
  response = await post('inventoryCountStart', 'inventory_counts', {
    id: 'count1',
  })
  const latest = response.workspace.ingredients[0].inventoryRevision
  expect(latest).not.toBe(originalRevision)
  response = await post('inventoryCountLine', 'inventory_counts', {
    id: 'count1',
    revision: 1,
    ingredientId: 'i',
    quantity: '8.5',
    unit: 'lb',
    inventoryRevision: latest,
  })
  expect(response.status).toBe(200)
  response = await post('inventoryCountComplete', 'inventory_counts', {
    id: 'count1',
    revision: 2,
    confirm: true,
  })
  expect(response.status).toBe(200)
  expect(database.records.ingredients[0].quantity).toBe(8.5)
  expect(
    database.records.ledger.filter((l) => l.countId === 'count1'),
  ).toHaveLength(1)
  const journals = database.records.journals.length
  expect(
    (
      await post('inventoryCountComplete', 'inventory_counts', {
        id: 'count1',
        revision: 2,
        confirm: true,
      })
    ).status,
  ).toBe(200)
  expect(database.records.journals).toHaveLength(journals)
  expect(
    database.records.ledger.filter((l) => l.countId === 'count1'),
  ).toHaveLength(1)
})
it('count operations reject unavailable oven items and unauthorized roles', async () => {
  await post('inventoryCountStart', 'inventory_counts', { id: 'count1' })
  expect(
    (
      await post('inventoryCountLine', 'inventory_counts', {
        id: 'count1',
        revision: 0,
        ingredientId: 'other-workspace',
        quantity: 1,
        unit: 'lb',
      })
    ).status,
  ).toBe(400)
  database.role = 'Read-only Accountant'
  expect(
    (await post('inventoryCountStart', 'inventory_counts', { id: 'forbidden' }))
      .status,
  ).toBe(400)
  expect(
    (
      await post('save', 'inventory_counts', {
        id: 'count1',
        name: 'forged',
        status: 'completed',
      })
    ).status,
  ).toBe(400)
})
it('receiving retries post once and reject changed values with a reused operation ID', async () => {
  database.records.ingredients = [
    { id: 'i', name: 'Flour', unit: 'lb', quantity: 10, cost: 2, threshold: 1 },
  ]
  const data = {
    id: 'i',
    quantity: 2,
    unit: 'lb',
    price: 6,
    operationId: 'receive1',
  }
  expect((await post('receive', 'ingredients', data)).status).toBe(200)
  expect((await post('receive', 'ingredients', data)).status).toBe(200)
  expect(database.records.ingredients[0].quantity).toBe(12)
  expect(database.records.ledger).toHaveLength(1)
  expect(database.records.journals).toHaveLength(1)
  expect(
    (await post('receive', 'ingredients', { ...data, quantity: 3 })).status,
  ).toBe(400)
  expect(database.records.ingredients[0].quantity).toBe(12)
})

it('opens an existing Owner oven with pending billing without requiring platform admin', async () => {
  database.billing = {
    plan_id: 'cottage-kitchen',
    status: 'checkout_pending',
    source: 'unassigned',
  }
  const response = await handler(
    new Request('https://cottage-pantry.test/api/workspace'),
    context,
  )
  expect(response.status).toBe(200)
  expect((await response.json()).role).toBe('Owner')
  expect(
    (await post('save', 'ingredients', { id: 'pending', name: 'Pending' }))
      .status,
  ).toBe(400)
})
it('rejects an expired owner session without provisioning or demo fallback', async () => {
  database.expired = true
  const response = await handler(
    new Request('https://cottage-pantry.test/api/workspace', {
      headers: { cookie: 'nf_jwt=expired-session' },
    }),
    context,
  )
  expect(response.status).toBe(401)
  expect(database.queries.some(({ sql }) => sql.startsWith('INSERT'))).toBe(
    false,
  )
})
it.each(['', null, undefined])(
  'rejects missing package price %s without creating a free receipt',
  async (packagePrice) => {
    const result = await post('save', 'ingredients', {
      name: 'Validation test',
      purchaseQuantity: 25,
      purchaseUnit: 'lb',
      unit: 'lb',
      packagePrice,
    })
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/total package price paid/)
    expect(database.records.ingredients).toHaveLength(0)
    expect(database.records.ledger || []).toHaveLength(0)
  },
)
it('replays a successful ingredient creation once without duplicating stock, ledger or journal', async () => {
  const data = {
    id: 'retry-test',
    creationRequestId: 'request-test',
    name: 'Retry flour',
    purchaseQuantity: 25,
    purchaseUnit: 'lb',
    unit: 'lb',
    packagePrice: 10.95,
  }
  const first = await post('save', 'ingredients', data)
  expect(first.status).toBe(200)
  const second = await post('save', 'ingredients', data)
  expect(second.status).toBe(200)
  expect(second.workspace.ingredients).toHaveLength(1)
  expect(second.workspace.ingredients[0].packagePrice).toBe(10.95)
  expect(database.records.ledger).toHaveLength(1)
  expect(database.records.journals).toHaveLength(1)
  const changed = await post('save', 'ingredients', {
    ...data,
    packagePrice: 12,
  })
  expect(changed.status).toBe(400)
  expect(database.records.ingredients).toHaveLength(1)
  expect(database.records.ingredients[0].packagePrice).toBe(10.95)
  const reload = await handler(
    new Request('https://cottage-pantry.test/api/workspace'),
    context,
  )
  expect((await reload.json()).workspace.ingredients[0].id).toBe(data.id)
})
it('persists an applied photo reference and unreviewed source text and reloads it', async () => {
  database.records.graphic_assets = [
    { id: 'test-photo', fileUrl: '/api/workspace?asset=test-photo' },
  ]
  const result = await post('save', 'ingredients', {
    id: 'imported-test',
    name: 'Imported flour',
    purchaseQuantity: 25,
    purchaseUnit: 'lb',
    unit: 'lb',
    packagePrice: 11,
    imageAssetId: 'test-photo',
    subingredients: 'Wheat flour',
    sourceContains: 'Wheat',
    reviewed: false,
  })
  expect(result.status).toBe(200)
  const response = await handler(
    new Request('https://cottage-pantry.test/api/workspace'),
    context,
  )
  expect((await response.json()).workspace.ingredients[0]).toMatchObject({
    imageAssetId: 'test-photo',
    packagePrice: 11,
    reviewed: false,
    sourceContains: 'Wheat',
  })
})
it('requires actual purchase-price confirmation for an imported listed online price', async () => {
  const data = {
    id: 'price-confirmation',
    name: 'Listed flour',
    purchaseQuantity: 25,
    purchaseUnit: 'lb',
    unit: 'lb',
    packagePrice: 10.95,
    listedOnlinePrice: 10.95,
    purchasePriceConfirmed: false,
  }
  const rejected = await post('save', 'ingredients', data)
  expect(rejected.status).toBe(400)
  expect(rejected.error).toMatch(/actual purchase price/)
  expect(database.records.ingredients).toHaveLength(0)
  const saved = await post('save', 'ingredients', {
    ...data,
    packagePrice: 12,
    purchasePriceConfirmed: true,
  })
  expect(saved.status).toBe(200)
  expect(saved.workspace.ingredients[0]).toMatchObject({
    packagePrice: 12,
    listedOnlinePrice: 10.95,
  })
})

it('retains selected listed flour price, currency and provenance through save payload and GET reopening', async () => {
  const data = {
    id: 'listed-price-trace',
    name: 'Listed price trace flour',
    purchaseQuantity: 25,
    purchaseUnit: 'lb',
    unit: 'lb',
    packagePrice: 10.98,
    listedOnlinePrice: 10.98,
    currency: 'USD',
    purchasePriceConfirmed: true,
    productSourceUrl:
      'https://www.samsclub.com/ip/Member-s-Mark-Bread-Pizza-Flour-25-lbs/13909715756',
    receivedPackages: 1,
    productCheckedAt: '2026-11-01T19:10:00Z',
  }
  const saved = await post('save', 'ingredients', data)
  expect(saved.status).toBe(200)
  expect(database.records.ingredients[0]).toMatchObject({ ...data, unit: 'g' })
  const response = await handler(
    new Request('https://cottage-pantry.test/api/workspace'),
    context,
  )
  const ingredient = (await response.json()).workspace.ingredients[0]
  expect(ingredient).toMatchObject({ ...data, unit: 'g' })
  expect(ingredient.cost).toBeCloseTo(10.98 / (25 * 453.59237), 8)
})

it('saves fractional gallon purchases and cup recipes through repeated verified API reopening', async () => {
  const result = await post('save', 'ingredients', {
    id: 'gallon-milk',
    name: 'Milk',
    purchaseQuantity: '1/2',
    purchaseUnit: 'gallon',
    packagePrice: 8,
    unit: 'cup',
    usedAs: 'ingredient',
  })
  expect(result.status).toBe(200)
  expect(result.workspace.ingredients[0]).toMatchObject({
    purchaseQuantity: 0.5,
    purchaseUnit: 'gallon',
    unit: 'ml',
    storageUnit: 'cup',
  })
  const recipe = await post('save', 'recipes', {
    id: 'milk-recipe',
    name: 'Milk recipe',
    yield: 1,
    yieldUnit: 'each',
    laborMinutes: 0,
    lines: [{ ingredientId: 'gallon-milk', quantity: '1/4', unit: 'cup' }],
  })
  expect(recipe.status).toBe(200)
  expect(recipe.workspace.recipes[0].lines[0].quantity).toBe(0.25)
  const snapshot = structuredClone(database.records.ingredients)
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await handler(
      new Request('https://cottage-pantry.test/api/workspace'),
      context,
    )
    expect(response.status).toBe(200)
    const reopened = (await response.json()).workspace
    expect(reopened.ingredients[0].quantity).toBeCloseTo(1892.705892)
    expect(reopened.ingredients[0].cost * 236.5882365).toBeCloseTo(1)
    expect(reopened.recipes[0].lines[0]).toMatchObject({
      quantity: 0.25,
      unit: 'cup',
    })
  }
  expect(database.records.ingredients).toEqual(snapshot)
})

it('persists reviewed partial product metadata and manually entered cost through API save and reopening (synthetic data)', async () => {
  // No Walmart extraction or real retailer price is simulated by this persistence test.
  const data = {
    id: 'partial-import-oil',
    name: 'Synthetic oil',
    brand: 'Synthetic brand',
    packageSize: '128 fl oz',
    packCount: 2,
    purchaseQuantity: 256,
    purchaseUnit: 'fl oz',
    unit: 'fl oz',
    packagePrice: 13,
    currency: 'USD',
    purchasePriceConfirmed: true,
    productSourceUrl: 'https://shop.example/product/oil',
    receivedPackages: 1,
    productCheckedAt: '2026-11-01T21:28:13.516Z',
  }
  const invalid = await post('save', 'ingredients', {
    ...data,
    id: 'invalid-pack',
    packCount: 0,
  })
  expect(invalid.status).toBe(400)
  const saved = await post('save', 'ingredients', data)
  expect(saved.status).toBe(200)
  for (let request = 0; request < 2; request++) {
    const response = await handler(
      new Request('https://cottage-pantry.test/api/workspace'),
      context,
    )
    const item = (await response.json()).workspace.ingredients.find(
      (i: any) => i.id === data.id,
    )
    expect(item).toMatchObject({ ...data, unit: 'ml' })
    expect(item).not.toHaveProperty('listedOnlinePrice')
  }
  const current = database.records.ingredients[0]
  const edited = await post('ingredientUpdate', 'ingredients', {
    ...data,
    expectedUpdatedAt: current.updatedAt,
    storageUnit: 'fl oz',
    threshold: 0,
    packageSize: 'Source label reviewed: 128 fl oz',
    packCount: 3,
  })
  expect(edited.status).toBe(200)
  const reopened = await handler(
    new Request('https://cottage-pantry.test/api/workspace'),
    context,
  )
  expect((await reopened.json()).workspace.ingredients[0]).toMatchObject({
    packageSize: 'Source label reviewed: 128 fl oz',
    packCount: 3,
    purchaseQuantity: 256,
    packagePrice: 13,
  })
})

async function productVendors(body?: any) {
  const response = await handler(
    new Request(
      'https://cottage-pantry.test/api/workspace?productVendors=1',
      body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : undefined,
    ),
    context,
  )
  return { status: response.status, ...(await response.json()) }
}
it('lists authorized vendors, reuses aliases on repeated explicit adds and never modifies existing vendor data', async () => {
  const vendor = {
    id: 'sams',
    name: 'Sam’s Club',
    website: 'https://www.samsclub.com',
    notes: 'Existing vendor data',
  }
  database.records.vendors = [vendor]
  expect((await productVendors()).vendors).toEqual([vendor])
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = await productVendors({
      name: 'Samsclub.com',
      website: 'https://samsclub.com',
    })
    expect(result.status).toBe(200)
    expect(result.vendor.id).toBe('sams')
    expect(database.records.vendors).toEqual([vendor])
  }
  expect(
    database.queries
      .filter((q) => q.sql.startsWith('SELECT data FROM vendors'))
      .every(
        (q) =>
          q.sql.includes('business_id=$1') &&
          q.params[0] === 'private-business',
      ),
  ).toBe(true)
  const created = await productVendors({
    name: 'Local Mill',
    website: 'https://mill.example',
  })
  expect(created.status).toBe(200)
  expect(
    (
      await productVendors({
        name: 'Local Mill',
        website: 'https://mill.example',
      })
    ).vendor.id,
  ).toBe(created.vendor.id)
  expect(database.records.vendors).toHaveLength(2)
})
it('requires a choice for ambiguous vendor additions and rejects a foreign vendor ID on ingredient save', async () => {
  database.records.vendors = [
    { id: 'a', name: 'Sam’s Club' },
    { id: 'b', name: "Sam's Club" },
  ]
  expect((await productVendors({ name: 'samsclub.com' })).status).toBe(400)
  expect(database.records.vendors).toHaveLength(2)
  const result = await post('save', 'ingredients', {
    name: 'Flour',
    vendorId: 'foreign-vendor',
    purchaseQuantity: 10,
    purchaseUnit: 'lb',
    unit: 'lb',
    packagePrice: 12,
  })
  expect(result.status).toBe(400)
  expect(database.records.ingredients).toHaveLength(0)
  database.role = 'Staff'
  expect((await productVendors()).status).not.toBe(200)
  database.expired = true
  expect((await productVendors()).status).toBe(401)
})
it('persists separate imported statements and stable vendor ID across repeated save, update and fresh reads', async () => {
  database.records.vendors = [
    { id: 'sams', name: 'Sam’s Club', notes: 'Preserve this vendor' },
  ]
  const vendorsBefore = structuredClone(database.records.vendors)
  const data = {
    id: 'imported-flour',
    creationRequestId: 'imported-flour-create',
    name: 'Flour',
    brand: 'Member’s Mark',
    vendorId: 'sams',
    vendor: 'Samsclub.com',
    purchaseQuantity: 10,
    purchaseUnit: 'lb',
    unit: 'lb',
    packagePrice: 12,
    productSourcePackageSize: '10 lbs',
    productSourceUrl: 'https://samsclub.com/ip/flour/1',
    receivedPackages: 1,
    productCheckedAt: '2026-11-02T01:00:00Z',
    subingredients: 'Flour (wheat, malted barley flour), salt.',
    sourceContains: 'Contains wheat.',
    sourceMayContain: 'May contain soy.',
    reviewed: false,
    barcode: '001234567890',
    retailerSku: '000123',
  }
  for (let repeat = 0; repeat < 2; repeat++)
    expect((await post('save', 'ingredients', data)).status).toBe(200)
  expect(database.records.ingredients).toHaveLength(1)
  const current = database.records.ingredients[0]
  expect(
    (
      await post('ingredientUpdate', 'ingredients', {
        ...current,
        expectedUpdatedAt: current.updatedAt,
        threshold: 0,
        packageSize: 'Keep old raw metadata',
      })
    ).status,
  ).toBe(200)
  for (let read = 0; read < 2; read++) {
    const response = await handler(
      new Request('https://cottage-pantry.test/api/workspace'),
      context,
    )
    const saved = (await response.json()).workspace.ingredients[0]
    expect(saved).toMatchObject({
      ...data,
      vendor: 'Sam’s Club',
      unit: 'g',
      packageSize: 'Keep old raw metadata',
    })
  }
  expect(database.records.vendors).toEqual(vendorsBefore)
  expect(
    database.queries.filter((q) => q.sql.startsWith('INSERT INTO vendors')),
  ).toHaveLength(0)
})
it('persists explicit label name parts on products without changing or splitting the full product name', async () => {
  database.records.recipes = [
    {
      id: 'name-parts-recipe',
      name: 'Bread',
      yield: 1,
      yieldUnit: 'each',
      lines: [],
    },
  ]
  const fullName = 'Homestyle White Bread Loaf'
  let result = await post('save', 'products', {
    id: 'two-font-product',
    recipeId: 'name-parts-recipe',
    unpacked: true,
    name: fullName,
    labelMainName: 'Homestyle White',
    labelProductType: 'Bread',
    price: 8,
    unitsPerPackage: 1,
  })
  expect(result.status, result.error).toBe(200)
  expect(
    result.workspace.products.find((p: any) => p.id === 'two-font-product'),
  ).toMatchObject({
    name: fullName,
    labelMainName: 'Homestyle White',
    labelProductType: 'Bread',
  })
  result = await post('save', 'products', {
    ...result.workspace.products.find((p: any) => p.id === 'two-font-product'),
    labelMainName: 'Longer Homestyle Wheat',
    labelProductType: '',
  })
  expect(result.status, result.error).toBe(200)
  expect(
    result.workspace.products.find((p: any) => p.id === 'two-font-product'),
  ).toMatchObject({
    name: fullName,
    labelMainName: 'Longer Homestyle Wheat',
    labelProductType: '',
  })
})

// Synthetic records only. These exercise the actual workspace handler with its test database adapter.
it.each(['each', 'g'])(
  'saves and reopens an opening count in each with canonical %s stock, without altering costs or old history',
  async (unit) => {
    const conversions =
      unit === 'g'
        ? [
            {
              from: 'each',
              to: 'g',
              amountFrom: 1,
              amountTo: 100,
              verified: true,
            },
          ]
        : []
    database.records.ingredients = [
      {
        id: 'counted-cups',
        name: 'Applesauce count fixture',
        unit,
        storageUnit: 'each',
        recipeUnit: 'g',
        quantity: unit === 'g' ? 200 : 2,
        cost: unit === 'g' ? 0.004 : 0.4,
        currentCost: unit === 'g' ? 0.005 : 0.5,
        conversions,
      },
    ]
    database.records.ledger = [
      {
        id: 'original',
        name: 'Original receipt',
        ingredientId: 'counted-cups',
        quantity: unit === 'g' ? 200 : 2,
        unit,
        amount: 0.8,
      },
    ]
    const original = structuredClone(database.records.ledger[0])
    database.records.recipes = [
      {
        id: 'old-recipe',
        name: 'Old recipe',
        lines: [{ ingredientId: 'counted-cups', quantity: 25, unit: 'g' }],
      },
    ]
    const recipes = structuredClone(database.records.recipes)
    const response = await handler(
      new Request('https://cottage-pantry.test/api/workspace'),
      context,
    )
    const before = (await response.json()).workspace.ingredients[0]
    const data = {
      id: before.id,
      operationId: 'opening-six',
      adjustmentMode: 'total',
      quantity: 6,
      unit: 'each',
      type: 'adjustment',
      reason: 'Opening count',
      expectedInventoryRevision: before.inventoryRevision,
    }
    const saved = await post('adjust', 'ingredients', data)
    expect(saved.status).toBe(200)
    const item = saved.workspace.ingredients[0]
    expect(item.quantity).toBe(unit === 'g' ? 600 : 6)
    expect(
      convert(item.quantity, item.unit, item.storageUnit, item.conversions),
    ).toBe(6)
    expect(item.cost).toBe(before.cost)
    expect(item.currentCost).toBe(before.currentCost)
    const movement = saved.workspace.ledger.find(
      (l: any) => l.id === 'stock-opening-six',
    )
    expect(movement).toMatchObject({
      quantity: unit === 'g' ? 400 : 4,
      unit,
      enteredQuantity: 6,
      enteredUnit: 'each',
      inventoryQuantity: 4,
      inventoryUnit: 'each',
      previousInventoryQuantity: 2,
      resultingInventoryQuantity: 6,
      amount: 1.6,
      adjustmentMode: 'total',
    })
    expect(inventoryMovementView(movement)).toMatchObject({
      quantity: 4,
      unit: 'each',
    })
    expect(database.records.ledger[0]).toEqual(original)
    expect(database.records.recipes).toEqual(recipes)
    expect(database.records.journals[0].lines).toEqual([
      { account: 'Inventory asset', debit: 1.6, credit: 0 },
      { account: 'Other income', debit: 0, credit: 1.6 },
    ])
    // An identical retry is accepted before checking its now-stale stock revision.
    expect((await post('adjust', 'ingredients', data)).status).toBe(200)
    expect(database.records.ledger).toHaveLength(2)
    expect(database.records.journals).toHaveLength(1)
    expect(
      (
        await post('adjust', 'ingredients', {
          ...data,
          adjustmentMode: 'change',
        })
      ).status,
    ).toBe(400)
    for (let attempt = 0; attempt < 2; attempt++) {
      const reopened = await handler(
        new Request('https://cottage-pantry.test/api/workspace'),
        context,
      )
      const workspace = (await reopened.json()).workspace
      const ingredient = workspace.ingredients[0]
      expect(
        convert(
          ingredient.quantity,
          ingredient.unit,
          ingredient.storageUnit,
          ingredient.conversions,
        ),
      ).toBe(6)
      expect(
        inventoryMovementView(
          workspace.ledger.find((l: any) => l.id === movement.id),
        ),
      ).toMatchObject({
        quantity: 4,
        unit: 'each',
        resultingInventoryQuantity: 6,
      })
    }
  },
)
it('converts each-based additions and removals before stock valuation, and rejects missing conversions without writes', async () => {
  database.records.ingredients = [
    {
      id: 'counted',
      name: 'Cups',
      unit: 'g',
      storageUnit: 'each',
      quantity: 200,
      cost: 0.004,
      conversions: [
        { from: 'each', to: 'g', amountFrom: 1, amountTo: 100, verified: true },
      ],
    },
  ]
  expect(
    (
      await post('adjust', 'ingredients', {
        id: 'counted',
        quantity: 6,
        unit: 'each',
        reason: 'Additional stock',
      })
    ).status,
  ).toBe(200)
  expect(database.records.ingredients[0].quantity).toBe(800)
  expect(database.records.ledger[0]).toMatchObject({
    quantity: 600,
    unit: 'g',
    inventoryQuantity: 6,
    inventoryUnit: 'each',
    amount: 2.4,
  })
  expect(
    (
      await post('adjust', 'ingredients', {
        id: 'counted',
        quantity: -0.5,
        unit: 'each',
        type: 'waste',
        reason: 'Partial cup wasted',
      })
    ).status,
  ).toBe(200)
  expect(database.records.ingredients[0].quantity).toBe(750)
  database.records.ingredients[0].conversions = []
  const snapshot = structuredClone(database.records)
  const failed = await post('adjust', 'ingredients', {
    id: 'counted',
    quantity: 6,
    unit: 'each',
    reason: 'Must not assume each is gram',
  })
  expect(failed.status).toBe(400)
  expect(failed.error).toMatch(/verified unit conversion/)
  expect(database.records).toEqual(snapshot)
})
it('requires a fresh balance for set-total counts and rejects foreign stock and read-only roles', async () => {
  database.records.ingredients = [
    {
      id: 'counted',
      name: 'Cups',
      unit: 'each',
      storageUnit: 'each',
      quantity: 2,
      cost: 0.4,
    },
  ]
  const response = await handler(
    new Request('https://cottage-pantry.test/api/workspace'),
    context,
  )
  const before = (await response.json()).workspace.ingredients[0]
  const data = {
    id: 'counted',
    quantity: 6,
    unit: 'each',
    adjustmentMode: 'total',
    reason: 'Opening count',
  }
  expect((await post('adjust', 'ingredients', data)).status).toBe(400)
  database.records.ingredients[0].storageUnit = 'dozen'
  expect(
    (
      await post('adjust', 'ingredients', {
        ...data,
        expectedInventoryRevision: before.inventoryRevision,
      })
    ).status,
  ).toBe(400)
  expect(
    (await post('adjust', 'ingredients', { ...data, id: 'foreign-item' }))
      .status,
  ).toBe(400)
  database.role = 'Read-only Accountant'
  expect(
    (
      await post('adjust', 'ingredients', {
        id: 'counted',
        quantity: 1,
        unit: 'each',
        reason: 'Unauthorized',
      })
    ).status,
  ).toBe(400)
  expect(database.records.ingredients[0].quantity).toBe(2)
  expect(database.records.ledger || []).toEqual([])
})

it('deducts two each from a saved six-each opening total and locks the corresponding weight and historical cost', async () => {
  database.records.ingredients = [
    {
      id: 'cups',
      name: 'Recipe cup fixture',
      unit: 'g',
      storageUnit: 'each',
      recipeUnit: 'each',
      quantity: 200,
      cost: 0.004,
      currentCost: 0.005,
      conversions: [
        { from: 'each', to: 'g', amountFrom: 1, amountTo: 100, verified: true },
      ],
    },
  ]
  const response = await handler(
    new Request('https://cottage-pantry.test/api/workspace'),
    context,
  )
  const before = (await response.json()).workspace.ingredients[0]
  expect(
    (
      await post('adjust', 'ingredients', {
        id: 'cups',
        quantity: 6,
        unit: 'each',
        adjustmentMode: 'total',
        expectedInventoryRevision: before.inventoryRevision,
        reason: 'Opening count',
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await post('save', 'recipes', {
        id: 'cup-recipe',
        name: 'Applesauce recipe fixture',
        yield: 1,
        yieldUnit: 'each',
        laborMinutes: 0,
        laborRate: 0,
        overhead: 0,
        lines: [{ ingredientId: 'cups', quantity: 2, unit: 'each' }],
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await post('save', 'batches', {
        id: 'cup-run',
        name: 'Cup recipe run',
        recipeId: 'cup-recipe',
        count: 1,
      })
    ).status,
  ).toBe(200)
  const completed = await post('complete', 'batches', {
    id: 'cup-run',
    actualYield: 1,
    laborMinutes: 0,
  })
  expect(completed.status).toBe(200)
  expect(completed.workspace.ingredients[0].quantity).toBe(400)
  expect(
    convert(
      completed.workspace.ingredients[0].quantity,
      'g',
      'each',
      completed.workspace.ingredients[0].conversions,
    ),
  ).toBe(4)
  expect(completed.workspace.recipes[0].lines[0]).toMatchObject({
    quantity: 2,
    unit: 'each',
  })
  expect(completed.workspace.batches[0].usage[0]).toMatchObject({
    quantity: 200,
    unit: 'g',
    cost: 0.8,
  })
  expect(completed.workspace.batches[0].costSnapshot.ingredient).toBeCloseTo(
    0.8,
  )
  const consumption = completed.workspace.ledger.find(
    (l: any) => l.type === 'batch_consumption',
  )
  expect(consumption).toMatchObject({ quantity: -200, unit: 'g', amount: -0.8 })
})
