// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import { inventoryPackageExamples } from '../../tests/inventory-package-examples'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest'
import type { Context } from '@netlify/functions'
import { recipeCost, type Item } from './domain'
import { packageCost } from './ingredients'
const runtime = vi.hoisted(() => ({
  client: null as null | {
    query(sql: string, params?: unknown[]): Promise<unknown>
    release(): void
  },
  user: 'receipt-owner',
  selected: undefined as string | undefined,
  expire: false,
  provider: vi.fn(),
  files: new Map<string, ArrayBuffer>(),
}))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({ pool: { connect: async () => runtime.client } }),
}))
vi.mock('../../netlify/lib/verified-session', async (original) => ({
  ...(await original<typeof import('../../netlify/lib/verified-session')>()),
  verifiedSession: async () =>
    runtime.expire
      ? null
      : { id: runtime.user, confirmedAt: '2026-01-01T00:00:00Z' },
  selectedWorkspace: () => runtime.selected,
}))
vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    set: async (key: string, value: ArrayBuffer) => {
      runtime.files.set(key, value)
    },
    get: async (key: string) => runtime.files.get(key) || null,
  }),
}))
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: runtime.provider }
  },
}))
import handler from '../../netlify/functions/workspace.mts'
const db = new PGlite(),
  org = '00000000-0000-4000-8000-000000000031',
  other = '00000000-0000-4000-8000-000000000032'
