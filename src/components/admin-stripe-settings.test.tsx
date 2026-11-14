import { expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminStripeSettings } from './admin-stripe-settings'
import { launchPricing } from '@/lib/launch-plans'

vi.mock('./admin-step-up', () => ({ AdminStepUp: () => null }))

it('separates visible tier, sandbox authorization, missing mapping and live approval', async () => {
  render(
    <AdminStripeSettings
      data={{ tiers: launchPricing.plans, rows: [], encryptionReady: true }}
      request={vi.fn()}
    />,
  )
  const user = userEvent.setup()
  await user.click(screen.getByText('Tier and recurring Price mappings'))
  const tier = screen.getByText('Cottage Mercantile').closest('p')!
  expect(tier).toHaveTextContent(
    '$40/month · 6 users · internal available · TEST tier approved',
  )
  expect(tier).toHaveTextContent('Missing validated recurring Price mapping')
  await user.selectOptions(screen.getByLabelText('Environment'), 'live')
  await user.selectOptions(
    screen.getByLabelText('Tier', { exact: true }),
    'cottage-mercantile',
  )
  expect(tier).toHaveTextContent('live tier approval required')
  expect(
    screen.getByRole('checkbox', {
      name: /Approve LIVE purchase availability/,
    }),
  ).toBeDisabled()
  expect(
    screen.getByText(/Cottage Mercantile · \$40 USD\/month · six total users/),
  ).toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Environment'), 'test')
  expect(
    screen.getByRole('checkbox', {
      name: /Approve TEST purchase availability/,
    }),
  ).toBeEnabled()
})

it('reflects refreshed API readiness and refreshed parent data without exposing credentials', async () => {
  const unavailable = {
    encryptionReady: false,
    encryptionStatus: { status: 'missing' },
  }
  const ready = {
    encryptionReady: true,
    encryptionStatus: { status: 'valid' },
  }
  const request = vi.fn().mockResolvedValue(ready)
  const { rerender } = render(
    <AdminStripeSettings data={unavailable} request={request} />,
  )
  expect(screen.getByText(/ROOT_MISSING/)).toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Refresh connection status' }),
  )
  await waitFor(() =>
    expect(
      screen.getByText('Encrypted credential storage: Ready.'),
    ).toBeInTheDocument(),
  )
  expect(request).toHaveBeenCalledWith('action=stripe')
  rerender(
    <AdminStripeSettings
      data={{
        encryptionReady: false,
        encryptionStatus: { status: 'invalid_format' },
      }}
      request={request}
    />,
  )
  expect(screen.getByText(/ROOT_INVALID_FORMAT/)).toBeInTheDocument()
  expect(
    screen.queryByText('Encrypted credential storage: Ready.'),
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Save credentials' }),
  ).toBeDisabled()
})

it('opens the saved LIVE account and distinguishes its connection from checkout availability', async () => {
  render(
    <AdminStripeSettings
      data={{
        encryptionReady: true,
        rows: [
          {
            environment: 'live',
            account_id: 'acct_fixture',
            account_name: 'Cottage Pantry',
            fingerprint: 'sha256:fixture',
            validated_at: '2026-11-14T08:00:00Z',
            checkout_enabled: false,
          },
        ],
      }}
      request={vi.fn()}
    />,
  )
  expect(screen.getByLabelText('Environment')).toHaveValue('live')
  expect(screen.getByLabelText('Stripe account connections')).toHaveTextContent(
    'LIVE Stripe: Connected',
  )
  expect(screen.getByLabelText('Stripe account connections')).toHaveTextContent(
    'TEST Stripe: No account connected',
  )
  expect(screen.getByText(/New checkout:/)).toHaveTextContent('Disabled')
  expect(screen.getByText(/LIVE account: Cottage Pantry/)).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByLabelText('Environment'), 'test')
  expect(screen.getByLabelText('Environment')).toHaveValue('test')
  expect(screen.getByLabelText('Stripe account connections')).toHaveTextContent(
    'LIVE Stripe: Connected',
  )
})

