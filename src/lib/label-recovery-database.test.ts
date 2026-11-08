// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import type { Context } from '@netlify/functions'
import type { Item } from './domain'
import { readFile } from 'node:fs/promises'
import { fixtureMigrationNames } from '../../tests/database-fixture-migrations'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import {
  blankLabel,
  newElement,
  resolveLabelData,
  type LabelDocument,
} from './label-studio'
import { labelContent } from './label-persistence'
import { labelLayout } from './label-sets'
import { defaultSheet } from './label-print-layout'
import { duplicateSavedLabel, sourceKey } from './saved-labels'
const runtime = vi.hoisted(() => ({
  client: null as null | {
    query: (sql: string, params?: unknown[]) => Promise<unknown>
    release: () => void
  },
  user: 'label-owner-a',
  expired: false,
  selected: undefined as string | undefined,
  failWrite: false,
}))
vi.mock('@netlify/database', () => ({
  getDatabase: () => ({ pool: { connect: async () => runtime.client } }),
}))
vi.mock('../../netlify/lib/verified-session', async (original) => ({
  ...(await original<typeof import('../../netlify/lib/verified-session')>()),
  verifiedSession: async () =>
    runtime.expired
      ? null
      : { id: runtime.user, confirmedAt: '2026-01-01T00:00:00Z' },
  selectedWorkspace: () => runtime.selected,
}))
import handler from '../../netlify/functions/workspace.mts'
const db = new PGlite(),
  orgA = '00000000-0000-4000-8000-000000000021',
  orgB = '00000000-0000-4000-8000-000000000022'
