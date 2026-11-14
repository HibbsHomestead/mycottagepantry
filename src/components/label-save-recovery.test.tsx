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
import { labelContent } from '@/lib/label-persistence'
import type { Workspace } from '@/lib/domain'

const state = vi.hoisted(() => ({
  snapshots: [] as { document: LabelDocument }[],
}))
vi.mock('@/lib/label-client-export', () => ({
  downloadLabel: (bytes: Uint8Array) =>
    state.snapshots.push(JSON.parse(new TextDecoder().decode(bytes))),
  exportLabelPng: vi.fn(),
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  state.snapshots = []
})
function makeDocument(): LabelDocument {
  return {
    ...blankLabel(),
    id: crypto.randomUUID(),
    name: 'Bread Label',
    workflowVersion: 1,
    recordKind: 'label',
    width: 216,
    height: 288,
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
        groupId: 'name',
      },
      {
        ...newElement('text', '', 'product.labelProductType'),
        font: 'DM Sans',
        groupId: 'name',
        y: 60,
      },
    ],
    revision: 1,
    tags: [],
  }
}
function setup(existing = true) {
  let workspace = demoData()
  workspace.settings[0].labelEditorScope = 'private-scope'
  workspace.label_templates = existing ? [makeDocument()] : []
  for (const document of workspace.label_templates) {
    document.source = { kind: 'product', id: workspace.products[0].id }
    document.productId = workspace.products[0].id
    document.manualTextReviewedFor = `product:${workspace.products[0].id}:`
  }
  workspace.label_recovery_drafts = []
  workspace.label_versions = []
  let fail = '',
    incomplete = false,
    hold = false
  const pending: (() => void)[] = []
  const requests: { action: string; data: Record<string, unknown> }[] = []
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'))
    requests.push(body)
    if (body.action === 'labelSave' && hold)
      await new Promise<void>((resolve) => pending.push(resolve))
    if (fail) return { ok: false, json: async () => ({ error: fail }) }
    const { data } = body
    if (body.action === 'labelSave') {
      const previous = workspace.label_templates.find(
        (d) => d.id === data.document.id,
      )
      if (!incomplete && previous?.lastSaveOperationId !== data.operationId) {
        const saved = {
          ...structuredClone(data.document),
          revision: (previous?.revision || 0) + 1,
          savedAt: new Date().toISOString(),
          lastSaveOperationId: data.operationId,
        }
        workspace = {
          ...workspace,
          label_templates: [
            ...workspace.label_templates.filter((d) => d.id !== saved.id),
            saved,
          ],
        }
      }
    }
    if (body.action === 'labelDraft')
      workspace = {
        ...workspace,
        label_recovery_drafts: [
          {
            ...data,
            savedAt: new Date().toISOString(),
            name: data.document.name,
          },
        ],
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
    fetcher,
    requests,
    pending,
    workspace: () => workspace,
    fail: (message: string) => {
      fail = message
    },
    incomplete: () => {
      incomplete = true
    },
    hold: (value: boolean) => {
      hold = value
    },
  }
}
async function open() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Labels' }))
  await user.click(screen.getByRole('button', { name: /^Edit / }))
  return user
}
it('creates and explicitly saves a new label without a template prerequisite', async () => {
  const api = setup(false),
    user = userEvent.setup()
  render(<api.App />)
  await user.click(screen.getByRole('button', { name: 'Create label' }))
  fireEvent.change(screen.getByLabelText('Label name'), {
    target: { value: 'Owner editable loaf' },
  })
  await user.selectOptions(
    screen.getAllByLabelText('Product')[0],
    api.workspace().products[0].id,
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText(/^Saved ·/)
  expect(api.workspace().label_templates).toHaveLength(1)
  expect(api.workspace().label_templates[0].recordKind).toBe('label')
  expect(api.workspace().label_templates[0].productId).toBe(
    api.workspace().products[0].id,
  )
})
it('updates an existing rotated dynamic layout without changing element IDs, groups, or fonts', async () => {
  const api = setup(),
    app = render(<api.App />),
    user = await open()
  const initial = api.workspace().label_templates[0]
  fireEvent.change(screen.getByLabelText('Label name'), {
    target: { value: 'Updated loaf' },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.getByText(/^Saved ·/)).toBeInTheDocument())
  const saved = api.workspace().label_templates[0]
  expect(saved.id).toBe(initial.id)
  expect(saved.elements).toEqual(initial.elements)
  app.unmount()
  render(<api.App />)
  await open()
  await user.click(
    screen.getByRole('button', { name: 'Export editable recovery file' }),
  )
  expect(labelContent(state.snapshots.at(-1)!.document)).toBe(
    labelContent(saved as LabelDocument),
  )
})
it('keeps edits made during a slow save unsaved and prevents repeated clicks from duplicating requests', async () => {
  const api = setup()
  render(<api.App />)
  const user = await open()
  api.hold(true)
  fireEvent.change(screen.getByLabelText('Label name'), {
    target: { value: 'First edits' },
  })
  const save = screen.getByRole('button', { name: 'Save' })
  await user.dblClick(save)
  expect(save).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Label name'), {
    target: { value: 'Newer edits' },
  })
  api.hold(false)
  await act(async () => api.pending.shift()?.())
  await waitFor(() =>
    expect(
      screen.getByText('Unsaved changes', { selector: '.studio-save-state' }),
    ).toBeInTheDocument(),
  )
  expect(api.requests.filter((r) => r.action === 'labelSave')).toHaveLength(1)
  expect(api.workspace().label_templates[0].name).toBe('First edits')
  expect(screen.getByLabelText('Label name')).toHaveValue('Newer edits')
  await user.click(save)
  await waitFor(() => expect(screen.getByText(/^Saved ·/)).toBeInTheDocument())
  expect(api.workspace().label_templates[0].name).toBe('Newer edits')
})
it.each([
  'Network request failed',
  'Save timed out',
  'Log in to continue',
  'This action requires an Owner or Manager.',
])(
  'retains the layout after %s and retries with the same operation ID',
  async (message) => {
    const api = setup()
    render(<api.App />)
    const user = await open()
    api.fail(message)
    fireEvent.change(screen.getByLabelText('Label name'), {
      target: { value: 'Keep all my work' },
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Save failed — changes remain unsaved')
    expect(screen.getByLabelText('Label name')).toHaveValue('Keep all my work')
    await user.click(
      screen.getByRole('button', { name: 'Export editable recovery file' }),
    )
    expect(state.snapshots.at(-1)!.document.elements).toEqual(
      api.workspace().label_templates[0].elements,
    )
    api.fail('')
    await user.click(screen.getByRole('button', { name: 'Retry save' }))
    await waitFor(() =>
      expect(screen.getByText(/^Saved ·/)).toBeInTheDocument(),
    )
    const saves = api.requests.filter((r) => r.action === 'labelSave')
    expect(saves[0].data.operationId).toBe(saves[1].data.operationId)
  },
)
it('rejects an incomplete success response instead of reporting Saved', async () => {
  const api = setup()
  render(<api.App />)
  const user = await open()
  api.incomplete()
  fireEvent.change(screen.getByLabelText('Label name'), {
    target: { value: 'Incomplete response' },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('Save failed — changes remain unsaved')
  expect(screen.getByRole('alert')).toHaveTextContent(
    'did not confirm the complete editable label',
  )
})
it('offers a database checkpoint after interruption and recovers a copy without overwriting the saved label', async () => {
  const api = setup(),
    app = render(<api.App />),
    user = await open()
  api.fail('Save unavailable')
  fireEvent.change(screen.getByLabelText('Label name'), {
    target: { value: 'Interrupted session' },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('Save failed — changes remain unsaved')
  api.fail('')
  await waitFor(
    () => expect(api.workspace().label_recovery_drafts).toHaveLength(1),
    { timeout: 2500 },
  )
  const checkpoint = structuredClone(
    api.workspace().label_recovery_drafts[0].document,
  )
  app.unmount()
  render(<api.App />)
  await user.click(
    screen.getByRole('button', { name: 'Recover as editable copy' }),
  )
  expect(screen.getByText(/Recovered draft · unsaved copy/)).toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'Export editable recovery file' }),
  )
  const restored = state.snapshots.at(-1)!.document
  expect(restored.elements).toEqual(checkpoint.elements)
  expect(restored.id).not.toBe(checkpoint.id)
  expect(api.workspace().label_templates[0].name).toBe('Bread Label')
})
it('resets inherited template filters when opening My Labels and shows a tagless saved label', async () => {
  const api = setup()
  render(<api.App />)
  const user = userEvent.setup()
  await user.selectOptions(screen.getByLabelText('Style filter'), 'Farmhouse')
  await user.click(screen.getByRole('button', { name: 'Labels' }))
  expect(screen.getByRole('button', { name: /^Edit / })).toBeInTheDocument()
  expect(screen.getByLabelText('Style filter')).toHaveValue('All styles')
})
it('retries after a committed save loses its response without creating another revision or label', async () => {
  const api = setup(),
    originalFetch = globalThis.fetch
  let loseResponse = true
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const result = await originalFetch(url, init)
    if (
      JSON.parse(String(init?.body || '{}')).action === 'labelSave' &&
      loseResponse
    ) {
      loseResponse = false
      throw new TypeError('Connection interrupted after commit')
    }
    return result
  })
  render(<api.App />)
  const user = await open()
  fireEvent.change(screen.getByLabelText('Label name'), {
    target: { value: 'Committed but uncertain' },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText('Save failed — changes remain unsaved')
  const revision = api.workspace().label_templates[0].revision
  await user.click(screen.getByRole('button', { name: 'Retry save' }))
  await screen.findByText(/^Saved ·/)
  expect(api.workspace().label_templates).toHaveLength(1)
  expect(api.workspace().label_templates[0].revision).toBe(revision)
})
it('handles an aborted timeout without closing the editor and keeps its retry reference', async () => {
  const api = setup(),
    originalFetch = globalThis.fetch,
    controller = new AbortController()
  let timeOut = true
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (
      JSON.parse(String(init?.body || '{}')).action === 'labelSave' &&
      timeOut
    )
      return await new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(controller.signal.reason),
        ),
      )
    return originalFetch(url, init)
  })
  render(<api.App />)
  const user = await open()
  fireEvent.change(screen.getByLabelText('Label name'), {
    target: { value: 'Timeout layout' },
  })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await act(async () =>
    controller.abort(new DOMException('Timed out', 'TimeoutError')),
  )
  await screen.findByText('Save failed — changes remain unsaved')
  expect(screen.getByLabelText('Label name')).toHaveValue('Timeout layout')
  expect(screen.getByRole('alert')).toHaveTextContent('result is uncertain')
  timeOut = false
  await user.click(screen.getByRole('button', { name: 'Retry save' }))
  await screen.findByText(/^Saved ·/)
})
it('makes checkpoint-storage failure visible, preserves the editable state, and warns before leaving', async () => {
  const api = setup()
  render(<api.App />)
  const user = await open()
  api.fail('Database unavailable')
  fireEvent.change(screen.getByLabelText('Label name'), {
    target: { value: 'Preserve offline work' },
  })
  await waitFor(
    () =>
      expect(
        screen.getByText(/Recovery checkpoint failed:/),
      ).toBeInTheDocument(),
    { timeout: 2500 },
  )
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  await user.click(
    screen.getByRole('button', { name: 'Export editable recovery file' }),
  )
  expect(state.snapshots.at(-1)!.document.name).toBe('Preserve offline work')
  expect(screen.getByLabelText('Label name')).toHaveValue(
    'Preserve offline work',
  )
})
it('moves grouped dynamic name elements together without flattening bindings or typography', async () => {
  const api = setup()
  render(<api.App />)
  const user = await open()
  vi.stubGlobal('PointerEvent', MouseEvent)
  const initial = structuredClone(api.workspace().label_templates[0].elements)
  const paper = document.querySelector('.studio-paper') as HTMLElement
  paper.setPointerCapture = vi.fn()
  const main = paper.querySelector(`[data-element="${initial[1].id}"]`)!
  fireEvent.pointerDown(main, { clientX: 30, clientY: 30 })
  fireEvent.pointerMove(paper, { clientX: 46, clientY: 46 })
  fireEvent.pointerUp(paper)
  await user.click(
    screen.getByRole('button', { name: 'Export editable recovery file' }),
  )
  const moved = state.snapshots.at(-1)!.document.elements
  for (const index of [1, 2]) {
    expect(moved[index]).toEqual({
      ...initial[index],
      x: initial[index].x + 12,
      y: initial[index].y + 12,
    })
  }
  expect(moved[0]).toEqual(initial[0])
})
it('applies a different font to a selected static word and preserves the text runs after save and reopen', async () => {
  const api = setup()
  render(<api.App />)
  const user = await open()
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  await user.click(screen.getByRole('button', { name: 'Static text' }))
  const textarea = screen.getByLabelText('Text') as HTMLTextAreaElement
  fireEvent.change(textarea, { target: { value: 'Homestyle White Bread' } })
  await user.click(textarea)
  textarea.setSelectionRange(16, 21)
  fireEvent.select(textarea)
  const picker = within(
    screen.getByRole('group', { name: 'Font for selected text' }),
  )
  await user.click(picker.getByRole('button', { name: 'Font: DM Sans' }))
  await user.type(screen.getByRole('textbox', { name: 'Search fonts' }), 'Lora')
  await user.click(screen.getByRole('button', { name: 'Preview Lora' }))
  await user.click(screen.getByRole('button', { name: 'Apply Lora' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText(/^Saved ·/)
  await user.click(screen.getByRole('button', { name: 'Labels' }))
  await user.click(screen.getByRole('button', { name: /^Edit / }))
  await user.click(
    screen.getByRole('button', { name: 'Export editable recovery file' }),
  )
  const text = state.snapshots.at(-1)!.document.elements.at(-1)!
  expect(
    text.textRuns!.map((r: { text: string; font: string }) => [r.text, r.font]),
  ).toEqual([
    ['Homestyle White ', 'DM Sans'],
    ['Bread', 'Lora'],
  ])
})

it('round-trips compact formatting, precise geometry and layer order through save and reopen', async () => {
  const api = setup(),
    app = render(<api.App />),
    user = await open()
  const initial = structuredClone(api.workspace().label_templates[0])
  await user.click(screen.getByRole('button', { name: 'Layers' }))
  await user.click(screen.getByRole('button', { name: 'recipe.ingredients' }))
  const overlay = () =>
    document.querySelector(
      `[data-selection-overlay="${initial.elements[0].id}"]`,
    )
  expect(screen.getByLabelText('Rotation (°)')).toHaveValue(180)
  expect(screen.getByLabelText('Opacity')).toHaveValue(100)
  await user.click(screen.getByRole('button', { name: 'Bold' }))
  await user.click(screen.getByRole('button', { name: 'Italic' }))
  await user.click(screen.getByRole('button', { name: 'Underline' }))
  await user.click(screen.getByRole('button', { name: 'Align right' }))
  await user.click(screen.getByRole('button', { name: 'Align bottom' }))
  await user.selectOptions(screen.getByLabelText('Text case'), 'upper')
  for (const [label, value] of [
    ['Size (pt)', '11.375'],
    ['Line height', '1.45'],
    ['Letter spacing (pt)', '-0.125'],
    ['X (pt)', '-12.375'],
    ['Y (pt)', '83.0625'],
    ['Width (pt)', '174.875'],
    ['Height (pt)', '57.25'],
    ['Opacity', '37.125'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  expect(overlay()).not.toBeNull()
  // Keyboard operation of a toolbar button does not nudge the active element.
  screen.getByRole('button', { name: 'Bold' }).focus()
  await user.keyboard('{ArrowRight}')
  expect(screen.getByLabelText('X (pt)')).toHaveValue(-12.375)
  await user.click(screen.getByRole('button', { name: 'Choose text color' }))
  fireEvent.change(screen.getByLabelText('Picker HEX'), {
    target: { value: '#123abc' },
  })
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'Choose text color' }))
  fireEvent.change(screen.getByLabelText('Picker HEX'), {
    target: { value: '#476b46' },
  })
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  expect(
    screen.getByRole('button', { name: 'Choose text color' }),
  ).toHaveAttribute('title', 'Text color: #476b46 · 100%')
  await user.click(screen.getByRole('button', { name: 'Undo' }))
  expect(
    screen.getByRole('button', { name: 'Choose text color' }),
  ).toHaveAttribute('title', `Text color: ${initial.elements[0].color} · 100%`)
  await user.click(screen.getByRole('button', { name: 'Redo' }))
  await user.click(screen.getByRole('button', { name: 'Bring to front' }))
  expect(screen.getByRole('button', { name: 'Bring to front' })).toBeDisabled()
  expect(overlay()).not.toBeNull()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByText(/^Saved ·/)
  const saved = api.workspace().label_templates[0]
  expect(saved.width).toBe(initial.width)
  expect(saved.height).toBe(initial.height)
  expect(saved.elements.slice(0, 2)).toEqual(initial.elements.slice(1))
  expect(saved.elements[2]).toEqual({
    ...initial.elements[0],
    bold: true,
    italic: true,
    underline: true,
    align: 'right',
    vertical: 'bottom',
    textCase: 'upper',
    fontSize: 11.375,
    lineHeight: 1.45,
    letterSpacing: -0.125,
    color: '#476b46',
    colorOpacity: 1,
    x: -12.375,
    y: 83.0625,
    width: 174.875,
    height: 57.25,
    opacity: 0.37125,
  })
  app.unmount()
  render(<api.App />)
  await open()
  await user.click(screen.getByRole('button', { name: 'Layers' }))
  await user.click(screen.getByRole('button', { name: 'recipe.ingredients' }))
  for (const name of [
    'Bold',
    'Italic',
    'Underline',
    'Align right',
    'Align bottom',
  ])
    expect(screen.getByRole('button', { name })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  expect(screen.getByLabelText('Text case')).toHaveValue('upper')
  expect(screen.getByLabelText('Letter spacing (pt)')).toHaveValue(-0.125)
  expect(screen.getByLabelText('Opacity')).toHaveValue(37.125)
  expect(screen.getByLabelText('Rotation (°)')).toHaveValue(180)
  await user.click(
    screen.getByRole('button', { name: 'Export editable recovery file' }),
  )
  expect(labelContent(state.snapshots.at(-1)!.document)).toBe(
    labelContent(saved as LabelDocument),
  )
})
