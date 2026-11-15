import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { launchPricing } from '@/lib/launch-plans'
const client = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/billing-client', () => ({ billingRequest: client.request }))
import { StripeOwnerBilling } from './stripe-owner-billing'

const subscription = () => ({
  workspace: { id: 'test-business', name: 'Disposable Test Kitchen' },
  canManage: true,
  hasSubscription: true,
  seatUsage: 2,
  billing: {
    plan: 'cottage-kitchen',
    provider: 'stripe_test',
    status: 'paid_active',
    paidThrough: '2027-01-01',
    lastReconciled: '2026-12-01',
  },
  subscription: {
    plan: 'cottage-kitchen',
    monthlyCents: 3000,
    currency: 'usd',
    interval: 'month',
    intervalCount: 1,
    status: 'active',
    environment: 'test',
    renewsAt: '2027-01-01',
  },
  access: { plan: 'cottage-kitchen' },
  changes: [],
  attempts: [],
  available: [{ environment: 'test', plans: ['cottage-mercantile'] }],
  changePlans: launchPricing.plans.map((p) => ({
    id: p.id,
    purchasable: p.id !== 'free',
    reason: 'Available monthly subscription.',
  })),
})
beforeEach(() => {
  client.request.mockReset().mockResolvedValue(subscription())
  history.replaceState({}, '', '/oven/billing')
})

it('shows verified billing and routes existing subscribers only to reviewed changes and the portal', async () => {
  render(<StripeOwnerBilling />)
  expect(
    await screen.findByText('BILLING FOR Disposable Test Kitchen'),
  ).toBeInTheDocument()
  expect(
    screen.getByText(/\$30.00 USD per business \/ month/),
  ).toBeInTheDocument()
  expect(
    screen.getAllByText(/5 total users, including the owner/).length,
  ).toBeGreaterThan(0)
  expect(
    screen.getByText('2 active users, including the owner'),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /hosted checkout/ }),
  ).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Manage payment method' }),
  )
  expect(client.request).toHaveBeenLastCalledWith({ action: 'portal' })
})

it('discloses provider proration and access changes before confirmation, then waits for provider confirmation', async () => {
  history.replaceState({}, '', '/oven/billing?plan=cottage-mercantile')
  render(<StripeOwnerBilling />)
  await screen.findByText('BILLING FOR Disposable Test Kitchen')
  client.request.mockResolvedValueOnce({
    preview: {
      id: 'preview-id',
      fromPlan: 'cottage-kitchen',
      toPlan: 'cottage-mercantile',
      kind: 'upgrade',
      fromMonthlyCents: 3000,
      toMonthlyCents: 4000,
      amountDue: 437,
      fromUsers: 5,
      toUsers: 6,
      seatUsage: 2,
      expiresAt: '2027-01-01',
      timing:
        'Immediately, after Stripe confirms payment of any prorated amount.',
      added: ['resaleModule', 'consignment', 'resaleMerchandise'],
      removed: [],
    },
  })
  await userEvent.click(
    screen.getByRole('button', { name: 'Review plan change' }),
  )
  expect(client.request).toHaveBeenLastCalledWith({
    action: 'preview_change',
    plan: 'cottage-mercantile',
  })
  const dialog = await screen.findByRole('dialog', {
    name: 'Review subscription change',
  })
  expect(dialog).toHaveTextContent('Cottage Kitchen → Cottage Mercantile')
  expect(dialog).toHaveTextContent('$40.00 USD/month per business')
  expect(dialog).toHaveTextContent('$4.37 USD · Stripe preview')
  expect(dialog).toHaveTextContent('5 → 6 total users, including the owner')
  expect(dialog).toHaveTextContent(
    'Invitations and member administration are Coming soon',
  )
  const confirm = within(dialog).getByRole('button', {
    name: 'Confirm subscription change',
  })
  expect(confirm).toBeDisabled()
  await userEvent.click(within(dialog).getByRole('checkbox'))
  client.request.mockResolvedValueOnce({
    ...subscription(),
    changes: [
      {
        id: 'preview-id',
        fromPlan: 'cottage-kitchen',
        toPlan: 'cottage-mercantile',
        status: 'pending',
        kind: 'upgrade',
      },
    ],
  })
  await userEvent.click(confirm)
  expect(client.request).toHaveBeenLastCalledWith({
    action: 'confirm_change',
    changeId: 'preview-id',
    confirmed: true,
  })
  expect(
    await screen.findByText(/The change is awaiting Stripe confirmation/),
  ).toBeInTheDocument()
  expect(
    screen.queryByText('Stripe confirmed the plan change.'),
  ).not.toBeInTheDocument()
  expect(
    client.request.mock.calls.some(([body]) => body.action === 'checkout'),
  ).toBe(false)
})