const context = { cookies: { get: () => 'a'.repeat(64) } } as unknown as Context
async function request(
  action?: string,
  data?: Record<string, unknown>,
  table?: string,
) {
  const response = await handler(
    new Request(
      'https://label-test.invalid/api/workspace',
      action
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, data, table }),
          }
        : {},
    ),
    context,
  )
  return { status: response.status, ...(await response.json()) }
}
function label(): LabelDocument {
  return {
    ...blankLabel(),
    id: crypto.randomUUID(),
    name: 'Editable bread label',
    workflowVersion: 1,
    recordKind: 'label',
    source: { kind: 'product', id: 'label-product-a' },
    productId: 'label-product-a',
    manualTextReviewedFor: 'product:label-product-a:',
    displayUnit: 'mm',
    elements: [
      {
        ...newElement('text', '', 'recipe.ingredients'),
        rotation: 180,
        x: 207,
        y: 81,
        width: 198,
        height: 42,
      },
      {
        ...newElement('text', '', 'product.labelMainName'),
        font: 'Lora',
        groupId: 'product-name',
      },
      {
        ...newElement('text', '', 'product.labelProductType'),
        font: 'DM Sans',
        groupId: 'product-name',
        y: 60,
      },
      {
        ...newElement('text', 'Mixed font'),
        textRuns: [
          { id: 'a', text: 'Mixed ', font: 'Lora' },
          { id: 'b', text: 'font', font: 'DM Sans' },
        ],
      },
    ],
  }
}
beforeAll(async () => {
  const root = new URL('../../netlify/database/migrations/', import.meta.url)
  for (const name of await fixtureMigrationNames(root))
    await db.exec(
      await readFile(new URL(`${name}/migration.sql`, root), 'utf8'),
    )
  for (const [org, user] of [
    [orgA, 'label-owner-a'],
    [orgB, 'label-owner-b'],
  ]) {
    await db.query(
      'INSERT INTO businesses(id,business_name,identity_owner) VALUES($1,$2,$3)',
      [org, 'Label test', user],
    )
    await db.query(
      'INSERT INTO users(id,business_id,data,identity_id,role) VALUES($1,$2,$3,$4,$5)',
      ['owner', org, '{}', user, 'Owner'],
    )
    await db.query(
      'INSERT INTO settings(id,business_id,data) VALUES($1,$2,$3)',
      [
        'business',
        org,
        JSON.stringify({ id: 'business', name: 'Label test', taxRates: [] }),
      ],
    )
    for (const id of ['label-product-a', 'label-product-b'])
      await db.query(
        'INSERT INTO products(id,business_id,data,recipe_id,quantity,cost) VALUES($1,$2,$3,NULL,0,0)',
        [
          id,
          org,
          JSON.stringify({
            id,
            name: id,
            labelMainName: 'Bread',
            labelProductType: 'Loaf',
            workflow: 'resale',
          }),
        ],
      )
    await db.query(
      'INSERT INTO graphic_assets(id,business_id,data) VALUES($1,$2,$3)',
      [
        'shared-graphic',
        org,
        JSON.stringify({
          id: 'shared-graphic',
          name: 'Shared bread artwork',
          fileUrl: '/api/workspace?asset=shared-graphic',
        }),
      ],
    )
  }
  await db.query(
    'INSERT INTO users(id,business_id,data,identity_id,role) VALUES($1,$2,$3,$4,$5)',
    ['second-owner', orgA, '{}', 'second-owner', 'Owner'],
  )
  await db.query(
    'INSERT INTO users(id,business_id,data,identity_id,role) VALUES($1,$2,$3,$4,$5)',
    ['reader', orgA, '{}', 'label-reader', 'Read-only Accountant'],
  )
  await db.exec(
    'CREATE ROLE label_app; GRANT USAGE ON SCHEMA public TO label_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO label_app; SET ROLE label_app;',
  )
  runtime.client = {
    query: (sql: string, params?: unknown[]) => {
      if (runtime.failWrite && sql.startsWith('INSERT INTO label_elements'))
        throw new Error('Simulated write failure')
      return db.query(sql, params)
    },
    release() {},
  }
}, 30000)
afterAll(async () => db.close())
it('commits creation and updates atomically, reopens identical content, and makes uncertain-response retries idempotent', async () => {
  const document = label(),
    operationId = crypto.randomUUID()
  let result = await request('labelSave', {
    document,
    expectedRevision: 0,
    operationId,
  })
  expect(result.status, result.error).toBe(200)
  expect(result.workspace.label_templates[0].revision).toBe(1)
  expect(labelContent(result.workspace.label_templates[0])).toBe(
    labelContent(document),
  )
  result = await request('labelSave', {
    document,
    expectedRevision: 0,
    operationId,
  })
  expect(result.status, result.error).toBe(200)
  expect(result.workspace.label_versions).toHaveLength(1)
  const reopened = (await request()).workspace.label_templates[0]
  expect(labelContent(reopened)).toBe(labelContent(document))
  expect(reopened.elements).toEqual(document.elements)
  const updated = {
    ...document,
    name: 'Updated label',
    elements: document.elements.map((e) => ({ ...e, letterSpacing: 1.25 })),
  }
  result = await request('labelSave', {
    document: updated,
    expectedRevision: 1,
    operationId: crypto.randomUUID(),
  })
  expect(result.status, result.error).toBe(200)
  expect(labelContent((await request()).workspace.label_templates[0])).toBe(
    labelContent(updated),
  )
  const stale = await request('labelSave', {
    document,
    expectedRevision: 0,
    operationId: crypto.randomUUID(),
  })
  expect(stale.status).toBe(400)
  expect((await request()).workspace.label_templates[0].name).toBe(
    'Updated label',
  )
})
it('rolls back a partially written document and keeps its preceding version intact', async () => {
  const document = label()
  runtime.failWrite = true
  const failed = await request('labelSave', {
    document,
    expectedRevision: 0,
    operationId: crypto.randomUUID(),
  })
  runtime.failWrite = false
  expect(failed.status).toBe(400)
  const w = (await request()).workspace
  expect(w.label_templates.some((d: Item) => d.id === document.id)).toBe(false)
  expect(w.label_versions.some((d: Item) => d.templateId === document.id)).toBe(
    false,
  )
})
it('persists checkpoints per user and oven, retains newer edits after an older save, and handles late checkpoints', async () => {
  const document = label(),
    sessionId = crypto.randomUUID()
  const scope = (await request()).workspace.settings[0].labelEditorScope
  const draft = (sequence: number, doc = document) => ({
    id: crypto.randomUUID(),
    sessionId,
    sequence,
    document: doc,
    baseRevision: 0,
    expectedScope: scope,
  })
  expect(
    (await request('labelSave', { document, expectedRevision: 0 })).status,
  ).toBe(200)
  const first = draft(1),
    newer = draft(2, { ...document, name: 'Newer unsaved edits' })
  expect((await request('labelDraft', first)).status).toBe(200)
  expect((await request('labelDraft', newer)).status).toBe(200)
  let result = await request('labelSave', {
    document,
    expectedRevision: 1,
    operationId: crypto.randomUUID(),
    sessionId,
    sequence: 1,
    expectedScope: scope,
  })
  expect(result.status, result.error).toBe(200)
  expect(result.workspace.label_recovery_drafts).toHaveLength(1)
  expect(result.workspace.label_recovery_drafts[0].document.name).toBe(
    'Newer unsaved edits',
  )
  expect((await request('labelDraft', draft(1))).status).toBe(200)
  result = await request()
  expect(result.workspace.label_recovery_drafts).toHaveLength(1)
  expect(result.workspace.label_recovery_drafts[0].document.name).toBe(
    'Newer unsaved edits',
  )
  runtime.user = 'second-owner'
  expect((await request()).workspace.label_recovery_drafts).toHaveLength(0)
  runtime.user = 'label-owner-b'
  result = await request()
  expect(result.workspace.label_recovery_drafts).toHaveLength(0)
  expect(result.workspace.label_templates).toHaveLength(0)
  expect((await request('labelDraft', first)).status).toBe(400)
  runtime.user = 'label-owner-a'
})
it('rejects expired sessions, read-only users, changed ovens, and operation IDs reused for different edits', async () => {
  const document = label(),
    operationId = crypto.randomUUID()
  runtime.expired = true
  expect(
    (await request('labelSave', { document, operationId, expectedRevision: 0 }))
      .status,
  ).toBe(401)
  runtime.expired = false
  runtime.user = 'label-reader'
  expect(
    (await request('labelSave', { document, operationId, expectedRevision: 0 }))
      .status,
  ).toBe(400)
  runtime.user = 'label-owner-a'
  expect(
    (
      await request('labelSave', {
        document,
        operationId,
        expectedRevision: 0,
        expectedScope: 'wrong-workspace',
      })
    ).status,
  ).toBe(400)
  expect(
    (await request('labelSave', { document, operationId, expectedRevision: 0 }))
      .status,
  ).toBe(200)
  expect(
    (
      await request('labelSave', {
        document: { ...document, name: 'different' },
        operationId,
        expectedRevision: 1,
      })
    ).status,
  ).toBe(400)
})

