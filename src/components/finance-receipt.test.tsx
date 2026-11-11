import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { FinanceWorkspace } from './finance-workspace'
import { demoData } from '@/lib/demo'
import type { Workspace, Item } from '@/lib/domain'
vi.mock('./receipt-document-preview', () => ({
  ReceiptDocumentPreview: () => <div>Private receipt preview</div>,
}))
afterEach(() => vi.unstubAllGlobals())
const base = {
  id: 'receipt-1',
  name: 'Invoice.pdf',
  filename: 'Invoice.pdf',
  fileHash: 'saved-file',
  status: 'draft',
  extractionStatus: 'queued',
  updatedAt: 'v1',
  vendor: '',
  date: '',
  subtotal: null,
  tax: null,
  total: null,
  lines: [],
}
function App({ initial }: { initial?: Workspace }) {
  const [w, setW] = useState(initial || demoData())
  return (
    <FinanceWorkspace
      workspace={w}
      onWorkspace={setW}
      section="Receipt inbox"
      ready
      role="Owner"
    />
  )
}
const response = (workspace: Workspace) => Response.json({ workspace })
it('uploads, reads, populates review, and makes no posting request before confirmation', async () => {
  const user = userEvent.setup(),
    workspace = demoData()
  let finish: (v: Response) => void = () => {}
  const pending = new Promise<Response>((r) => {
    finish = r
  })
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('receiptUpload')) return Response.json({ receipt: base })
    const body = JSON.parse(String(init?.body))
    expect(body.action).toBe('receiptExtract')
    return pending
  })
  vi.stubGlobal('fetch', fetcher)
  render(<App initial={workspace} />)
  await user.upload(
    screen.getByLabelText('Upload receipt'),
    new File(['%PDF-1.7'], 'Invoice.pdf', { type: 'application/pdf' }),
  )
  const dialog = screen.getByRole('dialog', { name: 'Review receipt' })
  await waitFor(() =>
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'Reading receipt',
    ),
  )
  expect(
    within(dialog).getByRole('textbox', { name: 'Merchant' }),
  ).toBeDisabled()
  workspace.receipt_extractions = [
    {
      ...base,
      vendor: 'The mill',
      date: '2026-11-02',
      subtotal: 10,
      total: 10,
      tax: null,
      extractionStatus: 'partial',
      updatedAt: 'v2',
      lines: [
        {
          description: 'Flour',
          amount: 10,
          quantity: null,
          unit: '',
          printedQuantity: 2,
          printedUnit: 'bags',
          decision: '',
        },
      ],
    },
  ]
  finish(response(workspace))
  await waitFor(() =>
    expect(
      within(dialog).getByRole('textbox', { name: 'Merchant' }),
    ).toHaveValue('The mill'),
  )
  expect(within(dialog).getByRole('status')).toHaveTextContent(
    'Partially extracted',
  )
  await user.click(within(dialog).getByRole('button', { name: /Flour.*Edit/ }))
  await user.click(within(dialog).getByText('Printed package details'))
  expect(within(dialog).getByLabelText('Printed purchase count')).toHaveValue(2)
  expect(within(dialog).getByLabelText('Receipt tax ($)')).toHaveValue(null)
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(
    screen.getByRole('button', { name: 'Review confirmation' }),
  ).toBeEnabled()
})
it('persists corrections before retry and keeps the editable review open when replacement values arrive', async () => {
  const user = userEvent.setup(),
    workspace = demoData()
  workspace.receipt_extractions = [
    { ...base, vendor: 'Original', extractionStatus: 'failed' },
  ]
  const actions: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const { action, data } = JSON.parse(String(init?.body))
      actions.push(action)
      const current = workspace.receipt_extractions[0]
      if (action === 'receiptDraft')
        workspace.receipt_extractions = [
          { ...current, ...data, updatedAt: 'v2' },
        ]
      if (action === 'receiptExtract')
        workspace.receipt_extractions = [
          {
            ...workspace.receipt_extractions[0],
            extractionStatus: 'partial',
            updatedAt: 'v3',
            pendingExtraction: { vendor: 'Different merchant', lines: [] },
          },
        ]
      if (action === 'receiptDismissExtraction') {
        delete workspace.receipt_extractions[0].pendingExtraction
        workspace.receipt_extractions[0].updatedAt = 'v4'
      }
      return response(structuredClone(workspace))
    }),
  )
  render(<App initial={workspace} />)
  await user.click(screen.getByRole('button', { name: /Original/ }))
  const vendor = screen.getByRole('textbox', { name: 'Merchant' })
  await user.clear(vendor)
  await user.type(vendor, 'Owner correction')
  await user.click(screen.getByRole('button', { name: 'Retry reading' }))
  await screen.findByText('Review replacement values')
  expect(screen.getByRole('textbox', { name: 'Merchant' })).toHaveValue(
    'Owner correction',
  )
  expect(actions).toEqual(['receiptDraft', 'receiptExtract'])
  await user.click(screen.getByRole('button', { name: 'Keep my edits' }))
  await waitFor(() =>
    expect(
      screen.queryByText('Review replacement values'),
    ).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('dialog', { name: 'Review receipt' })).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Merchant' })).toHaveValue(
    'Owner correction',
  )
  expect(actions).not.toContain('receiptPost')
})
it('creates a receipt-line item through the shared dialog and returns with it selected without posting stock', async () => {
  const user = userEvent.setup(),
    workspace = demoData()
  workspace.receipt_extractions = [
    {
      ...base,
      vendor: 'Supplier',
      extractionStatus: 'complete',
      lines: [
        {
          id: 'line-1',
          description: 'Receipt bags',
          decision: 'inventory',
          amount: 12,
          quantity: 1,
          unit: '',
          createNew: false,
        },
      ],
    },
  ]
  const calls: { action: string; table: string; data: Item }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      calls.push(body)
      if (body.action === 'save')
        workspace.ingredients.push({
          ...body.data,
          quantity: 0,
          cost: 0,
          unit: 'each',
        })
      return response(structuredClone(workspace))
    }),
  )
  render(<App initial={workspace} />)
  await user.click(screen.getByRole('button', { name: /Supplier/ }))
  await user.click(screen.getByRole('button', { name: /Receipt bags.*Edit/ }))
  await user.selectOptions(screen.getByLabelText('Match inventory item'), 'new')
  const dialog = within(screen.getByRole('dialog', { name: 'Add Item' }))
  expect(dialog.getByLabelText('Item Type')).toHaveValue('')
  await user.selectOptions(dialog.getByLabelText('Item Type'), 'packaging')
  expect(dialog.getByLabelText('Item name')).toHaveValue('Receipt bags')
  expect(
    dialog.queryByLabelText('Add opening stock / record a purchase now.'),
  ).not.toBeInTheDocument()
  await user.click(dialog.getByRole('button', { name: 'Save item' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Add Item' }),
    ).not.toBeInTheDocument(),
  )
  expect(screen.getByLabelText('Match inventory item')).toHaveValue(
    'ingredients:' + calls[0].data.id,
  )
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({
    action: 'save',
    table: 'ingredients',
    data: { initialStock: false, usedAs: 'packaging' },
  })
})
it('recovers a lost confirmation response by reading the existing posted receipt instead of repeating effects', async () => {
  const user = userEvent.setup(),
    workspace = demoData(),
    calls: string[] = []
  workspace.receipt_extractions = [
    {
      ...base,
      vendor: 'Recovered purchase',
      date: '2026-11-10',
      tax: 0,
      total: 10,
      subtotal: 10,
      arithmeticVersion: 2,
      taxTreatment: 'exclusive',
      lines: [
        {
          description: 'Supplies',
          amount: 10,
          decision: 'expense',
          category: 'Supplies expense',
        },
      ],
    },
  ]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        calls.push(body.action)
        expect(body.action).toBe('receiptPost')
        workspace.receipt_extractions[0].status = 'posted'
        throw new TypeError('Connection lost after confirmation')
      }
      calls.push('read-status')
      return response(structuredClone(workspace))
    }),
  )
  render(<App initial={workspace} />)
  await user.click(screen.getByRole('button', { name: /Recovered purchase/ }))
  await user.click(screen.getByRole('button', { name: 'Review confirmation' }))
  await user.click(screen.getByRole('button', { name: 'Confirm & post' }))
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Review receipt' }),
    ).not.toBeInTheDocument(),
  )
  expect(calls).toEqual(['receiptPost', 'read-status'])
  expect(screen.getByRole('status')).toHaveTextContent('Receipt is confirmed')
})
