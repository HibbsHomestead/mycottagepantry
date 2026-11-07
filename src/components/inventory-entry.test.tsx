import { expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProductWorkflowDialog } from './product-workflow-dialog'
import { FabricDialog } from './fabric-dialog'
import { PurchaseStockReceipts } from './finished-inventory'
import { demoData } from '@/lib/demo'
import { ovenToday } from '@/lib/oven-dates'
afterEach(() => vi.unstubAllGlobals())
it.each([
  'trade-material',
  'trade-product-resale',
  'trade-product',
  'trade-receive',
])(
  'shows shared URL controls in %s and retains actual receiving fields',
  async (kind) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ categories: [], rates: [], mappings: [], revision: 0 }),
      ),
    )
    const w = demoData()
    render(
      <ProductWorkflowDialog
        kind={kind}
        item={
          kind === 'trade-receive'
            ? {
                id: 'resale',
                name: 'Mug',
                workflow: 'resale',
                quantity: 3,
                cost: 2,
                price: 14,
                receivedDate: '2026-01-01',
                purchaseDate: '2026-01-01',
                productSourceUrl: 'https://example.org/mug',
              }
            : null
        }
        workspace={w}
        role="Owner"
        mutate={vi.fn()}
        onWorkspace={vi.fn()}
        close={vi.fn()}
        onDirty={vi.fn()}
      />,
    )
    // Product editors keep link import on the Details tab (opened first).
    expect(screen.getByLabelText('Product URL')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Import details' })).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Paste product text instead' }),
    ).toBeVisible()
    if (kind === 'trade-receive') {
      expect(screen.getByLabelText('Product URL')).toHaveValue(
        'https://example.org/mug',
      )
      expect(
        screen.getByLabelText('Purchase quantity (packs/cases)'),
      ).toHaveValue(null)
      expect(screen.getByLabelText('Total acquisition cost')).toHaveValue(null)
      expect(screen.getByLabelText('Received date')).toHaveValue(
        ovenToday(w.settings[0]),
      )
      expect(screen.getByLabelText('Purchase date (optional)')).toHaveValue('')
    }
  },
)
it.each(['fabric-edit', 'fabric-receive'])(
  'shares the importer with %s while keeping width and received length distinct',
  (kind) => {
    const w = demoData(),
      item = {
        id: 'fabric',
        name: 'Cotton fabric',
        usedAs: 'material',
        materialType: 'fabric',
        fabricTracking: 'length',
        pieceMode: 'aggregate',
        quantity: 4,
        cost: 3,
        unit: 'yd',
        storageUnit: 'yd',
        fabricWidth: 44,
        widthUnit: 'in',
        productSourceUrl: 'https://example.org/cotton',
      }
    render(
      <FabricDialog
        kind={kind}
        item={item}
        workspace={w}
        role="Owner"
        mutate={vi.fn()}
        onWorkspace={vi.fn()}
        close={vi.fn()}
        onDirty={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Product URL')).toHaveValue(
      item.productSourceUrl,
    )
    expect(screen.getByRole('button', { name: 'Import details' })).toBeVisible()
    if (kind === 'fabric-edit')
      expect(screen.getByLabelText('Fabric width')).toBeDisabled()
  },
)
it('proposes a local received date for explicit approval and displays Added at without altering the record', () => {
  const w = demoData(),
    correctDate = vi.fn()
  w.settings[0].timezone = 'America/Chicago'
  w.ledger = [
    {
      id: 'r',
      name: 'Pans',
      type: 'purchase_receipt',
      quantity: 100,
      amount: 12,
      unit: 'each',
      date: '2026-11-04',
      addedAt: '2026-11-04T02:57:26Z',
    },
  ]
  render(
    <PurchaseStockReceipts
      workspace={w}
      role="Owner"
      open={vi.fn()}
      correctDate={correctDate}
    />,
  )
  expect(
    screen.getByRole('columnheader', { name: 'Received date' }),
  ).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Details / review date' }))
  expect(screen.getByText(/Added at:/)).toHaveTextContent(
    'Nov 3, 2026, 8:57 PM',
  )
  expect(screen.getByLabelText('Correct received date')).toHaveValue(
    '2026-11-03',
  )
  expect(
    screen.getByRole('button', { name: 'Approve date correction' }),
  ).toBeDisabled()
  expect(correctDate).not.toHaveBeenCalled()
  expect(w.ledger[0].date).toBe('2026-11-04')
})