it('stores multiple independent product labels and copies both layouts without inheritance', async () => {
  const document = {
    ...label(),
    format: 'front-back' as const,
    back: {
      ...labelLayout(label()),
      elements: [newElement('text', '', 'product.displayName')],
    },
  }
  const saved = await request('labelSave', { document, expectedRevision: 0 })
  expect(saved.status, saved.error).toBe(200)
  const copy = duplicateSavedLabel(document, document.source!)
  const result = await request('labelSave', {
    document: copy,
    expectedRevision: 0,
  })
  expect(result.status, result.error).toBe(200)
  expect(
    result.workspace.label_templates.filter(
      (d: Item) => d.productId === document.productId,
    ).length,
  ).toBeGreaterThanOrEqual(2)
  expect(
    result.workspace.label_templates.find((d: Item) => d.id === copy.id).back,
  ).toEqual(document.back)
  copy.name = 'Independent edit'
  expect(
    (await request('labelSave', { document: copy, expectedRevision: 1 }))
      .status,
  ).toBe(200)
  const deleted = await request('labelDelete', {
    ids: [copy.id],
    recordKind: 'label',
  })
  expect(deleted.status, deleted.error).toBe(200)
  expect(
    deleted.workspace.label_templates.find((d: Item) => d.id === document.id),
  ).toMatchObject({ name: document.name, revision: 1, back: JSON.parse(JSON.stringify(document.back)) })
  expect(
    deleted.workspace.label_templates.find((d: Item) => d.id === copy.id)
      .deletedAt,
  ).toBeTruthy()
  expect(
    (await request('labelSave', { document: copy, expectedRevision: 2 }))
      .status,
  ).toBe(400)
})
it('reopens independent page backgrounds and preserves them in duplicates and print snapshots', async () => {
  const document: LabelDocument = {
    ...label(),
    background: '#ffd08a',
    format: 'front-back',
    back: {
      ...labelLayout(label()),
      background: '#9dd8f0',
      elements: [newElement('text', 'Back details')],
    },
  }
  let result = await request('labelSave', { document, expectedRevision: 0 })
  expect(result.status, result.error).toBe(200)
  let reopened = (await request()).workspace.label_templates.find(
    (d: Item) => d.id === document.id,
  ) as LabelDocument
  expect(labelContent(reopened)).toBe(labelContent(document))
  const before = structuredClone(reopened)
  reopened.back!.background = '#b8dfef'
  result = await request('labelSave', { document: reopened, expectedRevision: 1 })
  expect(result.status, result.error).toBe(200)
  reopened = (await request()).workspace.label_templates.find(
    (d: Item) => d.id === document.id,
  )
  expect(reopened.background).toBe(before.background)
  expect(reopened.back).toEqual({ ...before.back, background: '#b8dfef' })
  expect(reopened.elements).toEqual(before.elements)
  const copy = duplicateSavedLabel(reopened, reopened.source!)
  result = await request('labelSave', { document: copy, expectedRevision: 0 })
  expect(result.status, result.error).toBe(200)
  const savedCopy = (await request()).workspace.label_templates.find(
    (d: Item) => d.id === copy.id,
  )
  expect(savedCopy.background).toBe('#ffd08a')
  expect(savedCopy.back).toEqual(reopened.back)
  const printed = await request('labelPrint', {
    templateId: copy.id,
    source: copy.source,
    copies: 1,
    parts: 'both',
    order: 'paired',
    layout: { ...defaultSheet, mode: 'roll' },
  })
  expect(printed.status, printed.error).toBe(200)
  const job = printed.workspace.label_print_jobs.at(-1)
  expect(job.sequence).toEqual(['front', 'back'])
  expect(job.documentSnapshot.background).toBe('#ffd08a')
  expect(job.documentSnapshot.back.background).toBe('#b8dfef')
})