const context = { cookies: { get: () => 'a'.repeat(64) } } as unknown as Context
async function request(
  action?: string,
  data?: Record<string, unknown>,
  query = '',
) {
  const response = await handler(
    new Request(
      'https://receipt-test.invalid/api/workspace' + query,
      action
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, data }),
          }
        : {},
    ),
    context,
  )
  return { status: response.status, ...(await response.json()) }
}
async function upload() {
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage().drawText('Mill invoice ' + crypto.randomUUID() + ' USD 12.00', {
    font,
    x: 30,
    y: 700,
  })
  const form = new FormData()
  form.set(
    'file',
    new File([new Uint8Array(await doc.save())], 'invoice.pdf', {
      type: 'application/pdf',
    }),
  )
  const response = await handler(
    new Request('https://receipt-test.invalid/api/workspace?receiptUpload=1', {
      method: 'POST',
      body: form,
    }),
    context,
  )
  const json = await response.json()
  expect(response.status, json.error).toBe(200)
  return json.receipt
}
beforeAll(async () => {
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root))
    await db.exec(
      await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
    )
  for (const [id, user] of [
    [org, 'receipt-owner'],
    [other, 'receipt-other'],
  ]) {
    await db.query(
      'INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3)',
      [id, 'Receipt test', user],
    )
    await db.query(
      'INSERT INTO users(id,business_id,data,identity_id,role) VALUES($1,$2,$3,$4,$5)',
      ['owner', id, '{}', user, 'Owner'],
    )
    await db.query(
      'INSERT INTO settings(id,business_id,data) VALUES($1,$2,$3)',
      [
        'business',
        id,
        JSON.stringify({
          id: 'business',
          name: 'Receipt test',
          taxRates: [],
          currency: 'USD',
        }),
      ],
    )
  }
  await db.query(
    'INSERT INTO users(id,business_id,data,identity_id,role) VALUES($1,$2,$3,$4,$5)',
    ['reader', org, '{}', 'receipt-reader', 'Read-only Accountant'],
  )
  await db.query(
    'INSERT INTO ingredients(id,business_id,data,quantity,cost) VALUES($1,$2,$3,$4,$5)',
    [
      'flour',
      org,
      JSON.stringify({
        id: 'flour',
        name: 'Flour',
        usedAs: 'ingredient',
        unit: 'g',
        quantity: 0,
        cost: 0,
        conversions: [],
      }),
      0,
      0,
    ],
  )
  await db.exec(
    'CREATE ROLE receipt_app; GRANT USAGE ON SCHEMA public TO receipt_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO receipt_app; SET ROLE receipt_app;',
  )
  runtime.client = {
    query: (sql: string, params?: unknown[]) => db.query(sql, params),
    release() {},
  }
}, 30000)
afterAll(async () => db.close())
beforeEach(() => {
  runtime.user = 'receipt-owner'
  runtime.expire = false
})
it('commits reviewed inventory/expense once, reopens all evidence, and enforces oven and reader access', async () => {
  const receipt = await upload()
  runtime.provider.mockResolvedValue({
    text: JSON.stringify({
      vendor: 'Mill',
      date: '2026-11-02',
      currency: 'USD',
      receiptNumber: '0821',
      pagesReviewed: [1],
      subtotal: 12,
      tax: 1.2,
      total: 13.2,
      lines: [
        {
          description: 'Flour',
          quantity: 2,
          unit: 'bags',
          unitPrice: 4,
          amount: 8,
          page: 1,
        },
        { description: 'Delivery expense', quantity: 1, amount: 4, page: 1 },
      ],
    }),
  })
  let result = await request('receiptExtract', { id: receipt.id })
  expect(result.status, result.error).toBe(200)
  expect(result.workspace.ledger).toHaveLength(0)
  expect(result.workspace.finance_transactions).toHaveLength(0)
  let draft = result.workspace.receipt_extractions.find(
    (r: Item) => r.id === receipt.id,
  )
  expect(draft.lines[0]).toMatchObject({
    printedQuantity: 2,
    printedUnit: 'bags',
    quantity: null,
    unit: '',
  })
  const lines = [
    {
      ...draft.lines[0],
      decision: 'inventory',
      itemId: 'flour',
      quantity: 2000,
      unit: 'g',
      stockQuantityConfirmed: true,
    },
    {
      ...draft.lines[1],
      decision: 'expense',
      category: 'Miscellaneous expense',
    },
  ]
  result = await request('receiptDraft', { id: receipt.id, ...draft, lines })
  expect(result.status, result.error).toBe(200)
  draft = (await request()).workspace.receipt_extractions.find(
    (r: Item) => r.id === receipt.id,
  )
  expect(draft.lines).toEqual(lines)
  result = await request('receiptPost', { id: receipt.id })
  expect(result.status, result.error).toBe(200)
  const reopened = (await request()).workspace
  expect(
    reopened.ingredients.find((i: Item) => i.id === 'flour').quantity,
  ).toBe(2000)
  expect(reopened.ledger).toHaveLength(1)
  expect(reopened.finance_transactions).toHaveLength(1)
  expect(reopened.receipt_extractions[0].postedLines[0].printedQuantity).toBe(2)
  expect((await request('receiptPost', { id: receipt.id })).status).toBe(400)
  runtime.user = 'receipt-other'
  expect((await request()).workspace.receipt_extractions).toEqual([])
  expect((await request('receiptExtract', { id: receipt.id })).status).toBe(400)
  expect(
    (await request(undefined, undefined, '?receiptFile=' + receipt.id)).status,
  ).toBe(400)
  runtime.user = 'receipt-reader'
  expect((await request('receiptExtract', { id: receipt.id })).status).toBe(400)
  runtime.user = 'receipt-owner'
  expect((await request()).workspace.finance_transactions).toHaveLength(1)
})
it('preserves a failed attempt and owner corrections across retry, and bounds paid attempts', async () => {
  const receipt = await upload()
  await request('receiptDraft', { id: receipt.id, vendor: 'Owner correction' })
  runtime.provider.mockRejectedValue({ status: 503 })
  let result = await request('receiptExtract', {
    id: receipt.id,
    preserveEdits: true,
  })
  expect(result.status, result.error).toBe(200)
  let draft = result.workspace.receipt_extractions.find(
    (r: Item) => r.id === receipt.id,
  )
  expect(draft.vendor).toBe('Owner correction')
  expect(draft.extractionStatus).toBe('failed')
  runtime.provider.mockResolvedValue({
    text: JSON.stringify({
      vendor: 'Printed vendor',
      total: 12,
      pagesReviewed: [1],
      lines: [{ description: 'Flour', amount: 12 }],
    }),
  })
  result = await request('receiptExtract', {
    id: receipt.id,
    preserveEdits: true,
  })
  draft = result.workspace.receipt_extractions.find(
    (r: Item) => r.id === receipt.id,
  )
  expect(draft.pendingExtraction.vendor).toBe('Printed vendor')
  expect(draft.vendor).toBe('Owner correction')
  await request('receiptDismissExtraction', { id: receipt.id })
  await request('receiptExtract', { id: receipt.id, preserveEdits: true })
  const calls = runtime.provider.mock.calls.length
  result = await request('receiptExtract', {
    id: receipt.id,
    preserveEdits: true,
  })
  expect(result.error).toMatch(/limit reached/)
  expect(runtime.provider).toHaveBeenCalledTimes(calls)
  expect((await request()).workspace.ledger).toHaveLength(1)
})
it('discards provider results when the signed-in session expires during reading', async () => {
  const receipt = await upload()
  runtime.provider.mockImplementationOnce(async () => {
    runtime.expire = true
    return { text: JSON.stringify({ vendor: 'Unapplied result', total: 10 }) }
  })
  const result = await request('receiptExtract', { id: receipt.id })
  expect(result.status).toBe(400)
  expect(result.error).toMatch(/session expired/)
  runtime.expire = false
  const saved = (await request()).workspace.receipt_extractions.find(
    (r: Item) => r.id === receipt.id,
  )
  expect(saved.vendor).toBe('')
  expect(saved.extractionAttempts).toHaveLength(1)
  expect(saved.fileHash).toBe(receipt.fileHash)
})
it('discards provider results when oven write access is revoked during reading', async () => {
  const receipt = await upload()
  runtime.provider.mockImplementationOnce(async () => {
    await db.exec('RESET ROLE')
    await db.query(
      'UPDATE users SET active=false WHERE business_id=$1 AND identity_id=$2',
      [org, 'receipt-owner'],
    )
    await db.exec('SET ROLE receipt_app')
    return { text: JSON.stringify({ vendor: 'Unapplied result', total: 10 }) }
  })
  try {
    const result = await request('receiptExtract', { id: receipt.id })
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/access changed/)
  } finally {
    await db.exec('RESET ROLE')
    await db.query(
      'UPDATE users SET active=true WHERE business_id=$1 AND identity_id=$2',
      [org, 'receipt-owner'],
    )
    await db.exec('SET ROLE receipt_app')
  }
  const saved = (await request()).workspace.receipt_extractions.find(
    (r: Item) => r.id === receipt.id,
  )
  expect(saved.vendor).toBe('')
  expect(saved.extractionAttempts).toHaveLength(1)
})
it('receives a mixed inventory receipt with a resale variant, persists stable links, and audits date corrections without new postings', async () => {
  let result = await request('receiptManual', {})
  expect(result.status, result.error).toBe(200)
  const receipt = result.workspace.receipt_extractions.at(-1)
  const lines = [
    {
      description: 'Mixed flour',
      usedAs: 'ingredient',
      unit: 'g',
      quantity: 500,
      amount: 10,
      decision: 'inventory',
      createNew: true,
    },
    {
      description: 'Printed cotton fabric',
      usedAs: 'material',
      materialType: 'fabric',
      fabricTracking: 'length',
      pieceMode: 'aggregate',
      fabricWidth: 44,
      widthUnit: 'in',
      unit: 'yd',
      quantity: 2,
      amount: 10,
      decision: 'inventory',
      createNew: true,
    },
    {
      description: 'Bread bags',
      usedAs: 'packaging',
      unit: 'each',
      quantity: 100,
      amount: 10,
      decision: 'inventory',
      createNew: true,
    },
    {
      description: 'Cleaning cloths',
      usedAs: 'supply',
      unit: 'each',
      quantity: 4,
      amount: 10,
      decision: 'inventory',
      createNew: true,
    },
    {
      description: 'Market mug',
      usedAs: 'resale',
      itemTable: 'products',
      unit: 'pack',
      quantity: 2,
      itemsPerUnit: 6,
      packageContentsConfirmed: true,
      stockQuantityConfirmed: true,
      amount: 10,
      decision: 'inventory',
      createNew: true,
      variant: 'Blue',
      sku: 'MUG-B',
      retailPrice: 14,
      productSourceUrl: 'https://example.com/blue-mugs',
      itemCreationId: 'new-blue-mug',
    },
  ]
  const details = {
    ...receipt,
    vendor: 'Mixed inventory test',
    date: '2026-07-25',
    receivedDate: '2026-11-03',
    subtotal: 50,
    tax: 5,
    total: 55,
    lines,
  }
  result = await request('receiptCreateItem', { ...details, lineIndex: 4 })
  expect(result.status, result.error).toBe(200)
  let draft = result.workspace.receipt_extractions.find(
    (r: Item) => r.id === receipt.id,
  )
  const productId = draft.lines[4].itemId
  expect(
    result.workspace.products.find((p: Item) => p.id === productId),
  ).toMatchObject({ quantity: 0, price: 14, variant: 'Blue', sku: 'MUG-B' })
  const ledgerBefore = result.workspace.ledger.length
  expect(draft.lines[0]).toEqual(lines[0])
  result = await request('receiptCreateItem', { ...details, lineIndex: 4 })
  expect(result.status, result.error).toBe(200)
  expect(
    result.workspace.products.filter((p: Item) => p.id === productId),
  ).toHaveLength(1)
  expect(result.workspace.ledger).toHaveLength(ledgerBefore)
  draft = result.workspace.receipt_extractions.find(
    (r: Item) => r.id === receipt.id,
  )
  const confirmed = draft.lines.map((l: any) => ({
    ...l,
    stockQuantityConfirmed: true,
  }))
  result = await request('receiptPost', { ...draft, lines: confirmed })
  expect(result.status, result.error).toBe(200)
  const posted = result.workspace
  expect(posted.products.find((p: Item) => p.id === productId)).toMatchObject({
    quantity: 12,
    price: 14,
    cost: 11 / 12,
    variant: 'Blue',
    sku: 'MUG-B',
    productSourceUrl: 'https://example.com/blue-mugs',
  })
  const movements = posted.ledger.filter(
    (l: Item) => l.receiptId === receipt.id,
  )
  expect(movements).toHaveLength(5)
  const resale = movements.find((l: Item) => l.productId === productId)
  expect(resale).toMatchObject({
    quantity: 12,
    amount: 11,
    date: '2026-11-03',
    purchaseDate: '2026-07-25',
  })
  expect(
    posted.receipt_extractions.find((r: Item) => r.id === receipt.id).lines[4],
  ).toMatchObject({
    itemTable: 'products',
    itemId: productId,
    createNew: false,
  })
  expect(posted.journals.at(-1).date).toBe('2026-07-25')
  const corrections = {
    id: resale.id,
    receivedDate: '2026-11-02',
    expectedDate: '2026-11-03',
    reason: 'Owner confirmed physical receiving day',
    operationId: crypto.randomUUID(),
    confirmed: true,
  }
  // Date corrections use the same authenticated endpoint, table ownership and permissions.
  result = await request('receivedDateCorrection', corrections)
  expect(result.status, result.error).toBe(200)
  const corrected = result.workspace.ledger.find(
    (l: Item) => l.id === resale.id,
  )
  expect(corrected).toMatchObject({
    date: '2026-11-02',
    originalReceivedDate: '2026-11-03',
    quantity: 12,
    amount: 11,
  })
  expect(
    result.workspace.settings[0].receivedDateCorrections.at(-1),
  ).toMatchObject({
    ledgerId: resale.id,
    originalDate: '2026-11-03',
    actor: 'receipt-owner',
  })
  await db.query("SELECT set_config('app.business_id',$1,false)", [org])
  const original = await db.query<{ data: Item }>(
    'SELECT data FROM ledger WHERE business_id=$1 AND id=$2',
    [org, resale.id],
  )
  expect(original.rows[0].data.date).toBe('2026-11-03')
  result = await request('receivedDateCorrection', corrections)
  expect(result.status, result.error).toBe(200)
  expect(result.workspace.ledger).toHaveLength(posted.ledger.length)
  expect(result.workspace.journals).toHaveLength(posted.journals.length)
  expect((await request('receiptPost', { id: receipt.id })).status).toBe(400)
  const reopened = (await request()).workspace
  expect(reopened.products.find((p: Item) => p.id === productId).quantity).toBe(
    12,
  )
  expect(reopened.ledger).toHaveLength(posted.ledger.length)
  runtime.user = 'receipt-other'
  expect(
    (
      await request('receivedDateCorrection', {
        ...corrections,
        operationId: crypto.randomUUID(),
      })
    ).status,
  ).toBe(400)
})

