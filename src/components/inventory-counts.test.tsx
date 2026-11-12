import { useState } from 'react'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { InventoryCounts } from './inventory-counts'
import { demoData } from '@/lib/demo'
import { rapidCountCommand } from '@/lib/rapid-count'
import type { Item, Workspace } from '@/lib/domain'
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
function fixture(failAfterSave = false) {
  const server = demoData()
  server.inventory_counts = []
  server.journals = []
  server.ingredients = [
    {
      id: 'sugar',
      name: 'Sugar',
      quantity: 0,
      unit: 'lb',
      cost: 1,
      barcode: '000007',
      purchaseQuantity: 7,
      purchaseUnit: 'lb',
    },
  ]
  server.ledger = []
  const revision = (i: Item) =>
    JSON.stringify([i.quantity, i.unit, server.ledger])
  const ctx = {
    actor: 'counter',
    role: 'Owner',
    now: new Date().toISOString(),
    businessName: 'Disposable business',
    revision,
  }
  const apply = (effects: ReturnType<typeof rapidCountCommand>) => {
    for (const e of effects)
      server[e.table] = [
        ...(server[e.table] || []).filter((r) => r.id !== e.item.id),
        e.item,
      ]
  }
  apply(
    rapidCountCommand(
      server,
      {
        id: 'session',
        op: 'start',
        name: 'Fixture count',
        type: 'periodic',
        preset: 'Quarterly',
        scopeIds: ['sugar'],
      },
      ctx,
    ),
  )
  const response = () => ({
    ...structuredClone(server),
    ingredients: server.ingredients.map((i) => ({
      ...i,
      inventoryRevision: revision(i),
    })),
  })
  let lost = failAfterSave
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body))
      apply(rapidCountCommand(server, body.data, ctx))
      if (lost) {
        lost = false
        throw new Error('Connection interrupted after save')
      }
      return new Response(JSON.stringify({ workspace: response() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  )
  vi.stubGlobal('fetch', fetcher)
  let update!: (w: Workspace) => void
  const open = vi.fn()
  function Harness() {
    const [w, setW] = useState<Workspace>(response())
    update = setW
    return (
      <InventoryCounts
        workspace={w}
        onWorkspace={setW}
        role="Owner"
        ready
        open={open}
        refresh={async () => setW(response())}
      />
    )
  }
  render(<Harness />)
  return {
    server,
    response,
    update: (w: Workspace) => update(w),
    open,
    fetcher,
  }
}
it('preserves a pending scan after response loss and retries the same operation without doubling it', async () => {
  const f = fixture(true),
    user = userEvent.setup()
  await user.click(
    screen.getByRole('button', { name: /Fixture count.*In progress/ }),
  )
  await user.type(
    screen.getByRole('textbox', {
      name: 'Manual / external scanner barcode',
    }),
    '000007{Enter}',
  )
  await screen.findByText(/Connection interrupted after save/, {
    exact: false,
  })
  expect(f.server.inventory_counts[0].lines[0].countedQuantity).toBe(7)
  await user.click(
    screen.getByRole('button', { name: 'Retry pending saves' }),
  )
  await waitFor(() =>
    expect(
      screen.getByText('All changes saved to your business'),
    ).toBeInTheDocument(),
  )
  expect(f.server.inventory_counts[0].lines[0].countedQuantity).toBe(7)
  const operations = f.fetcher.mock.calls.map(
    (c) => JSON.parse(String(c[1]?.body)).data.operationId,
  )
  expect(operations[0]).toBe(operations[1])
  expect(f.server.ingredients[0].quantity).toBe(0)
})
it('keeps the saved session when opening the existing new-item editor and adds that item to the same count', async () => {
  const f = fixture(),
    user = userEvent.setup()
  await user.click(
    screen.getByRole('button', { name: /Fixture count.*In progress/ }),
  )
  await user.type(
    screen.getByRole('textbox', {
      name: 'Manual / external scanner barcode',
    }),
    '000999{Enter}',
  )
  await screen.findByRole('button', { name: 'Resolve / link' })
  await user.click(screen.getByRole('button', { name: 'Resolve / link' }))
  await user.click(
    screen.getByRole('button', {
      name: 'Create new item in existing editor',
    }),
  )
  expect(f.open).toHaveBeenCalledWith(
    'ingredient',
    expect.objectContaining({ barcode: '000999', quantity: 0 }),
  )
  f.server.ingredients.push({
    id: 'new',
    name: 'New jars',
    quantity: 0,
    unit: 'each',
    cost: 1,
  })
  await act(async () => f.update(f.response()))
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Link existing item' }),
    'new',
  )
  await user.click(
    screen.getByRole('button', { name: 'Add linked item to scope' }),
  )
  await waitFor(() =>
    expect(f.server.inventory_counts[0].scope).toHaveLength(2),
  )
  expect(f.server.inventory_counts[0].events[0].barcode).toBe('000999')
  expect(
    screen.getByRole('heading', { name: 'Fixture count' }),
  ).toBeInTheDocument()
})