it('rejects unsaved checkpoints and product changes without manual review, then resolves the new saved source', async () => {
  const document = label()
  expect(
    (
      await request('labelDraft', {
        id: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        sequence: 1,
        document,
      })
    ).status,
  ).toBe(400)
  document.source = { kind: 'product', id: 'label-product-b' }
  document.productId = 'label-product-b'
  const blocked = await request('labelSave', { document, expectedRevision: 0 })
  expect(blocked.status).toBe(400)
  expect(blocked.error).toMatch(/manually entered/)
  document.manualTextReviewedFor = sourceKey(document.source)
  expect(
    (await request('labelSave', { document, expectedRevision: 0 })).status,
  ).toBe(200)
  const wrong = await request('labelPrint', {
    templateId: document.id,
    source: { kind: 'product', id: 'label-product-a' },
    copies: 1,
    layout: defaultSheet,
  })
  expect(wrong.status).toBe(400)
  const printed = await request('labelPrint', {
    templateId: document.id,
    source: document.source,
    copies: 1,
    layout: defaultSheet,
  })
  expect(printed.status, printed.error).toBe(200)
  expect(printed.workspace.label_print_jobs.at(-1).productId).toBe(
    'label-product-b',
  )
})
it('preserves legacy templates and shared links and rejects obsolete assignment writes', async () => {
  await db.query("SELECT set_config('app.business_id',$1,false)", [orgA])
  const legacy = {
    ...label(),
    id: crypto.randomUUID(),
    workflowVersion: undefined,
    recordKind: 'template',
    productId: undefined,
    source: undefined,
  }
  await db.query(
    'INSERT INTO label_templates(id,business_id,data) VALUES($1,$2,$3)',
    [legacy.id, orgA, JSON.stringify(legacy)],
  )
  for (const id of ['label-product-a', 'label-product-b'])
    await db.query(
      "UPDATE products SET data=data || jsonb_build_object('labelDesignId',$1::text) WHERE business_id=$2 AND id=$3",
      [legacy.id, orgA, id],
    )
  const before = (await request()).workspace
  expect(
    (
      await request('labelSave', {
        document: { ...legacy, name: 'Overwrite' },
        expectedRevision: 0,
      })
    ).status,
  ).toBe(400)
  expect(
    (await request('labelDelete', { ids: [legacy.id], recordKind: 'template' }))
      .status,
  ).toBe(400)
  for (const action of ['templateAssignments', 'productLabelAssignment'])
    expect(
      (
        await request(action, {
          templateId: legacy.id,
          productId: 'label-product-a',
          labelId: '',
        })
      ).status,
    ).toBe(400)
  const source = { kind: 'product' as const, id: 'label-product-a' }
  const copy = duplicateSavedLabel(legacy as LabelDocument, source)
  copy.manualTextReviewedFor = sourceKey(source)
  expect(
    (await request('labelSave', { document: copy, expectedRevision: 0 }))
      .status,
  ).toBe(200)
  const after = (await request()).workspace
  expect(after.products).toEqual(before.products)
  expect(after.label_templates.find((d: Item) => d.id === legacy.id)).toEqual(
    before.label_templates.find((d: Item) => d.id === legacy.id),
  )
})
it('rejects cross-business product links and output and enforces the composite database foreign key', async () => {
  runtime.user = 'label-owner-b'
  const other = await request(
    'save',
    { id: 'only-business-b', name: 'B only', workflow: 'resale', price: 1 },
    'products',
  )
  expect(other.status, other.error).toBe(200)
  runtime.user = 'label-owner-a'
  const document = label()
  document.source = { kind: 'product', id: 'only-business-b' }
  document.productId = 'only-business-b'
  document.manualTextReviewedFor = sourceKey(document.source)
  expect(
    (await request('labelSave', { document, expectedRevision: 0 })).status,
  ).toBe(400)
  await db.query("SELECT set_config('app.business_id',$1,false)", [orgA])
  await expect(
    db.query(
      'INSERT INTO label_templates(id,business_id,data,product_id) VALUES($1,$2,$3,$4)',
      [crypto.randomUUID(), orgA, '{}', 'only-business-b'],
    ),
  ).rejects.toThrow(/foreign key/)
  const valid = label()
  expect(
    (await request('labelSave', { document: valid, expectedRevision: 0 }))
      .status,
  ).toBe(200)
  runtime.user = 'label-owner-b'
  expect(
    (
      await request('labelPrint', {
        templateId: valid.id,
        source: valid.source,
        copies: 1,
        layout: defaultSheet,
      })
    ).status,
  ).toBe(400)
  expect(
    (await request('labelDelete', { ids: [valid.id], recordKind: 'label' }))
      .status,
  ).toBe(400)
  runtime.user = 'label-owner-a'
})
it('saves and resolves only the verified business disclaimer and rejects a read-only change', async () => {
  runtime.user = 'label-owner-a'
  const beforeA = (await request()).workspace.settings[0]
  const saveA = await request(
    'save',
    { ...beforeA, disclaimer: 'Business A saved text' },
    'settings',
  )
  expect(saveA.status, saveA.error).toBe(200)
  runtime.user = 'label-owner-b'
  const beforeB = (await request()).workspace.settings[0]
  expect(beforeB.disclaimer).not.toBe('Business A saved text')
  const saveB = await request(
    'save',
    { ...beforeB, disclaimer: 'Business B saved text' },
    'settings',
  )
  expect(saveB.status, saveB.error).toBe(200)
  const workspaceB = (await request()).workspace
  const source = { kind: 'product' as const, id: 'label-product-a' }
  expect(
    resolveLabelData(workspaceB, source).values['business.cottageFoodDisclaimer'],
  ).toBe('Business B saved text')
  runtime.user = 'label-reader'
  const rejected = await request(
    'save',
    { ...beforeA, disclaimer: 'Rejected text' },
    'settings',
  )
  expect(rejected.status).toBe(400)
  runtime.user = 'label-owner-a'
  const workspaceA = (await request()).workspace
  expect(
    resolveLabelData(workspaceA, source).values['business.cottageFoodDisclaimer'],
  ).toBe('Business A saved text')
  expect(workspaceA.settings[0]).toMatchObject({
    ...beforeA,
    disclaimer: 'Business A saved text',
  })
  const bound = newElement('text', '', 'business.cottageFoodDisclaimer')
  const document: LabelDocument = {
    ...label(),
    format: 'front-back',
    elements: [bound],
    back: labelLayout({
      ...blankLabel(),
      elements: [{ ...bound, id: crypto.randomUUID() }],
    }),
  }
  const saved = await request('labelSave', { document, expectedRevision: 0 })
  expect(saved.status, saved.error).toBe(200)
  const copy = duplicateSavedLabel(document, source)
  const savedCopy = await request('labelSave', {
    document: copy,
    expectedRevision: 0,
  })
  expect(savedCopy.status, savedCopy.error).toBe(200)
  const printed = await request('labelPrint', {
    templateId: copy.id,
    source,
    copies: 1,
    parts: 'both',
    order: 'paired',
    layout: { ...defaultSheet, mode: 'roll' },
  })
  expect(printed.status, printed.error).toBe(200)
  const job = printed.workspace.label_print_jobs.at(-1)
  expect(job.documentSnapshot.elements[0]).toMatchObject({
    binding: 'business.cottageFoodDisclaimer',
    text: '',
  })
  expect(job.documentSnapshot.back.elements[0]).toMatchObject({
    binding: 'business.cottageFoodDisclaimer',
    text: '',
  })
  expect(job.renderedDataSnapshot.values['business.cottageFoodDisclaimer']).toBe(
    'Business A saved text',
  )
})
