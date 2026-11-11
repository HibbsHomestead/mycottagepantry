import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { FinanceWorkspace } from './finance-workspace'
import { demoData } from '@/lib/demo'
it('reviews an owner contribution before making any accounting request', async () => {
  const user = userEvent.setup(),
    workspace = demoData(),
    fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ workspace })))
  vi.stubGlobal('fetch', fetcher)
  try {
    render(
      <FinanceWorkspace
        workspace={workspace}
        onWorkspace={vi.fn()}
        section="Money activity"
        ready
        role="Owner"
      />,
    )
    await user.click(
      screen.getByRole('button', { name: 'Record a transaction' }),
    )
    await user.click(screen.getByRole('button', { name: /Owner contribution/ }))
    await user.type(
      screen.getByRole('textbox', { name: 'Owner' }),
      'Bakery owner',
    )
    await user.type(
      screen.getByRole('spinbutton', { name: 'Amount ($)' }),
      '500',
    )
    expect(fetcher).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByText('Ready to confirm')).toBeInTheDocument()
    expect(fetcher).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm & post' }))
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.action).toBe('financeEntry')
    expect(body.data).toMatchObject({
      kind: 'contribution',
      name: 'Bakery owner',
      amount: '500',
    })
  } finally {
    vi.unstubAllGlobals()
  }
})
it('opens a receipt draft with line decisions and leaves posting to an explicit confirmation', async () => {
  const user = userEvent.setup(),
    workspace = demoData(),
    fetcher = vi.fn()
  workspace.receipt_extractions = [
    {
      id: 'r',
      name: 'Receipt',
      vendor: 'The mill',
      date: '2026-10-29',
      status: 'draft',
      subtotal: 10,
      tax: 0,
      total: 10,
      lines: [
        {
          description: 'Flour',
          amount: 10,
          quantity: 1,
          unit: 'lb',
          decision: '',
          category: 'Miscellaneous expense',
        },
      ],
    },
  ]
  vi.stubGlobal('fetch', fetcher)
  try {
    render(
      <FinanceWorkspace
        workspace={workspace}
        onWorkspace={vi.fn()}
        section="Receipt inbox"
        ready
        role="Owner"
      />,
    )
    await user.click(screen.getByRole('button', { name: /The mill/ }))
    expect(
      screen.getByRole('dialog', { name: 'Review receipt' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', {name: /Flour.*Edit/}))
    expect(
      screen.getByRole('combobox', { name: 'What is this for?' }),
    ).toHaveValue('')
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'What is this for?' }),
      'expense',
    )
    expect(
      screen.getByRole('combobox', { name: 'Expense category' }),
    ).toHaveValue('Miscellaneous expense')
    expect(fetcher).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save as draft' })).toBeEnabled()
  } finally {
    vi.unstubAllGlobals()
  }
})

it.each([
  ['Sale / income', 'Record a sale'],
  ['Expense / purchase', 'Record an expense'],
  ['Vendor bill', 'Record a vendor bill'],
  ['Vendor payment', 'Record vendor payment'],
  ['Owner contribution', 'Record owner contribution'],
  ['Owner withdrawal', 'Record owner draw'],
  ['Consignment sale', 'Record consignment sale'],
  ['Consignor payout', 'Create payout'],
  ['Transfer between business accounts', 'Transfer between business accounts'],
])(
  'routes %s to its existing entry workflow without posting',
  async (choice, title) => {
    const user = userEvent.setup(),
      fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    try {
      render(
        <FinanceWorkspace
          workspace={demoData()}
          onWorkspace={vi.fn()}
          section="Money activity"
          ready
          role="Owner"
        />,
      )
      await user.click(
        screen.getByRole('button', { name: 'Record a transaction' }),
      )
      await user.click(
        screen.getByRole('button', { name: new RegExp('^' + choice) }),
      )
      expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  },
)
it('keeps entered owner details when returning to transaction types', async () => {
  const user = userEvent.setup()
  render(
    <FinanceWorkspace
      workspace={demoData()}
      onWorkspace={vi.fn()}
      section="Money activity"
      ready
      role="Owner"
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Record a transaction' }))
  await user.click(screen.getByRole('button', { name: /^Owner contribution/ }))
  await user.type(
    screen.getByRole('textbox', { name: 'Owner' }),
    'Bakery owner',
  )
  await user.click(
    screen.getByRole('button', { name: 'Back to transaction types' }),
  )
  await user.click(screen.getByRole('button', { name: /^Owner contribution/ }))
  expect(screen.getByRole('textbox', { name: 'Owner' })).toHaveValue(
    'Bakery owner',
  )
})
it('keeps accounting details collapsed in the padded card footer', () => {
  render(
    <FinanceWorkspace
      workspace={demoData()}
      onWorkspace={vi.fn()}
      section="Money activity"
      ready
      role="Owner"
    />,
  )
  const disclosure = screen
    .getByText('View accounting details')
    .closest('details')!
  expect(disclosure).not.toHaveAttribute('open')
  expect(disclosure).toHaveClass('card-disclosure')
  expect(
    screen.getByText(/For recordkeeping, not legal/).closest('.panel'),
  ).toBeNull()
})
