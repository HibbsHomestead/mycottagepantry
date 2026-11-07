import { useState } from 'react'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LabelStudio } from './label-studio'
import { demoData } from '@/lib/demo'
import { blankLabel, newElement, type LabelDocument } from '@/lib/label-studio'
import { labelLayout } from '@/lib/label-sets'
import { sourceKey } from '@/lib/saved-labels'
import { defaultSheet } from '@/lib/label-print-layout'
import type { Workspace } from '@/lib/domain'

const capture = vi.hoisted(() => ({ document: null as LabelDocument | null }))
vi.mock('@/lib/label-client-export', () => ({
  downloadLabel: (bytes: Uint8Array) => {
    capture.document = JSON.parse(new TextDecoder().decode(bytes)).document
  },
  exportLabelPng: vi.fn(),
}))
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  capture.document = null
})
function setup(legacy = false) {
  let workspace = demoData()
  const source = { kind: 'product' as const, id: workspace.products[0].id }
  const document: LabelDocument = {
    ...blankLabel(),
    id: crypto.randomUUID(),
    name: 'Market loaf',
    recordKind: legacy ? 'template' : 'label',
    workflowVersion: legacy ? undefined : 1,
    revision: 3,
    source: legacy ? undefined : source,
    productId: legacy ? undefined : source.id,
    manualTextReviewedFor: sourceKey(source),
    renderVersion: 2,
    format: 'front-back',
    elements: [
      {
        ...newElement('text', '', 'product.displayName'),
        rotation: 37,
        font: 'Lora',
      },
      { ...newElement('image'), binding: 'product.graphic', rotation: 12 },
    ],
    back: {
      ...labelLayout(blankLabel()),
      width: 216,
      height: 144,
      elements: [
        newElement('text', '', 'recipe.ingredients'),
        newElement('text', '', 'recipe.allergens'),
        newElement('text', 'Made for Market loaf'),
      ],
    },
    printSettings: {
      copies: 4,
      layout: { ...defaultSheet, mode: 'roll' },
      parts: 'both',
      order: 'paired',
    },
  }
  workspace.label_templates = [structuredClone(document)]
  workspace.label_versions = []
  workspace.label_recovery_drafts = []
  if (legacy)
    for (const p of workspace.products.slice(0, 2))
      p.labelDesignId = document.id
  const requests: {
    action: string
    data: { document: LabelDocument; operationId: string; ids: string[] }
  }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      if (body.action) requests.push(body)
      if (body.action === 'labelSave') {
        const d = structuredClone(body.data.document)
        workspace = {
          ...workspace,
          label_templates: [
            ...workspace.label_templates.filter((p) => p.id !== d.id),
            {
              ...d,
              revision:
                (workspace.label_templates.find((p) => p.id === d.id)
                  ?.revision || 0) + 1,
              lastSaveOperationId: body.data.operationId,
              savedAt: new Date().toISOString(),
            },
          ],
        }
      }
      if (body.action === 'labelDelete')
        workspace = {
          ...workspace,
          label_templates: workspace.label_templates.map((d) =>
            body.data.ids.includes(d.id)
              ? {
                  ...d,
                  deletedAt: new Date().toISOString(),
                  revision: d.revision + 1,
                }
              : d,
          ),
        }
      return {
        ok: true,
        json: async () => ({ workspace: structuredClone(workspace) }),
      }
    }),
  )
  function App() {
    const [w, setW] = useState<Workspace>(workspace)
    return <LabelStudio workspace={w} onWorkspace={setW} ready role="Owner" />
  }
  return { App, document, requests, workspace: () => workspace }
}
it('provides one Labels list and opens a complete independent unsaved duplicate without periodic writes', async () => {
  vi.useFakeTimers()
  const api = setup()
  render(<api.App />)
  expect(
    screen.queryByRole('button', { name: 'Templates' }),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate Market loaf' }))
  expect(screen.getByLabelText('Label name')).toHaveValue('Market loaf — Copy')
  fireEvent.click(
    screen.getByRole('button', { name: 'Export editable recovery file' }),
  )
  const copy = capture.document!
  expect(copy.id).not.toBe(api.document.id)
  expect(copy.revision).toBe(0)
  expect(copy.elements).toEqual(api.document.elements)
  expect(copy.back).toEqual(api.document.back)
  expect(copy.printSettings).toEqual(api.document.printSettings)
  expect(copy.source).toEqual(api.document.source)
  await act(async () => vi.advanceTimersByTime(12000))
  expect(
    api.requests.filter((r) =>
      ['labelSave', 'labelDraft', 'labelPrint'].includes(r.action),
    ),
  ).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(api.workspace().label_templates).toEqual([api.document])
})
it('requires review of manual text when selecting another product and saves a new independent label', async () => {
  const api = setup(),
    user = userEvent.setup()
  render(<api.App />)
  await user.click(
    screen.getByRole('button', { name: 'Duplicate Market loaf' }),
  )
  const other = api.workspace().products[1]
  await user.selectOptions(screen.getAllByLabelText('Product')[0], other.id)
  expect(
    screen.getByRole('heading', { name: 'Review manually entered text' }),
  ).toBeInTheDocument()
  expect(screen.getByText('Back: Made for Market loaf')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(api.requests.some((r) => r.action === 'labelSave')).toBe(false)
  await user.click(
    screen.getByRole('checkbox', {
      name: 'I reviewed this manual text for the selected product.',
    }),
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText(/^Saved ·/)
  const saved = api
    .workspace()
    .label_templates.find((d) => d.id !== api.document.id)!
  expect(saved.productId).toBe(other.id)
  expect(saved.source).toEqual({ kind: 'product', id: other.id })
  expect(saved.back.elements.at(-1).text).toBe('Made for Market loaf')
  expect(saved.back.elements[0].binding).toBe('recipe.ingredients')
  expect(
    api.workspace().label_templates.find((d) => d.id === api.document.id),
  ).toEqual(api.document)
  await user.click(screen.getByRole('button', { name: 'Labels' }))
  await user.click(
    screen.getByRole('button', { name: 'Delete Market loaf — Copy' }),
  )
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Delete label',
    }),
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Delete Market loaf — Copy' }),
    ).not.toBeInTheDocument(),
  )
  expect(
    api.workspace().label_templates.find((d) => d.id === api.document.id),
  ).toEqual(api.document)
})
it('keeps shared legacy records and product assignments intact while opening Edit as an unsaved independent copy', async () => {
  const api = setup(true),
    user = userEvent.setup(),
    before = structuredClone(api.workspace())
  render(<api.App />)
  expect(screen.getByText(/2 linked products/)).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Delete Market loaf' }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Edit Market loaf' }))
  expect(screen.getByLabelText('Label name')).toHaveValue('Market loaf — Copy')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(api.workspace()).toEqual(before)
  expect(api.requests).toHaveLength(0)
})
it('creates a blank draft without a template prerequisite and blocks print until explicit save', async () => {
  const api = setup(),
    user = userEvent.setup()
  render(<api.App />)
  await user.click(screen.getByRole('button', { name: 'Create label' }))
  expect(screen.getByLabelText('Label name')).toHaveValue('Untitled label')
  await user.click(screen.getByRole('button', { name: 'Preview/Print' }))
  await user.click(screen.getByRole('button', { name: 'Print labels' }))
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Save this label before printing or exporting.',
  )
  expect(api.requests).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(api.workspace().label_templates).toEqual([api.document])
})

it('keeps counted bulk deletion and cancellation for independent labels', async () => {
  const api = setup(),
    user = userEvent.setup()
  render(<api.App />)
  await user.click(
    screen.getByRole('button', { name: 'Duplicate Market loaf' }),
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText(/^Saved ·/)
  await user.click(screen.getByRole('button', { name: 'Labels' }))
  const before = structuredClone(api.workspace().label_templates)
  await user.click(
    screen.getByRole('checkbox', { name: 'Select All filtered labels' }),
  )
  await user.click(screen.getByRole('button', { name: 'Delete Selected' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByRole('heading')).toHaveTextContent('Delete 2 labels?')
  await user.click(dialog.getByRole('button', { name: 'Cancel' }))
  expect(api.workspace().label_templates).toEqual(before)
  await user.click(screen.getByRole('button', { name: 'Delete Selected' }))
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Delete 2 labels',
    }),
  )
  await waitFor(() =>
    expect(
      screen.getByText(
        'No labels to show. Create a label or clear the search.',
      ),
    ).toBeInTheDocument(),
  )
  expect(api.workspace().label_templates.every((d) => d.deletedAt)).toBe(true)
})
