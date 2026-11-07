import { useState } from 'react'
import {
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
import {
  blankLabel,
  newElement,
  systemLabelTemplates,
  type LabelDocument,
} from '@/lib/label-studio'
import { labelContent, mergeLabelWorkspace } from '@/lib/label-persistence'
import { labelRecordKind } from '@/lib/label-library'
import type { Workspace } from '@/lib/domain'

const exports = vi.hoisted(() => ({ documents: [] as LabelDocument[] }))
vi.mock('@/lib/label-client-export', () => ({
  downloadLabel: (bytes: Uint8Array) =>
    exports.documents.push(
      JSON.parse(new TextDecoder().decode(bytes)).document,
    ),
  exportLabelPng: vi.fn(),
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  exports.documents = []
})
function design(name: string, kind?: 'template'): LabelDocument {
  return {
    ...blankLabel(),
    id: crypto.randomUUID(),
    name,
    recordKind: kind,
    revision: 1,
    width: 288,
    height: 216,
    displayUnit: 'mm',
    tags: [],
    elements: [
      {
        ...newElement('text', 'Bread'),
        textRuns: [{ id: 'bread', text: 'Bread', font: 'Lora' }],
        bold: true,
        rotation: 180,
        x: 48,
      },
      {
        ...newElement('text', '', 'recipe.ingredients'),
        font: 'Lora',
        y: 77,
        letterSpacing: 0.2,
      },
      {
        ...newElement('image'),
        binding: 'business.logo',
        fit: 'cover',
        width: 65,
        height: 35,
      },
      { ...newElement('shape'), fill: '#abcdef', rotation: 90, opacity: 0.7 },
      { ...newElement('illustration'), graphic: 'wheat' },
      { ...newElement('border'), locked: true },
      { ...newElement('line'), hidden: true },
    ],
  }
}
function setup(documents = [design('Bread Label')]) {
  let workspace = demoData()
  workspace.settings[0].labelEditorScope = 'library-scope'
  workspace.label_templates = structuredClone(documents)
  workspace.label_recovery_drafts = []
  workspace.label_versions = []
  let failure = ''
  let loseSaveResponse = false
  const requests: {
    action: string
    data: { document: LabelDocument; operationId: string; ids: string[] }
  }[] = []
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'))
    requests.push(body)
    if (failure) return { ok: false, json: async () => ({ error: failure }) }
    if (body.action === 'labelSave') {
      const { document, operationId } = body.data
      const previous = workspace.label_templates.find(
        (t) => t.id === document.id,
      )
      if (previous?.lastSaveOperationId !== operationId) {
        const saved = {
          ...structuredClone(document),
          revision: Number(previous?.revision || 0) + 1,
          lastSaveOperationId: operationId,
          savedAt: new Date().toISOString(),
        }
        workspace = {
          ...workspace,
          label_templates: [
            ...workspace.label_templates.filter((t) => t.id !== saved.id),
            saved,
          ],
        }
      }
      if (loseSaveResponse) {
        loseSaveResponse = false
        throw new Error('Response lost after commit')
      }
    }
    if (body.action === 'labelDelete')
      workspace = {
        ...workspace,
        label_templates: [
          ...workspace.label_templates,
          ...systemLabelTemplates.filter(
            (t) =>
              body.data.ids.includes(t.id) &&
              !workspace.label_templates.some((saved) => saved.id === t.id),
          ),
        ].map((t) =>
          body.data.ids.includes(t.id)
            ? {
                ...t,
                deletedAt: new Date().toISOString(),
                revision: t.revision + 1,
              }
            : t,
        ),
      }
    const response = structuredClone(workspace)
    return { ok: true, json: async () => ({ workspace: response }) }
  })
  vi.stubGlobal('fetch', fetcher)
  function App() {
    const [w, setW] = useState<Workspace>(workspace)
    return <LabelStudio workspace={w} onWorkspace={setW} ready role="Owner" />
  }
  return {
    App,
    requests,
    workspace: () => workspace,
    active: () => workspace.label_templates.filter((t) => !t.deletedAt),
    fail: (message: string) => {
      failure = message
    },
    loseSaveResponse: () => {
      loseSaveResponse = true
    },
  }
}
it('confirms a named stock-template removal, supports cancellation, and keeps it absent after remount', async () => {
  const original = design('Existing saved label')
  const api = setup([original])
  const view = render(<api.App />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Templates' }))
  const starter = systemLabelTemplates[0]
  await user.click(
    screen.getByRole('button', { name: 'Delete ' + starter.name }),
  )
  let dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByText(/Delete “Homestead bold”/)).toHaveTextContent(
    /only from this oven/,
  )
  await user.click(dialog.getByRole('button', { name: 'Cancel' }))
  expect(api.requests.filter((r) => r.action === 'labelDelete')).toHaveLength(0)
  expect(
    screen.getByRole('heading', { name: starter.name }),
  ).toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'Delete ' + starter.name }),
  )
  dialog = within(screen.getByRole('dialog'))
  await user.click(dialog.getByRole('button', { name: 'Delete template' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: starter.name }),
    ).not.toBeInTheDocument(),
  )
  expect(
    labelContent(
      api
        .workspace()
        .label_templates.find((t) => t.id === original.id) as LabelDocument,
    ),
  ).toBe(labelContent(original))
  view.unmount()
  render(<api.App />)
  await user.click(screen.getByRole('button', { name: 'Templates' }))
  expect(
    screen.queryByRole('button', { name: 'Preview ' + starter.name }),
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', {
      name: 'Preview ' + systemLabelTemplates[1].name,
    }),
  ).toBeInTheDocument()
})
async function openLabel() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Saved Labels' }))
  await user.click(screen.getByRole('button', { name: 'Open label' }))
  return user
}
async function newTemplate(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByRole('button', { name: 'Save as New Template' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('Template name'), {
    target: { value: name },
  })
  await user.click(dialog.getByRole('button', { name: 'Save template' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
}
it('saves a full editable template, reopens it, updates the same ID, and saves a separate variation', async () => {
  const original = design('Bread Label'),
    api = setup([original])
  const app = render(<api.App />)
  const user = await openLabel()
  await newTemplate(user, 'Market bread template')
  const template = api
    .active()
    .find((t) => t.recordKind === 'template')! as LabelDocument
  expect(template.elements).toEqual(original.elements)
  expect(template.width).toBe(original.width)
  expect(template.height).toBe(original.height)
  expect(template.displayUnit).toBe('mm')
  expect(template.id).not.toBe(original.id)
  await user.click(screen.getByRole('button', { name: 'Templates' }))
  await user.click(screen.getByRole('button', { name: 'Open template' }))
  await user.click(
    screen.getByRole('button', { name: 'Export editable recovery file' }),
  )
  expect(labelContent(exports.documents.at(-1)!)).toBe(
    labelContent(template as LabelDocument),
  )
  // Each element retains its own inspector; even locked and hidden elements remain in Layers.
  await user.click(screen.getByRole('button', { name: 'Layers' }))
  expect(document.querySelectorAll('.studio-layer-list > div')).toHaveLength(
    template.elements.length,
  )
  for (const row of document.querySelectorAll('.studio-layer-list > div')) {
    fireEvent.click(row.querySelector('button')!)
    expect(
      screen.getByRole('heading', { name: 'Element settings' }),
    ).toBeInTheDocument()
  }
  fireEvent.change(screen.getByLabelText('Template name'), {
    target: { value: 'Market bread updated' },
  })
  await user.click(screen.getByRole('button', { name: 'Update Template' }))
  await waitFor(() =>
    expect(screen.getByText(/updated in your oven/)).toBeInTheDocument(),
  )
  expect(api.active().filter((t) => t.recordKind === 'template')).toHaveLength(
    1,
  )
  expect(api.active().find((t) => t.id === template.id)?.revision).toBe(2)
  await newTemplate(user, 'Market bread seasonal')
  expect(api.active().filter((t) => t.recordKind === 'template')).toHaveLength(
    2,
  )
  app.unmount()
  render(<api.App />)
  expect(
    screen.getByRole('heading', { name: 'Market bread updated' }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { name: 'Market bread seasonal' }),
  ).toBeInTheDocument()
})

it('opens assignments without creating individual records and preserves every template on reopening', async () => {
  const template = design('Reusable loaf', 'template'),
    second = design('Cookie master', 'template'),
    existing = design('Existing loaf'),
    api = setup([template, second, existing])
  const view = render(<api.App />)
  const user = userEvent.setup()
  await user.click(
    screen.getAllByRole('button', { name: 'Assign to products' })[0],
  )
  expect(screen.getByLabelText('Template name')).toHaveValue(template.name)
  expect(screen.getByText(/Assigned products · 0/)).toBeInTheDocument()
  expect(api.requests.filter((r) => r.action === 'labelSave')).toHaveLength(0)
  view.unmount()
  render(<api.App />)
  expect(
    screen.getByRole('heading', { name: template.name }),
  ).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: second.name })).toBeInTheDocument()
  expect(api.active()).toEqual([template, second, existing])
})

it('duplicates a design as a set with an intact Front and blank Back, leaving the original unchanged', async () => {
  const template = design('Reusable loaf', 'template'),
    api = setup([template])
  render(<api.App />)
  const user = userEvent.setup()
  await user.click(
    screen.getAllByRole('button', { name: 'Duplicate as Front + Back set' })[0],
  )
  expect(screen.getByLabelText('Template format')).toHaveValue('front-back')
  expect(screen.getByText(/Blank back/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Update Template' }))
  await waitFor(() => expect(api.active()).toHaveLength(2))
  const copy = api.active().find((t) => t.id !== template.id)!
  expect(copy.elements).toEqual(template.elements)
  expect(copy.width).toBe(template.width)
  expect(copy.back?.elements).toEqual([])
  expect(api.active().find((t) => t.id === template.id)).toEqual(template)
})

it('warns on duplicate names and only updates the matching template after an explicit action', async () => {
  const template = design('Market template', 'template'),
    api = setup([template, design('Bread Label')])
  render(<api.App />)
  const user = await openLabel()
  await user.click(screen.getByRole('button', { name: 'Save as New Template' }))
  let dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('Template name'), {
    target: { value: '  MARKET template ' },
  })
  expect(dialog.getByRole('alert')).toHaveTextContent('already exists')
  expect(dialog.getByRole('button', { name: 'Save template' })).toBeDisabled()
  expect(api.requests.filter((r) => r.action === 'labelSave')).toHaveLength(0)
  await user.click(dialog.getByRole('button', { name: 'Cancel' }))
  expect(api.active().find((t) => t.id === template.id)).toEqual(template)
  await user.click(screen.getByRole('button', { name: 'Save as New Template' }))
  dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('Template name'), {
    target: { value: template.name },
  })
  await user.click(
    dialog.getByRole('button', { name: 'Update existing “Market template”' }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(api.active().filter((t) => t.recordKind === 'template')).toHaveLength(
    1,
  )
  expect(api.active().find((t) => t.id === template.id)?.revision).toBe(2)
})

it('searches, renames, duplicates and deletes templates without deleting labels made from them', async () => {
  const template = design('Market master', 'template'),
    label = { ...design('Market label'), sourceTemplateId: template.id },
    api = setup([template, label])
  render(<api.App />)
  const user = userEvent.setup()
  await user.type(
    screen.getByPlaceholderText('Find your style…'),
    'Market master',
  )
  expect(screen.getAllByRole('article')).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'Rename' }))
  let dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('Template name'), {
    target: { value: 'Renamed master' },
  })
  await user.click(dialog.getByRole('button', { name: 'Rename template' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  await user.clear(screen.getByPlaceholderText('Find your style…'))
  await user.click(
    screen.getByRole('button', { name: 'Duplicate Renamed master' }),
  )
  dialog = within(screen.getByRole('dialog'))
  await user.click(dialog.getByRole('button', { name: 'Save template' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(api.active().filter((t) => t.recordKind === 'template')).toHaveLength(
    2,
  )
  await user.click(
    screen.getByRole('button', { name: 'Delete Renamed master' }),
  )
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Delete template',
    }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(api.active().find((t) => t.id === label.id)).toEqual(label)
  expect(api.active().filter((t) => t.recordKind === 'template')).toHaveLength(
    1,
  )
})

it('cancels single and bulk deletion, selects only filtered labels, persists deletion and clears selection', async () => {
  const labels = [design('Bread one'), design('Bread two'), design('Cookies')],
    template = design('Bread master', 'template'),
    api = setup([...labels, template])
  const app = render(<api.App />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Saved Labels' }))
  await user.click(screen.getByRole('button', { name: 'Delete Bread one' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('Delete “Bread one”?')
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
  )
  expect(api.active()).toHaveLength(4)
  await user.type(screen.getByPlaceholderText('Find your style…'), 'Bread')
  await user.click(
    screen.getByRole('checkbox', { name: 'Select All filtered labels' }),
  )
  expect(screen.getByText('2 selected · 2 matching labels')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Delete Selected' }))
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'Delete these 2 selected labels?',
  )
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
  )
  expect(api.active()).toHaveLength(4)
  await user.click(screen.getByRole('button', { name: 'Delete Selected' }))
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Delete 2 labels',
    }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(screen.getByText('0 selected · 0 matching labels')).toBeInTheDocument()
  expect(
    api
      .active()
      .map((t) => t.name)
      .sort(),
  ).toEqual(['Bread master', 'Cookies'])
  app.unmount()
  render(<api.App />)
  await user.click(screen.getByRole('button', { name: 'Saved Labels' }))
  expect(
    screen.queryByRole('heading', { name: 'Bread one' }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Cookies' })).toBeInTheDocument()
  expect(screen.getByText(/1 labels in this oven/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Templates' }))
  expect(
    screen.getByRole('heading', { name: 'Bread master' }),
  ).toBeInTheDocument()
})

it('warns before leaving dirty templates and closes the editor after its open label is deleted', async () => {
  const api = setup([
    design('Reusable bread', 'template'),
    design('Bread Label'),
  ])
  render(<api.App />)
  const user = userEvent.setup()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  await user.click(screen.getByRole('button', { name: 'Open template' }))
  fireEvent.change(screen.getByLabelText('Template name'), {
    target: { value: 'Unsaved template edit' },
  })
  await user.click(screen.getByRole('button', { name: 'Templates' }))
  expect(confirm).toHaveBeenCalledWith(
    expect.stringContaining('unsaved changes'),
  )
  expect(screen.getByLabelText('Template name')).toHaveValue(
    'Unsaved template edit',
  )
  expect(api.requests.some((r) => r.action === 'labelSave')).toBe(false)
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  confirm.mockReturnValue(true)
  await user.click(screen.getByRole('button', { name: 'Saved Labels' }))
  await user.click(screen.getByRole('button', { name: 'Open label' }))
  await user.click(screen.getByRole('button', { name: 'Saved Labels' }))
  await user.click(screen.getByRole('button', { name: 'Delete Bread Label' }))
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'The open design is included',
  )
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Delete label',
    }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(
    screen.queryByRole('button', { name: /Editor/ }),
  ).not.toBeInTheDocument()
  expect(
    screen.getByText(/The deleted design’s editor is closed/),
  ).toBeInTheDocument()
  expect(api.active()).toHaveLength(1)
  expect(labelRecordKind(api.active()[0] as LabelDocument)).toBe('template')
})

it('keeps failed deletion visible and retries uncertain template saves with the same ID and reference', async () => {
  const api = setup()
  render(<api.App />)
  const user = await openLabel()
  api.loseSaveResponse()
  await user.click(screen.getByRole('button', { name: 'Save as New Template' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('Template name'), {
    target: { value: 'Retry template' },
  })
  await user.click(dialog.getByRole('button', { name: 'Save template' }))
  expect(dialog.getByRole('alert')).toHaveTextContent(
    'Response lost after commit',
  )
  await user.click(dialog.getByRole('button', { name: 'Save template' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  const saves = api.requests.filter((r) => r.action === 'labelSave')
  expect(saves[0].data.operationId).toBe(saves[1].data.operationId)
  expect(saves[0].data.document.id).toBe(saves[1].data.document.id)
  expect(api.active().filter((t) => t.recordKind === 'template')).toHaveLength(
    1,
  )
  await user.click(screen.getByRole('button', { name: 'Saved Labels' }))
  await user.click(screen.getByRole('button', { name: 'Delete Bread Label' }))
  api.fail('Connection interrupted')
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Delete label',
    }),
  )
  expect(
    within(screen.getByRole('dialog')).getByRole('alert'),
  ).toHaveTextContent('Connection interrupted')
  expect(api.active().some((t) => t.name === 'Bread Label')).toBe(true)
  api.fail('')
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
  )
  expect(
    screen.getByRole('heading', { name: 'Bread Label' }),
  ).toBeInTheDocument()
})

it('never resurrects tombstones when a stale save or list response arrives', () => {
  const current = demoData(),
    incoming = demoData(),
    doc = design('Deleted label')
  current.settings[0].labelEditorScope = incoming.settings[0].labelEditorScope =
    'same-scope'
  const tombstone = { ...doc, deletedAt: new Date().toISOString(), revision: 2 }
  current.label_templates = [tombstone]
  incoming.label_templates = [doc]
  expect(mergeLabelWorkspace(current, incoming).label_templates).toEqual([
    tombstone,
  ])
  incoming.label_templates = [{ ...doc, revision: 99 }]
  expect(mergeLabelWorkspace(current, incoming).label_templates).toEqual([
    tombstone,
  ])
  current.label_templates = [doc]
  incoming.label_templates = [tombstone]
  expect(mergeLabelWorkspace(current, incoming).label_templates).toEqual([
    tombstone,
  ])
})
