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
  systemLabelTemplates,
  type LabelDocument,
} from './label-studio'
import { labelContent } from './label-persistence'
import { labelLayout } from './label-sets'
import { defaultSheet } from './label-print-layout'
import { copyLabelDesign, labelRecordKind } from './label-library'
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
  const first = draft(1),
    newer = draft(2, { ...document, name: 'Newer unsaved edits' })
  expect((await request('labelDraft', first)).status).toBe(200)
  expect((await request('labelDraft', newer)).status).toBe(200)
  let result = await request('labelSave', {
    document,
    expectedRevision: 0,
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

it('saves and reopens complete reusable templates, updates in place, and isolates variations and labels', async () => {
  const original = {
    ...label(),
    recordKind: 'template' as const,
    name: 'Market bread master',
    width: 288,
    height: 216,
    background: '#faf5ee',
    backgroundOpacity: 0.8,
    round: false,
    tags: ['Rustic'],
    elements: [
      ...label().elements,
      {
        ...newElement('image'),
        binding: 'business.logo',
        x: 10,
        y: 12,
        width: 65,
        height: 40,
        fit: 'cover' as const,
      },
      {
        ...newElement('shape'),
        fill: '#123456',
        rotation: 90,
        hidden: true,
        locked: true,
      },
      { ...newElement('illustration'), graphic: 'wheat', opacity: 0.5 },
      { ...newElement('line'), color: '#abcdef' },
    ],
  }
  let result = await request('labelSave', {
    document: original,
    expectedRevision: 0,
    operationId: crypto.randomUUID(),
  })
  expect(result.status, result.error).toBe(200)
  const reopened = (await request()).workspace.label_templates.find(
    (t: Item) => t.id === original.id,
  )
  expect(labelContent(reopened)).toBe(labelContent(original))
  expect(reopened.elements).toEqual(original.elements)
  const labelCopy = copyLabelDesign(reopened, 'label', 'Saturday market bread')
  result = await request('labelSave', {
    document: labelCopy,
    expectedRevision: 0,
  })
  expect(result.status, result.error).toBe(200)
  const variation = copyLabelDesign(
    reopened,
    'template',
    'Market bread variation',
  )
  expect(
    (await request('labelSave', { document: variation, expectedRevision: 0 }))
      .status,
  ).toBe(200)
  const updated = {
    ...reopened,
    width: 216,
    height: 288,
    elements: reopened.elements.map((e: Item) => ({ ...e, x: e.x + 3 })),
  }
  expect(
    (await request('labelSave', { document: updated, expectedRevision: 1 }))
      .status,
  ).toBe(200)
  const workspace = (await request()).workspace
  expect(
    workspace.label_templates.filter((t: Item) => t.id === original.id),
  ).toHaveLength(1)
  expect(
    workspace.label_templates.find((t: Item) => t.id === original.id).revision,
  ).toBe(2)
  expect(
    labelContent(
      workspace.label_templates.find((t: Item) => t.id === original.id),
    ),
  ).toBe(labelContent(updated))
  expect(
    labelContent(
      workspace.label_templates.find((t: Item) => t.id === labelCopy.id),
    ),
  ).toBe(labelContent(labelCopy))
  expect(
    labelContent(
      workspace.label_templates.find((t: Item) => t.id === variation.id),
    ),
  ).toBe(labelContent(variation))
  expect(labelCopy.sourceTemplateId).toBe(original.id)
})

it('rejects duplicate template names, changed record types, and stale template updates without overwriting', async () => {
  const document = {
    ...label(),
    recordKind: 'template' as const,
    name: 'Holiday Template',
  }
  expect(
    (await request('labelSave', { document, expectedRevision: 0 })).status,
  ).toBe(200)
  const duplicate = copyLabelDesign(
    document,
    'template',
    '  HOLIDAY Template  ',
  )
  const rejected = await request('labelSave', {
    document: duplicate,
    expectedRevision: 0,
  })
  expect(rejected.status).toBe(400)
  expect(rejected.error).toMatch(/name already exists/)
  expect(
    (
      await request('labelSave', {
        document: { ...document, name: 'Stale edit' },
        expectedRevision: 0,
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await request('labelSave', {
        document: { ...document, recordKind: 'label' },
        expectedRevision: 1,
      })
    ).status,
  ).toBe(400)
  // An explicit update targets the stable ID and current revision.
  const updated = {
    ...document,
    name: 'Holiday Template',
    elements: [...document.elements, newElement('text', 'Winter')],
  }
  expect(
    (await request('labelSave', { document: updated, expectedRevision: 1 }))
      .status,
  ).toBe(200)
  expect(
    (await request()).workspace.label_templates.filter(
      (t: Item) => t.id === document.id,
    ),
  ).toHaveLength(1)
})

it('persists single and bulk deletion, retains templates, other labels, assets and history, and rejects resurrection', async () => {
  const template = {
    ...label(),
    recordKind: 'template' as const,
    name: 'Deletion source',
  }
  template.elements.push({
    ...newElement('image'),
    assetId: 'shared-graphic',
    width: 50,
    height: 40,
  })
  expect(
    (await request('labelSave', { document: template, expectedRevision: 0 }))
      .status,
  ).toBe(200)
  const labels = [1, 2, 3, 4].map((n) =>
    copyLabelDesign(template, 'label', `Deletion label ${n}`),
  )
  for (const document of labels)
    expect(
      (await request('labelSave', { document, expectedRevision: 0 })).status,
    ).toBe(200)
  const before = (await request()).workspace
  const scope = before.settings[0].labelEditorScope
  const sessionId = crypto.randomUUID()
  expect(
    (
      await request('labelDraft', {
        id: crypto.randomUUID(),
        sessionId,
        sequence: 1,
        document: labels[0],
        expectedScope: scope,
      })
    ).status,
  ).toBe(200)
  const result = await request('labelDelete', {
    ids: [labels[0].id],
    recordKind: 'label',
    expectedScope: scope,
  })
  expect(result.status, result.error).toBe(200)
  expect(
    result.workspace.label_recovery_drafts.some(
      (d: Item) => d.document.id === labels[0].id,
    ),
  ).toBe(false)
  // Retrying a deletion is safe.
  expect(
    (await request('labelDelete', { ids: [labels[0].id], recordKind: 'label' }))
      .status,
  ).toBe(200)
  expect(
    (
      await request('labelDelete', {
        ids: labels.slice(1, 3).map((d) => d.id),
        recordKind: 'label',
      })
    ).status,
  ).toBe(200)
  const reopened = (await request()).workspace
  expect(
    reopened.label_templates.filter(
      (t: Item) => !t.deletedAt && labels.some((d) => d.id === t.id),
    ),
  ).toEqual([expect.objectContaining({ id: labels[3].id })])
  expect(
    reopened.label_templates.find((t: Item) => t.id === template.id).deletedAt,
  ).toBeUndefined()
  expect(reopened.graphic_assets).toEqual(before.graphic_assets)
  expect(reopened.graphic_assets).toContainEqual(
    expect.objectContaining({ id: 'shared-graphic' }),
  )
  expect(
    reopened.label_templates.find((t: Item) => t.id === labels[3].id).elements,
  ).toContainEqual(expect.objectContaining({ assetId: 'shared-graphic' }))
  expect(reopened.label_versions).toEqual(before.label_versions)
  expect(reopened.label_print_jobs).toEqual(before.label_print_jobs)
  const staleSave = await request('labelSave', {
    document: labels[0],
    expectedScope: scope,
    expectedRevision: 1,
  })
  expect(staleSave.status).toBe(400)
  expect(staleSave.error).toMatch(/deleted/)
  expect(
    (
      await request('labelDraft', {
        id: crypto.randomUUID(),
        sessionId,
        sequence: 2,
        document: labels[0],
        expectedScope: scope,
      })
    ).status,
  ).toBe(400)
  expect(
    (await request('labelPrint', { templateId: labels[0].id })).status,
  ).toBe(400)
  expect(
    (
      await request('labelDelete', {
        ids: [template.id],
        recordKind: 'template',
      })
    ).status,
  ).toBe(200)
  const afterTemplateDeletion = (await request()).workspace
  expect(
    afterTemplateDeletion.label_templates.find(
      (t: Item) => t.id === labels[3].id,
    ).deletedAt,
  ).toBeUndefined()
  expect(
    labelRecordKind(
      afterTemplateDeletion.label_templates.find(
        (t: Item) => t.id === template.id,
      ),
    ),
  ).toBe('template')
})

it('rejects cross-workspace, mixed-kind, read-only, expired and wrong-scope deletions atomically', async () => {
  const template = {
    ...label(),
    recordKind: 'template' as const,
    name: 'Protected deletion source',
  }
  expect(
    (await request('labelSave', { document: template, expectedRevision: 0 }))
      .status,
  ).toBe(200)
  const document = copyLabelDesign(template, 'label')
  expect(
    (await request('labelSave', { document, expectedRevision: 0 })).status,
  ).toBe(200)
  expect(
    (
      await request('labelDelete', {
        ids: [document.id, template.id],
        recordKind: 'label',
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await request('labelDelete', {
        ids: [document.id, 'nonexistent'],
        recordKind: 'label',
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await request('labelDelete', {
        ids: [document.id],
        recordKind: 'label',
        expectedScope: 'wrong-scope',
      })
    ).status,
  ).toBe(400)
  runtime.user = 'label-owner-b'
  expect(
    (await request('labelDelete', { ids: [document.id], recordKind: 'label' }))
      .status,
  ).toBe(400)
  runtime.user = 'label-reader'
  expect(
    (await request('labelDelete', { ids: [document.id], recordKind: 'label' }))
      .status,
  ).toBe(400)
  runtime.user = 'label-owner-a'
  runtime.expired = true
  expect(
    (await request('labelDelete', { ids: [document.id], recordKind: 'label' }))
      .status,
  ).toBe(401)
  runtime.expired = false
  const reopened = (await request()).workspace
  expect(
    reopened.label_templates.find((t: Item) => t.id === document.id).deletedAt,
  ).toBeUndefined()
  expect(
    reopened.label_templates.find((t: Item) => t.id === template.id).deletedAt,
  ).toBeUndefined()
})

it('removes built-in templates per oven, survives reauthentication, and preserves existing editable labels', async () => {
  runtime.user = 'label-owner-a'
  const starter = systemLabelTemplates[0]
  const original = JSON.stringify(starter)
  const document = copyLabelDesign(
    starter,
    'label',
    'Independent starter label',
  )
  expect(
    (await request('labelSave', { document, expectedRevision: 0 })).status,
  ).toBe(200)
  const before = (await request()).workspace
  const snapshot = labelContent(
    before.label_templates.find((t: Item) => t.id === document.id),
  )
  const remove = () =>
    request('labelDelete', { ids: [starter.id], recordKind: 'template' })
  runtime.user = 'label-reader'
  expect((await remove()).status).toBe(400)
  runtime.user = 'label-owner-a'
  const removed = await remove()
  expect(removed.status).toBe(200)
  const marker = removed.workspace.label_templates.find(
    (t: Item) => t.id === starter.id,
  )
  expect(marker).toMatchObject({ recordKind: 'template', revision: 1 })
  expect(marker.deletedAt).toBeTruthy()
  expect(
    (await remove()).workspace.label_templates.find(
      (t: Item) => t.id === starter.id,
    ).revision,
  ).toBe(1)
  runtime.expired = true
  expect((await request()).status).toBe(401)
  runtime.expired = false
  runtime.user = 'second-owner'
  const reopened = (await request()).workspace
  expect(
    reopened.label_templates.find((t: Item) => t.id === starter.id).deletedAt,
  ).toBe(marker.deletedAt)
  expect(
    labelContent(
      reopened.label_templates.find((t: Item) => t.id === document.id),
    ),
  ).toBe(snapshot)
  expect(
    reopened.label_versions.filter((t: Item) => t.templateId === document.id),
  ).toEqual(
    before.label_versions.filter((t: Item) => t.templateId === document.id),
  )
  // The original template still exists in code, and a different workspace sees no removal.
  expect(JSON.stringify(starter)).toBe(original)
  runtime.user = 'label-owner-b'
  expect(
    (await request()).workspace.label_templates.some(
      (t: Item) => t.id === starter.id,
    ),
  ).toBe(false)
  expect(
    (
      await request('labelSave', {
        document: copyLabelDesign(starter, 'label'),
        expectedRevision: 0,
      })
    ).status,
  ).toBe(200)
  runtime.user = 'label-owner-a'
  const resurrection = {
    ...starter,
    isSystem: false,
    recordKind: 'template',
    revision: 1,
  }
  expect(
    (
      await request('labelSave', {
        document: resurrection,
        expectedRevision: 1,
      })
    ).status,
  ).toBe(400)
})

it('persists two independent layouts, assigns two products, prepares exact sets without creating labels or changing stock, and isolates tenants', async () => {
  runtime.user = 'label-owner-a'
  runtime.expired = false
  runtime.selected = undefined
  const front = {
    ...blankLabel(),
    id: crypto.randomUUID(),
    name: 'Reusable paired acceptance',
    recordKind: 'template' as const,
    renderVersion: 2 as const,
    width: 216,
    height: 144,
    elements: [newElement('text', '', 'product.displayName')],
  }
  const document = {
    ...front,
    format: 'front-back' as const,
    back: {
      ...labelLayout(front),
      width: 144,
      elements: [
        newElement('text', '', 'product.netQuantity'),
        { ...newElement('image'), assetId: 'shared-graphic' },
      ],
    },
  }
  let result = await request('labelSave', { document, expectedRevision: 0 })
  expect(result.status, result.error).toBe(200)
  for (const [id, name, weight] of [
    ['paired-a', 'Banana bread', 9.5],
    ['paired-b', 'Pumpkin bread', 12],
  ]) {
    const saved = await request(
      'save',
      { id, name, workflow: 'resale', netWeightOz: weight, price: 8 },
      'products',
    )
    expect(saved.status, saved.error).toBe(200)
  }
  result = await request('templateAssignments', {
    templateId: document.id,
    productIds: ['paired-a', 'paired-b'],
  })
  expect(result.status, result.error).toBe(200)
  const before = result.workspace
  expect(
    before.products.filter((p: Item) => p.labelDesignId === document.id),
  ).toHaveLength(2)
  expect(
    (await request()).workspace.label_templates.find(
      (d: Item) => d.id === document.id,
    ).back,
  ).toEqual(document.back)
  const count = before.label_templates.length
  for (const [parts, runIndex, side] of [
    ['both', 0, 'front'],
    ['both', 1, 'back'],
    ['front', 0, 'front'],
    ['back', 0, 'back'],
  ]) {
    const prepared = await request('labelPrint', {
      templateId: document.id,
      source: { kind: 'product', id: 'paired-a' },
      copies: 12,
      parts,
      order: 'paired',
      runIndex,
      layout: defaultSheet,
    })
    expect(prepared.status, prepared.error).toBe(200)
    const job = prepared.workspace.label_print_jobs.at(-1)
    expect(job.sequence).toEqual(Array(12).fill(side))
    expect(job.renderedDataSnapshot.values['product.displayName']).toBe(
      'Banana bread',
    )
    expect(job.renderedDataSnapshot.values['product.netQuantity']).toBe(
      'Net Wt. 9.5oz (269g)',
    )
    expect(prepared.workspace.label_templates).toHaveLength(count)
    expect(prepared.workspace.products).toEqual(before.products)
    expect(prepared.workspace.ledger).toEqual(before.ledger)
  }
  const forbidden = await request('labelDelete', {
    ids: [document.id],
    recordKind: 'template',
  })
  expect(forbidden.status).toBe(400)
  expect(forbidden.error).toMatch(/assign/i)
  runtime.user = 'label-owner-b'
  for (const action of [
    'templateAssignments',
    'labelPrint',
    'productLabelAssignment',
  ]) {
    const other = await request(action, {
      templateId: document.id,
      productIds: ['paired-a'],
      productId: 'paired-a',
      labelId: document.id,
      source: { kind: 'product', id: 'paired-a' },
      copies: 1,
    })
    expect(other.status).toBe(400)
  }
  expect(
    (await request()).workspace.products.some((p: Item) => p.id === 'paired-a'),
  ).toBe(false)
  runtime.user = 'label-owner-a'
  const updated = await request(
    'save',
    {
      ...before.products.find((p: Item) => p.id === 'paired-a'),
      name: 'Banana renamed',
    },
    'products',
  )
  expect(updated.status, updated.error).toBe(200)
  expect(
    updated.workspace.products.find((p: Item) => p.id === 'paired-b'),
  ).toEqual(before.products.find((p: Item) => p.id === 'paired-b'))
  expect(
    updated.workspace.label_templates.find((d: Item) => d.id === document.id),
  ).toEqual(before.label_templates.find((d: Item) => d.id === document.id))
  expect(
    (
      await request('templateAssignments', {
        templateId: document.id,
        productIds: [],
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await request('labelDelete', {
        ids: [document.id],
        recordKind: 'template',
      })
    ).status,
  ).toBe(200)
})