it('keeps provider failures visible without claiming success', async () => {
  render(<StripeOwnerBilling />)
  await screen.findByText('BILLING FOR Disposable Test Kitchen')
  await userEvent.selectOptions(
    screen.getByLabelText('New plan'),
    'cottage-mercantile',
  )
  client.request.mockRejectedValueOnce(
    new Error(
      'Stripe is temporarily unavailable. Existing access is preserved.',
    ),
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Review plan change' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Existing access is preserved',
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('shows a scheduled downgrade and confirms keeping the current subscription before cancelling it', async () => {
  const data = subscription()
  client.request.mockResolvedValueOnce({
    ...data,
    changes: [
      {
        id: 'pending',
        fromPlan: 'cottage-kitchen',
        toPlan: 'mixing-bowl',
        kind: 'downgrade',
        status: 'scheduled',
        effectiveAt: '2027-01-01',
      },
    ],
  })
  render(<StripeOwnerBilling />)
  await screen.findByRole('heading', { name: 'Scheduled subscription change' })
  expect(
    screen.queryByRole('button', { name: 'Review plan change' }),
  ).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Cancel pending change' }),
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'Keep your current subscription?',
  })
  await userEvent.click(
    within(dialog).getByRole('button', {
      name: 'Confirm keeping current subscription',
    }),
  )
  expect(client.request).toHaveBeenLastCalledWith({
    action: 'cancel_pending',
    confirmed: true,
  })
})

it('reconciles on portal return and offers checkout only to an unsubscribed business', async () => {
  history.replaceState(
    {},
    '',
    '/oven/billing?checkout=verifying&plan=cottage-mercantile',
  )
  client.request.mockResolvedValue({
    ...subscription(),
    hasSubscription: false,
    billing: null,
    subscription: null,
    access: { plan: 'free' },
    seatUsage: 1,
  })
  render(<StripeOwnerBilling />)
  const checkout = await screen.findByRole('button', {
    name: 'Continue / resume hosted checkout',
  })
  expect(client.request).toHaveBeenCalledWith({ action: 'refresh' })
  expect(checkout).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox'))
  await userEvent.click(checkout)
  expect(client.request).toHaveBeenLastCalledWith({
    action: 'checkout',
    environment: 'test',
    plan: 'cottage-mercantile',
    confirmed: true,
  })
})

it('explains owner-only billing without exposing controls to an unauthorized member', async () => {
  client.request.mockRejectedValue(
    Object.assign(
      new Error(
        'Only an active business owner can manage billing for this business.',
      ),
      { code: 'OWNER_REQUIRED' },
    ),
  )
  render(<StripeOwnerBilling />)
  expect(
    await screen.findByText(/The business owner manages billing/),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Manage payment method' }),
  ).not.toBeInTheDocument()
})

it('explains retained cancelled coverage and prevents a duplicate checkout offer', async () => {
  client.request.mockResolvedValue({
    ...subscription(),
    hasSubscription: false,
    checkoutBlockedReason:
      'Wait until verified paid coverage ends before subscribing again.',
  })
  render(<StripeOwnerBilling />)
  expect(
    await screen.findByText(/Wait until verified paid coverage ends/),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /hosted checkout/ }),
  ).not.toBeInTheDocument()
})