async function addInventory(data: Record<string, any>) {
  const response = await handler(
    new Request('https://receipt-test.invalid/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save',
        table: data.usedAs === 'resale' ? 'products' : 'ingredients',
        data: { inventoryCreation: true, ...data },
      }),
    }),
    context,
  )
  return { status: response.status, ...(await response.json()) }
}
it.each(inventoryPackageExamples)(
  'saves $name package costing and independent opening counts with safe retries',
  async (example) => {
    const { stock, base, value, ...input } = example
    const before = (await request()).workspace
    for (const initialStock of [true, false]) {
      const data = {
        ...input,
        id: crypto.randomUUID(),
        name: 'Rollout ' + example.name,
        creationRequestId: crypto.randomUUID(),
        inventoryPackageSetup: true,
        initialStock,
        stockAction: 'opening',
        receivedDate: '2026-11-04',
      }
      const result = await addInventory(data)
      expect(result.status, result.error).toBe(200)
      const retry = await addInventory(data)
      expect(retry.status, retry.error).toBe(200)
      const w = retry.workspace
      const item = w[
        example.usedAs === 'resale' ? 'products' : 'ingredients'
      ].find((i: Item) => i.id === data.id)
      expect(item.quantity).toBeCloseTo(initialStock ? base : 0)
      expect(item.storageUnit).toBe(example.unit)
      expect(item.purchaseUnit).toBe(example.purchaseUnit)
      expect(item.amountPerPackage).toBe(example.amountPerPackage)
      expect(item.packagePrice).toBe(example.packagePrice)
      expect(item.quantity * item.cost).toBeCloseTo(initialStock ? value : 0)
      expect(
        w.ledger.filter(
          (l: Item) => l.ingredientId === item.id || l.productId === item.id,
        ),
      ).toHaveLength(initialStock ? 1 : 0)
      const journals = w.journals.filter((j: Item) => j.sourceId === item.id)
      expect(journals).toHaveLength(initialStock ? 1 : 0)
      if (initialStock)
        expect(
          w.ledger.find(
            (l: Item) => l.ingredientId === item.id || l.productId === item.id,
          ).stockQuantity,
        ).toBe(stock)
      if (initialStock)
        expect(journals[0].lines).toEqual([
          { account: 'Inventory asset', debit: value, credit: 0 },
          { account: 'Owner equity', debit: 0, credit: value },
        ])
      if (example.usedAs === 'resale') {
        expect(item.stockEntry.sellUnit).toBe('sealed pack')
        expect(item.stockEntry.quantity || 0).toBe(initialStock ? 3 : 0)
        expect(item.purchaseQuantity).toBeUndefined()
        expect(item.purchaseCost).toBeUndefined()
      }
      if (example.usedAs === 'material' && example.materialType === 'fabric') {
        expect(item.fabricWidth).toBe(44)
        expect(item.fabricTracking).toBe(example.fabricTracking)
        expect(item.unit).toBe(example.unit)
      }
      expect((await addInventory({ ...data, openingCount: 2 })).status).toBe(
        400,
      )
    }
    const after = (await request()).workspace
    for (const item of before.ingredients)
      expect(after.ingredients.find((i: Item) => i.id === item.id)).toEqual(
        item,
      )
    expect(after.recipes).toEqual(before.recipes)
  },
)
it.each([
  [1, 'bag', 2, 3],
  [1, 'lb', 1, 1.5],
  [0.5, 'bag', 1, 1.5],
])(
  'creates ingredient opening stock of %s %s without duplicate postings',
  async (openingCount, openingCountUnit, stockQuantity, value) => {
    const data = {
      id: crypto.randomUUID(),
      creationRequestId: crypto.randomUUID(),
      name: 'Example flour',
      usedAs: 'ingredient',
      inventoryPackageSetup: true,
      unit: 'lb',
      purchaseUnit: 'bag',
      amountPerPackage: 2,
      packagePrice: 3,
      initialStock: true,
      stockAction: 'opening',
      openingCount,
      openingCountUnit,
      receivedDate: '2026-11-04',
    }
    const before = (await request()).workspace
    const result = await addInventory(data)
    expect(result.status, result.error).toBe(200)
    const retry = await addInventory(data)
    expect(retry.status, retry.error).toBe(200)
    const workspace = retry.workspace
    const item = workspace.ingredients.find((i: Item) => i.id === data.id)
    expect(item.quantity).toBeCloseTo(stockQuantity * 453.59237)
    expect(item.unit).toBe('g')
    expect(item.storageUnit).toBe('lb')
    expect(item.purchaseQuantity).toBe(1)
    expect(item.purchaseUnit).toBe('bag')
    expect(item.packagePrice).toBe(3)
    expect(item.quantity * item.cost).toBeCloseTo(value)
    expect(packageCost(item).unitCost).toBeCloseTo(1.5)
    expect(
      recipeCost(
        {
          id: 'example-recipe',
          name: 'Example',
          yield: 1,
          lines: [{ ingredientId: item.id, quantity: 1, unit: 'lb' }],
        },
        [item],
      ),
    ).toBeCloseTo(1.5)
    expect(
      workspace.ledger.filter((l: Item) => l.ingredientId === item.id),
    ).toHaveLength(1)
    const ledger = workspace.ledger.find(
      (l: Item) => l.ingredientId === item.id,
    )
    expect(ledger).toMatchObject({
      type: 'opening_balance',
      openingCount,
      openingCountUnit,
      stockQuantity,
      stockUnit: 'lb',
      amount: value,
    })
    const journals = workspace.journals.filter(
      (j: Item) => j.sourceId === item.id,
    )
    expect(journals).toHaveLength(1)
    expect(journals[0].lines).toEqual([
      { account: 'Inventory asset', debit: value, credit: 0 },
      { account: 'Owner equity', debit: 0, credit: value },
    ])
    expect(workspace.ingredients.filter((i: Item) => i.id !== item.id)).toEqual(
      before.ingredients,
    )
    expect(workspace.recipes).toEqual(before.recipes)
    expect(workspace.products).toEqual(before.products)
    expect((await addInventory({ ...data, openingCount: 2 })).status).toBe(400)
  },
)

