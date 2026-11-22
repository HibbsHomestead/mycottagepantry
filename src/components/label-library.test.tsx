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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
})
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
          products: workspace.products.map((p) => {
            const next = { ...p }
            if (body.data.ids.includes(next.labelDesignId))
              delete next.labelDesignId
            return next
          }),
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
  fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
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
    screen.getByRole('button', { name: 'Delete Market loaf' }),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Edit Market loaf' }))
  expect(screen.getByLabelText('Label name')).toHaveValue('Market loaf — Copy')
  await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
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
  await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
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

it('deletes preserved shared designs after naming their linked products and keeps deletion after reopening', async () => {
  const api = setup(true),
    user = userEvent.setup()
  const originalProducts = structuredClone(api.workspace().products)
  render(<api.App />)
  await user.click(screen.getByRole('button', { name: 'Delete Market loaf' }))
  let dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByText(/Delete “Market loaf”/)).toBeInTheDocument()
  expect(
    dialog.getByText(/removes the label link from 2 products/),
  ).toHaveTextContent(originalProducts[0].name)
  await user.click(dialog.getByRole('button', { name: 'Cancel' }))
  expect(api.requests).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: 'Delete Market loaf' }))
  dialog = within(screen.getByRole('dialog'))
  await user.click(dialog.getByRole('button', { name: 'Delete label' }))
  await screen.findByText('1 label deleted.')
  expect(
    screen.queryByRole('button', { name: 'Delete Market loaf' }),
  ).not.toBeInTheDocument()
  expect(api.workspace().products).toEqual(
    originalProducts.map((p) => {
      const next = { ...p }
      delete next.labelDesignId
      return next
    }),
  )
  const view = render(<api.App />)
  expect(
    view.queryByRole('button', { name: 'Delete Market loaf' }),
  ).not.toBeInTheDocument()
})
it('bulk deletes mixed legacy and new records and selects only matching filtered labels', async () => {
  const api = setup(),
    user = userEvent.setup()
  api.workspace().label_templates.push({
    ...structuredClone(api.document),
    id: 'legacy',
    name: 'Preserved loaf',
    workflowVersion: undefined,
    recordKind: 'template',
  })
  render(<api.App />)
  expect(
    screen.queryByRole('button', { name: 'Delete Selected' }),
  ).not.toBeInTheDocument()
  await user.type(screen.getByPlaceholderText('Search labels…'), 'Preserved')
  await user.click(
    screen.getByRole('checkbox', { name: 'Select All filtered labels' }),
  )
  expect(
    screen.getByText('1 selected', { selector: 'strong' }),
  ).toBeInTheDocument()
  await user.clear(screen.getByPlaceholderText('Search labels…'))
  await user.click(
    screen.getByRole('checkbox', { name: 'Select All filtered labels' }),
  )
  await user.click(screen.getByRole('button', { name: 'Delete Selected' }))
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Delete 2 labels',
    }),
  )
  await screen.findByText('2 labels deleted.')
  expect(api.workspace().label_templates.every((d) => d.deletedAt)).toBe(true)
  expect(
    screen.queryByRole('button', { name: 'Delete Selected' }),
  ).not.toBeInTheDocument()
})
it('keeps recovery collapsed and retains cards and selection when deletion fails', async () => {
  const api = setup(true),
    user = userEvent.setup()
  api.workspace().label_recovery_drafts = [
    {
      id: 'draft',
      name: 'Checkpoint loaf',
      savedAt: '2026-11-22T00:00:00Z',
      document: api.document,
    },
  ]
  render(<api.App />)
  const summary = screen.getByText('Recovery (1)')
  expect(summary.closest('details')).not.toHaveAttribute('open')
  await user.click(summary)
  expect(
    screen.getByRole('button', { name: 'Import editable recovery file' }),
  ).toBeVisible()
  expect(screen.getByText('Checkpoint loaf')).toBeVisible()
  await user.click(screen.getByRole('checkbox', { name: 'Select Market loaf' }))
  await user.click(screen.getByRole('button', { name: 'Delete Market loaf' }))
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: false,
    json: async () => ({ error: 'Connection interrupted; retry deletion.' }),
  } as Response)
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Delete label',
    }),
  )
  expect(
    await screen.findByText('Connection interrupted; retry deletion.'),
  ).toBeInTheDocument()
  expect(api.workspace().label_templates[0].deletedAt).toBeUndefined()
  expect(api.workspace().label_recovery_drafts).toHaveLength(1)
})

it('shows authorization reasons and disabled controls for read-only saved and preserved cards', () => {
  const api = setup(true)
  render(
    <LabelStudio
      workspace={api.workspace()}
      onWorkspace={vi.fn()}
      ready
      role="Read-only Accountant"
    />,
  )
  expect(
    screen.getByRole('button', { name: 'Delete Market loaf' }),
  ).toBeDisabled()
  expect(
    screen.getByRole('checkbox', { name: 'Select Market loaf' }),
  ).toBeDisabled()
  expect(
    screen.getByText('Deletion requires a connected Owner or Manager account.'),
  ).toBeInTheDocument()
})
