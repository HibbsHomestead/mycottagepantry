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
  await user.click(screen.getByRole('button', { name: 'Saved Labels' }))
  await user.click(screen.getByRole('button', { name: /Open label/ }))
  return user
}
it('creates a reusable starter template, saves, reopens and remounts with exact contents and ID', async () => {
  const api = setup(false),
    user = userEvent.setup()
  const app = render(<api.App />)
  await user.click(screen.getAllByRole('button', { name: 'Use a copy' })[0])
  fireEvent.change(screen.getByLabelText('Template name'), {
    target: { value: 'Owner editable loaf' },
  })
  await user.click(screen.getByRole('button', { name: 'Update Template' }))
  await waitFor(() => expect(screen.getByText(/^Saved ·/)).toBeInTheDocument())
  const saved = structuredClone(api.workspace().label_templates[0])
  expect(saved.recordKind).toBe('template')
  await user.click(screen.getByRole('button', { name: 'Templates' }))
  await user.click(screen.getByRole('button', { name: 'Open template' }))
  await user.click(
    screen.getByRole('button', { name: 'Export editable recovery file' }),
  )
  expect(labelContent(state.snapshots.at(-1)!.document)).toBe(
    labelContent(saved as LabelDocument),
  )
  app.unmount()
  render(<api.App />)
  await user.click(screen.getByRole('button', { name: 'Open template' }))
  await user.click(
    screen.getByRole('button', { name: 'Export editable recovery file' }),
  )
  expect(labelContent(state.snapshots.at(-1)!.document)).toBe(
    labelContent(saved as LabelDocument),
  )
  expect(api.workspace().label_templates).toHaveLength(1)
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
  await user.click(screen.getByRole('button', { name: 'Saved Labels' }))
  expect(screen.getByRole('button', { name: /Open label/ })).toBeInTheDocument()
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
  await user.click(screen.getByRole('button', { name: 'Saved Labels' }))
  await user.click(screen.getByRole('button', { name: /Open label/ }))
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