it('creates an ingredient without opening stock and preserves unknown versus zero cost', async () => {
  for (const packagePrice of [3, '', 0]) {
    const data = {
      id: crypto.randomUUID(),
      creationRequestId: crypto.randomUUID(),
      name: 'No opening stock',
      usedAs: 'ingredient',
      inventoryPackageSetup: true,
      unit: 'lb',
      purchaseUnit: 'bag',
      amountPerPackage: 2,
      packagePrice,
      initialStock: false,
      openingCount: 1,
      openingCountUnit: 'bag',
    }
    const result = await addInventory(data)
    expect(result.status, result.error).toBe(200)
    const w = result.workspace
    const item = w.ingredients.find((i: Item) => i.id === data.id)
    expect(item.quantity).toBe(0)
    expect(w.ledger.some((l: Item) => l.ingredientId === item.id)).toBe(false)
    expect(w.journals.some((j: Item) => j.sourceId === item.id)).toBe(false)
    expect(item.needsCostSetup).toBe(packagePrice === '')
    if (packagePrice === '') expect(item.currentCost).toBeUndefined()
    else
      expect(item.currentCost).toBeCloseTo(
        Number(packagePrice) / (2 * 453.59237),
      )
  }
})

it('keeps the optional opening valuation override separate from package cost and posting dates', async () => {
  const data = {
    id: crypto.randomUUID(),
    creationRequestId: crypto.randomUUID(),
    name: 'Valuation example',
    usedAs: 'ingredient',
    inventoryPackageSetup: true,
    unit: 'lb',
    purchaseUnit: 'bag',
    amountPerPackage: 2,
    packagePrice: 3,
    initialStock: true,
    stockAction: 'opening',
    openingCount: 1,
    openingCountUnit: 'bag',
    openingValueOverride: true,
    openingValue: 2.5,
    receivedDate: '2026-11-04',
    purchaseDate: '2026-10-01',
  }
  const result = await addInventory(data)
  expect(result.status, result.error).toBe(200)
  const w = result.workspace
  const item = w.ingredients.find((i: Item) => i.id === data.id)
  expect(item.quantity * item.cost).toBeCloseTo(2.5)
  expect(packageCost(item).unitCost).toBeCloseTo(1.5)
  expect(item.currentCost).toBeCloseTo(3 / (2 * 453.59237))
  expect(w.journals.find((j: Item) => j.sourceId === item.id)).toMatchObject({
    date: '2026-11-04',
  })
})