it('chooses LIVE when connection data arrives after the initial render and preserves an explicit environment selection', async () => {
  const request = vi.fn()
  const { rerender } = render(
    <AdminStripeSettings data={{}} request={request} />,
  )
  const data = {
    rows: [{ environment: 'live', fingerprint: 'sha256:fixture' }],
  }
  rerender(<AdminStripeSettings data={data} request={request} />)
  expect(screen.getByLabelText('Environment')).toHaveValue('live')
  expect(screen.getByLabelText('Stripe account connections')).toHaveTextContent(
    'Credentials saved. Test connection to verify.',
  )
  await userEvent.selectOptions(screen.getByLabelText('Environment'), 'test')
  rerender(<AdminStripeSettings data={{ ...data }} request={request} />)
  expect(screen.getByLabelText('Environment')).toHaveValue('test')
})

it('shows billing setup failures alongside the verified LIVE connection and retries in LIVE', async () => {
  const data = {
    encryptionReady: true,
    rows: [
      {
        environment: 'live',
        account_id: 'acct_fixture',
        validated_at: '2026-11-14T08:00:00Z',
        configuration: { setupError: 'BILLING_SETUP_INCOMPLETE' },
      },
    ],
    connectionErrors: { test: 'STRIPE_CONNECTION_UNAVAILABLE' },
  }
  const request = vi.fn().mockResolvedValue(data)
  render(<AdminStripeSettings data={data} request={request} />)
  expect(screen.getByLabelText('Stripe account connections')).toHaveTextContent(
    'LIVE Stripe: Connected',
  )
  expect(screen.getByLabelText('Stripe account connections')).toHaveTextContent(
    'TEST Stripe: Status unavailable.',
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Billing setup is incomplete',
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Set up LIVE billing' }),
  )
  expect(request).toHaveBeenCalledWith('action=stripe', {
    environment: 'live',
    operation: 'setup',
  })
})

it('never labels a failed or unverified LIVE connection as connected', () => {
  render(
    <AdminStripeSettings
      data={{
        rows: [
          {
            environment: 'live',
            account_id: 'acct_fixture',
            fingerprint: 'sha256:fixture',
            validated_at: '2026-11-14T08:00:00Z',
            configuration: { apiError: 'CONNECTION_TEST_FAILED' },
          },
        ],
      }}
      request={vi.fn()}
    />,
  )
  expect(screen.getByLabelText('Stripe account connections')).toHaveTextContent(
    'LIVE Stripe: Connection test failed',
  )
  expect(
    screen.getByLabelText('Stripe account connections'),
  ).not.toHaveTextContent('LIVE Stripe: Connected')
})

it('explains confirmation failures next to save and submits webhook-only updates', async () => {
  const data = {
    encryptionReady: true,
    rows: [{ environment: 'live', fingerprint: 'sha256:fixture' }],
  }
  const request = vi.fn().mockResolvedValue(data)
  const user = userEvent.setup()
  render(<AdminStripeSettings data={data} request={request} />)
  expect(
    screen.getByLabelText('Stripe connection instructions'),
  ).toHaveTextContent('step by step')
  const signing = screen.getByLabelText(
    'Webhook signing secret (optional for automatic setup)',
  )
  await user.type(signing, 'whsec_fixture')
  await user.click(screen.getByRole('button', { name: 'Save credentials' }))
  expect(request).not.toHaveBeenCalled()
  expect(
    screen.getByText(/Type SAVE LIVE in Action confirmation/),
  ).toBeInTheDocument()
  await user.type(screen.getByLabelText('Action confirmation'), 'SAVE LIVE')
  await user.click(screen.getByRole('button', { name: 'Save credentials' }))
  expect(request).toHaveBeenCalledWith('action=stripe', {
    environment: 'live',
    operation: 'save',
    key: '',
    signing: 'whsec_fixture',
    confirmation: 'SAVE LIVE',
  })
  await waitFor(() => expect(signing).toHaveValue(''))
  expect(
    screen.getByText(/Credentials saved securely for LIVE/),
  ).toBeInTheDocument()
})