it('rejects ingredient opening stock without a valid conversion or valuation before writing', async () => {
  const data = {
    id: crypto.randomUUID(),
    creationRequestId: crypto.randomUUID(),
    name: 'Incomplete opening stock',
    usedAs: 'ingredient',
    inventoryPackageSetup: true,
    unit: 'lb',
    purchaseUnit: 'bag',
    amountPerPackage: '',
    packagePrice: 3,
    initialStock: true,
    stockAction: 'opening',
    openingCount: 1,
    openingCountUnit: 'bag',
    receivedDate: '2026-11-04',
  }
  expect((await addInventory(data)).status).toBe(400)
  expect(
    (await addInventory({ ...data, amountPerPackage: 2, packagePrice: '' }))
      .status,
  ).toBe(400)
  const w = (await request()).workspace
  expect(w.ingredients.some((i: Item) => i.id === data.id)).toBe(false)
  expect(w.ledger.some((l: Item) => l.ingredientId === data.id)).toBe(false)
  expect(w.journals.some((j: Item) => j.sourceId === data.id)).toBe(false)
})

it('creates every shared inventory type without stock and preserves fields on reload', async () => {
  for (const usedAs of [
    'ingredient',
    'packaging',
    'material',
    'supply',
    'resale',
  ]) {
    const id = crypto.randomUUID()
    const data = {
      id,
      name: `Shared ${usedAs}`,
      creationRequestId: crypto.randomUUID(),
      usedAs,
      materialType: 'yarn',
      unit: 'each',
      storageLocation: 'Shelf B',
      initialStock: false,
      price: 12,
      yarnLength: 120,
      yarnLengthUnit: 'yd',
    }
    const result = await addInventory(data)
    expect(result.status, result.error).toBe(200)
    const retry = await addInventory(data)
    expect(retry.status, retry.error).toBe(200)
    const w = (await request()).workspace
    const table = usedAs === 'resale' ? 'products' : 'ingredients'
    const item = w[table].find((i: Item) => i.id === id)
    expect(item.storageLocation).toBe('Shelf B')
    expect(item.quantity).toBe(0)
    expect(
      w.ledger.filter((l: Item) => l.ingredientId === id || l.productId === id),
    ).toHaveLength(0)
    expect(w[table].filter((i: Item) => i.id === id)).toHaveLength(1)
    if (usedAs === 'resale') expect(item.workflow).toBe('resale')
  }
})
it.each(['opening', 'purchase'])(
  'posts %s stock atomically, with pack costing and safe retries',
  async (stockAction) => {
    const id = crypto.randomUUID(),
      creationRequestId = crypto.randomUUID()
    const data = {
      id,
      creationRequestId,
      name: 'Bread bags',
      usedAs: 'packaging',
      unit: 'each',
      purchaseUnit: 'pack',
      itemsPerUnit: 100,
      packageContentsConfirmed: true,
      contentsUnit: 'each',
      initialStock: true,
      stockAction,
      purchaseQuantity: 2,
      packagePrice: 24,
      receivedDate: '2026-11-04',
    }
    const result = await addInventory(data)
    expect(result.status, result.error).toBe(200)
    const retry = await addInventory(data)
    expect(retry.status, retry.error).toBe(200)
    const w = retry.workspace,
      item = w.ingredients.find((i: Item) => i.id === id)
    expect(item.quantity).toBe(200)
    expect(item.cost).toBeCloseTo(0.12)
    expect(w.ledger.filter((l: Item) => l.ingredientId === id)).toHaveLength(1)
    const journal = w.journals.find((j: Item) => j.sourceId === id)
    expect(journal.lines[1].account).toBe(
      stockAction === 'opening' ? 'Owner equity' : 'Cash',
    )
    const altered = await addInventory({ ...data, packagePrice: 25 })
    expect(altered.status).not.toBe(200)
  },
)
it('creates fractional fabric with independent width and resale stock in its product record', async () => {
  const fabric = {
    id: crypto.randomUUID(),
    creationRequestId: crypto.randomUUID(),
    name: 'Linen',
    usedAs: 'material',
    materialType: 'fabric',
    fabricTracking: 'length',
    pieceMode: 'aggregate',
    fabricWidth: 44,
    widthUnit: 'in',
    unit: 'yd',
    purchaseUnit: 'yd',
    initialStock: true,
    stockAction: 'purchase',
    purchaseQuantity: 1.25,
    packagePrice: 10,
    receivedDate: '2026-11-04',
  }
  const result = await addInventory(fabric)
  expect(result.status, result.error).toBe(200)
  const saved = result.workspace.ingredients.find(
    (i: Item) => i.id === fabric.id,
  )
  expect(saved.quantity).toBe(1.25)
  expect(saved.fabricWidth).toBe(44)
  const resale = {
    id: crypto.randomUUID(),
    creationRequestId: crypto.randomUUID(),
    name: 'Mug',
    usedAs: 'resale',
    unit: 'each',
    purchaseUnit: 'pack',
    itemsPerUnit: 6,
    packageContentsConfirmed: true,
    initialStock: true,
    stockAction: 'purchase',
    purchaseQuantity: 2,
    packagePrice: 24,
    price: 10,
    receivedDate: '2026-11-04',
  }
  const sale = await addInventory(resale)
  expect(sale.status, sale.error).toBe(200)
  const product = sale.workspace.products.find((i: Item) => i.id === resale.id)
  expect(product.quantity).toBe(12)
  expect(product.cost).toBe(2)
  expect(product.price).toBe(10)
  expect(sale.workspace.ingredients.some((i: Item) => i.id === resale.id)).toBe(
    false,
  )
  runtime.user = 'receipt-other'
  expect(
    (await request()).workspace.products.some((i: Item) => i.id === resale.id),
  ).toBe(false)
})
it('retains confirmed pack conversion and reference costing without stock, then uses existing receiving safely', async () => {
  const data = {
    id: crypto.randomUUID(),
    creationRequestId: crypto.randomUUID(),
    name: 'Reference bags',
    usedAs: 'packaging',
    unit: 'each',
    purchaseUnit: 'pack',
    itemsPerUnit: 100,
    packageContentsConfirmed: true,
    contentsUnit: 'each',
    initialStock: false,
    referencePrice: 12,
    referenceQuantity: 1,
  }
  const created = await addInventory(data)
  expect(created.status, created.error).toBe(200)
  expect(
    created.workspace.ingredients.find((i: Item) => i.id === data.id)
      .currentCost,
  ).toBe(0.12)
  const operationId = crypto.randomUUID()
  const receive = async () => {
    const response = await handler(
      new Request('https://receipt-test.invalid/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'receive',
          table: 'ingredients',
          data: {
            id: data.id,
            operationId,
            quantity: 1,
            unit: 'pack',
            price: 13,
            receivedDate: '2026-11-04',
          },
        }),
      }),
      context,
    )
    return { status: response.status, ...(await response.json()) }
  }
  const received = await receive()
  expect(received.status, received.error).toBe(200)
  expect(
    received.workspace.ingredients.find((i: Item) => i.id === data.id).quantity,
  ).toBe(100)
  const retry = await receive()
  expect(retry.status, retry.error).toBe(200)
  expect(
    retry.workspace.ledger.filter((l: Item) => l.ingredientId === data.id),
  ).toHaveLength(1)
})
it('adds resale starting inventory in sellable units without a purchase expense', async () => {
  const data = {
    id: crypto.randomUUID(),
    creationRequestId: crypto.randomUUID(),
    name: 'Sparkling water 15 pack',
    usedAs: 'resale',
    unit: 'each',
    price: 2,
    initialStock: false,
    stockChoice: 'existing',
    sellUnit: 'bottle',
    countMethod: 'packs',
    packCount: 2,
    unitsPerPack: 15,
    looseUnits: 3,
    startingCount: 99,
    costBasis: 'pack',
    costAmount: 7.5,
    receivedDate: '2026-11-04',
    receiptReference: 'hidden-ref',
    purchaseUnit: 'case',
    itemsPerUnit: 15,
    purchaseQuantity: 9,
  }
  const result = await addInventory(data)
  expect(result.status, result.error).toBe(200)
  const retry = await addInventory(data)
  expect(retry.status, retry.error).toBe(200)
  const w = (await request()).workspace
  const product = w.products.find((p: Item) => p.id === data.id)
  expect(product.quantity).toBe(33)
  expect(product.cost).toBeCloseTo(0.5)
  expect(product.stockCostKnown).toBe(true)
  expect(product.sellUnit).toBe('bottle')
  expect(product.stockEntry).toMatchObject({
    choice: 'existing',
    countMethod: 'packs',
    packCount: 2,
    unitsPerPack: 15,
    looseUnits: 3,
    costBasis: 'pack',
    costAmount: 7.5,
    totalCost: 16.5,
  })
  expect(product.purchaseQuantity).toBeUndefined()
  expect(product.receiptReference).toBeUndefined()
  const ledger = w.ledger.filter((l: Item) => l.productId === data.id)
  expect(ledger).toHaveLength(1)
  expect(ledger[0]).toMatchObject({ type: 'opening_balance', quantity: 33 })
  const journals = w.journals.filter((j: Item) => j.sourceId === data.id)
  expect(journals).toHaveLength(1)
  const accounts = journals[0].lines.map((l: Item) => l.account)
  expect(accounts).toEqual(['Inventory asset', 'Owner equity'])
  expect(accounts.some((a: string) => /cash|expense|cogs/i.test(a))).toBe(false)
})
it('records a resale purchase in sellable units and rejects unknown starting cost', async () => {
  const purchase = {
    id: crypto.randomUUID(),
    creationRequestId: crypto.randomUUID(),
    name: 'Cola',
    usedAs: 'resale',
    unit: 'each',
    initialStock: false,
    stockChoice: 'purchase',
    sellUnit: 'sealed pack',
    purchaseQuantity: 2,
    purchaseUnit: 'case',
    itemsPerUnit: 4,
    packageContentsConfirmed: true,
    costBasis: 'total',
    costAmount: 40,
    receivedDate: '2026-11-04',
  }
  const result = await addInventory(purchase)
  expect(result.status, result.error).toBe(200)
  const product = result.workspace.products.find(
    (p: Item) => p.id === purchase.id,
  )
  expect(product.quantity).toBe(8)
  expect(product.cost).toBe(5)
  expect(product.sellUnitPlural).toBe('sealed packs')
  expect(
    result.workspace.journals.find((j: Item) => j.sourceId === purchase.id)
      .lines[1].account,
  ).toBe('Cash')
  const unknown = await addInventory({
    id: crypto.randomUUID(),
    creationRequestId: crypto.randomUUID(),
    name: 'Mystery jam',
    usedAs: 'resale',
    unit: 'each',
    stockChoice: 'existing',
    sellUnit: 'jar',
    countMethod: 'direct',
    startingCount: 5,
    costBasis: 'unknown',
    receivedDate: '2026-11-04',
  })
  expect(unknown.status).not.toBe(200)
  expect(unknown.error).toMatch(/acquisition cost/)
})
it('posts calculated manual receipts once, preserves printed evidence and keeps draft/failed confirmation free of effects', async () => {
  const created = await request('receiptManual', {})
  expect(created.status, created.error).toBe(200)
  const r = created.workspace.receipt_extractions.at(-1)
  const data = {
    id: r.id,
    arithmeticVersion: 2,
    vendor: 'Disposable manual receipt',
    date: '2026-11-10',
    receivedDate: '2026-11-10',
    taxTreatment: 'exclusive',
    tax: 0.8,
    receiptDiscount: 1,
    otherCharges: 0.2,
    printedTotal: 10,
    lines: [
      {
        description: 'Paper supplies',
        amountMode: 'quantity',
        printedQuantity: 2,
        unitPrice: 3,
        decision: 'expense',
        category: 'Supplies expense',
      },
      {
        description: 'Personal',
        amountMode: 'direct',
        enteredAmount: 4,
        decision: 'personal',
      },
    ],
  }
  const before = (await request()).workspace
  const saved = await request('receiptDraft', data)
  expect(saved.status, saved.error).toBe(200)
  expect(saved.workspace.journals).toHaveLength(before.journals.length)
  expect(saved.workspace.ledger).toHaveLength(before.ledger.length)
  expect(saved.workspace.expenses).toHaveLength(before.expenses.length)
  expect(
    saved.workspace.receipt_extractions.find((x: Item) => x.id === r.id),
  ).toMatchObject({ subtotal: 10, total: 10, printedTotal: 10 })
  const failed = await request('receiptPost', { ...data, printedTotal: 11 })
  expect(failed.status).toBe(400)
  expect((await request()).workspace.journals).toHaveLength(
    before.journals.length,
  )
  const posted = await request('receiptPost', data)
  expect(posted.status, posted.error).toBe(200)
  expect(posted.workspace.expenses).toHaveLength(before.expenses.length + 1)
  expect(posted.workspace.expenses.at(-1).amount).toBe(6)
  expect(posted.workspace.ledger).toHaveLength(before.ledger.length)
  const retry = await request('receiptPost', data)
  expect(retry.status, retry.error).toBe(200)
  expect(retry.workspace.journals).toHaveLength(
    posted.workspace.journals.length,
  )
  expect(retry.workspace.finance_transactions).toHaveLength(
    posted.workspace.finance_transactions.length,
  )
  runtime.user = 'receipt-other'
  expect((await request('receiptPost', data)).status).toBe(400)
})
it('attaches a calculated draft to an existing expense without recording expense or stock twice', async () => {
  const created = await request('receiptManual', {})
  const r = created.workspace.receipt_extractions.at(-1)
  const entry = await request('financeEntry', {
    kind: 'expense',
    name: 'Disposable attachment test',
    date: '2026-11-10',
    amount: 5,
    category: 'Supplies expense',
  })
  expect(entry.status, entry.error).toBe(200)
  const tx = entry.workspace.finance_transactions.at(-1)
  const data = {
    id: r.id,
    arithmeticVersion: 2,
    vendor: 'Disposable attachment test',
    date: '2026-11-10',
    taxTreatment: 'inclusive',
    tax: 0,
    lines: [
      {
        description: 'Paper',
        amountMode: 'direct',
        enteredAmount: 5,
        decision: 'expense',
        category: 'Supplies expense',
      },
    ],
  }
  expect((await request('receiptDraft', data)).status).toBe(200)
  const attached = await request('receiptMatch', {
    id: r.id,
    transactionId: tx.id,
  })
  expect(attached.status, attached.error).toBe(200)
  expect(attached.workspace.expenses).toHaveLength(
    entry.workspace.expenses.length,
  )
  expect(attached.workspace.journals).toHaveLength(
    entry.workspace.journals.length,
  )
  expect(attached.workspace.ledger).toHaveLength(entry.workspace.ledger.length)
  expect(
    attached.workspace.receipt_extractions.find((x: Item) => x.id === r.id),
  ).toMatchObject({ status: 'attached', matchedTransactionId: tx.id })
  expect((await request('receiptPost', data)).status).toBe(400)
})
it('keeps stock, valuation, expenses and journal unchanged when a later line fails confirmation', async () => {
  const created = await request('receiptManual', {})
  const receipt = created.workspace.receipt_extractions.at(-1)
  const before = created.workspace
  const invalid = await request('receiptPost', {
    id: receipt.id,
    arithmeticVersion: 2,
    vendor: 'Disposable atomic confirmation',
    date: '2026-11-10',
    receivedDate: '2026-11-10',
    taxTreatment: 'exclusive',
    tax: 0,
    lines: [
      {
        description: 'Flour',
        amountMode: 'direct',
        enteredAmount: 1,
        decision: 'inventory',
        itemId: 'flour',
        itemTable: 'ingredients',
        quantity: 100,
        unit: 'g',
        stockQuantityConfirmed: true,
      },
      {
        description: 'Uncategorized supplies',
        amountMode: 'direct',
        enteredAmount: 1,
        decision: 'expense',
        category: '',
      },
    ],
  })
  expect(invalid.status).toBe(400)
  expect(invalid.error).toContain('category')
  const after = (await request()).workspace
  expect(after.ledger).toHaveLength(before.ledger.length)
  expect(after.expenses).toHaveLength(before.expenses.length)
  expect(after.journals).toHaveLength(before.journals.length)
  expect(after.ingredients.find((i: Item) => i.id === 'flour')).toEqual(
    before.ingredients.find((i: Item) => i.id === 'flour'),
  )
})
