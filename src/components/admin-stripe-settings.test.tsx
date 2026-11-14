import { expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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

it('allows setup with saved TEST credentials before a separate connection test', async () => {
  const data = {
    encryptionReady: true,
    rows: [
      {
        environment: 'test',
        fingerprint: 'sha256:fixture',
        validated_at: null,
      },
    ],
  }
  const request = vi.fn().mockResolvedValue(data)
  render(<AdminStripeSettings data={data} request={request} />)
  const setup = screen.getByRole('button', { name: 'Set up TEST billing' })
  expect(setup).toBeEnabled()
  expect(setup).toHaveAccessibleDescription(
    /separate connection test is not required/,
  )
  await userEvent.click(setup)
  expect(request).toHaveBeenCalledWith('action=stripe', {
    environment: 'test',
    operation: 'setup',
  })
})

it('saves entered TEST credentials with explicit confirmation before setup and clears them even if setup fails', async () => {
  const data = { encryptionReady: true, rows: [] }
  const saved = {
    encryptionReady: true,
    rows: [
      {
        environment: 'test',
        fingerprint: 'sha256:fixture',
        validated_at: null,
      },
    ],
  }
  const request = vi
    .fn()
    .mockResolvedValueOnce(saved)
    .mockRejectedValueOnce(
      new Error('The TEST webhook destination is missing.'),
    )
  const user = userEvent.setup()
  render(<AdminStripeSettings data={data} request={request} />)
  const setup = screen.getByRole('button', { name: 'Set up TEST billing' })
  expect(setup).toBeDisabled()
  expect(setup).toHaveAccessibleDescription(/Enter a TEST secret API key/)
  const key = screen.getByLabelText('Stripe secret API key')
  const signing = screen.getByLabelText(
    'Webhook signing secret (optional for automatic setup)',
  )
  await user.type(key, 'sk_test_ui_fixture')
  await user.type(signing, 'whsec_ui_fixture')
  expect(setup).toBeEnabled()
  await user.click(setup)
  expect(request).not.toHaveBeenCalled()
  expect(
    screen.getByText(/Your entered credentials must be saved first/),
  ).toHaveTextContent('SAVE TEST')
  await user.type(screen.getByLabelText('Action confirmation'), 'SAVE TEST')
  await user.click(setup)
  await waitFor(() =>
    expect(
      screen.getByText('The TEST webhook destination is missing.'),
    ).toBeInTheDocument(),
  )
  expect(request.mock.calls).toEqual([
    [
      'action=stripe',
      {
        environment: 'test',
        operation: 'save',
        key: 'sk_test_ui_fixture',
        signing: 'whsec_ui_fixture',
        confirmation: 'SAVE TEST',
      },
    ],
    ['action=stripe', { environment: 'test', operation: 'setup' }],
  ])
  expect(key).toHaveValue('')
  expect(signing).toHaveValue('')
  expect(setup).toBeEnabled()
  expect(setup).toHaveAccessibleDescription(/saved TEST credentials/)
})

it('explains encrypted storage gating without enabling setup', () => {
  render(
    <AdminStripeSettings
      data={{
        encryptionReady: false,
        rows: [{ environment: 'test', fingerprint: 'sha256:fixture' }],
      }}
      request={vi.fn()}
    />,
  )
  const setup = screen.getByRole('button', { name: 'Set up TEST billing' })
  expect(setup).toBeDisabled()
  expect(setup).toHaveAccessibleDescription(
    /blocked until encrypted storage is ready/,
  )
})

const activationData = {
  encryptionReady: true,
  rows: [
    {
      environment: 'test',
      fingerprint: 'sha256:fixture',
      validated_at: '2026-11-14T08:00:00Z',
      webhook_verified_at: '2026-11-14T08:01:00Z',
      checkout_enabled: false,
      configuration: {
        policy: { portal: 'bpc_testfixture' },
        mappings: {
          'cottage-kitchen': { price: 'price_fixture', purchase: true },
        },
      },
    },
  ],
}

it('activates TEST checkout using its nearby confirmation and saved policy without a live review', async () => {
  const enabled = {
    ...activationData,
    rows: [{ ...activationData.rows[0], checkout_enabled: true }],
  }
  const request = vi.fn().mockResolvedValue(enabled)
  const user = userEvent.setup()
  render(<AdminStripeSettings data={activationData} request={request} />)
  await user.click(screen.getByText('Required policies and activation review'))
  expect(
    screen.getByLabelText('Reviewed Stripe portal configuration ID'),
  ).toHaveValue('bpc_testfixture')
  expect(
    screen.queryByLabelText(
      'Existing subscriber review and activation decision',
    ),
  ).not.toBeInTheDocument()
  await user.type(
    screen.getByLabelText('Action confirmation'),
    'ENABLE TEST CHECKOUT',
  )
  await user.click(
    screen.getByRole('button', { name: 'Confirm checkout activation' }),
  )
  const section = screen.getByText(
    'Required policies and activation review',
  ).parentElement!
  expect(within(section).getByRole('alert')).toHaveTextContent(
    'in TEST checkout confirmation',
  )
  expect(request).not.toHaveBeenCalled()
  await user.type(
    screen.getByLabelText('TEST checkout confirmation'),
    ' ENABLE TEST CHECKOUT ',
  )
  await user.click(
    screen.getByRole('button', { name: 'Confirm checkout activation' }),
  )
  expect(request).toHaveBeenCalledExactlyOnceWith('action=stripe', {
    environment: 'test',
    operation: 'enable',
    confirmation: 'ENABLE TEST CHECKOUT',
  })
  await waitFor(() =>
    expect(screen.getByText(/New checkout:/)).toHaveTextContent('Enabled'),
  )
  expect(
    within(section).getByText(/TEST checkout is enabled/),
  ).toBeInTheDocument()
  expect(screen.getByLabelText('TEST checkout confirmation')).toHaveValue('')
})

it('keeps a portal ID separate from policy approval and rejects an approval phrase entered as the ID', async () => {
  const request = vi.fn().mockResolvedValue(activationData)
  const user = userEvent.setup()
  render(<AdminStripeSettings data={activationData} request={request} />)
  await user.click(screen.getByText('Required policies and activation review'))
  const portal = screen.getByLabelText(
    'Reviewed Stripe portal configuration ID',
  )
  await user.clear(portal)
  await user.type(portal, 'APPROVE POLICIES')
  await user.type(
    screen.getByLabelText('Policy approval confirmation'),
    'APPROVE POLICIES',
  )
  await user.click(screen.getByRole('button', { name: 'Approve policies' }))
  expect(screen.getByRole('alert')).toHaveTextContent(
    'configuration ID beginning with bpc_',
  )
  expect(request).not.toHaveBeenCalled()
  await user.clear(portal)
  await user.type(portal, 'bpc_testfixture')
  await user.click(screen.getByRole('button', { name: 'Approve policies' }))
  expect(request).toHaveBeenCalledExactlyOnceWith('action=stripe', {
    environment: 'test',
    operation: 'policy',
    portalConfiguration: 'bpc_testfixture',
    confirmation: 'APPROVE POLICIES',
  })
  await waitFor(() =>
    expect(screen.getByLabelText('Policy approval confirmation')).toHaveValue(
      '',
    ),
  )
  expect(screen.getByText(/Policies approved for TEST/)).toBeInTheDocument()
  expect(screen.getByText(/New checkout:/)).toHaveTextContent('Disabled')
})

it('shows server activation errors next to activation and retains confirmation for a retry', async () => {
  const request = vi
    .fn()
    .mockRejectedValue(
      new Error('Verified platform administrator access is required.'),
    )
  const user = userEvent.setup()
  render(<AdminStripeSettings data={activationData} request={request} />)
  await user.click(screen.getByText('Required policies and activation review'))
  await user.type(
    screen.getByLabelText('TEST checkout confirmation'),
    'ENABLE TEST CHECKOUT',
  )
  await user.click(
    screen.getByRole('button', { name: 'Confirm checkout activation' }),
  )
  const section = screen.getByText(
    'Required policies and activation review',
  ).parentElement!
  expect(await within(section).findByRole('alert')).toHaveTextContent(
    'administrator access is required',
  )
  expect(screen.getByText(/New checkout:/)).toHaveTextContent('Disabled')
  expect(screen.getByLabelText('TEST checkout confirmation')).toHaveValue(
    'ENABLE TEST CHECKOUT',
  )
})

it('clears confirmations and restores the correct saved portal when switching environments', async () => {
  const request = vi.fn()
  const data = {
    ...activationData,
    rows: [
      ...activationData.rows,
      {
        environment: 'live',
        configuration: { policy: { portal: 'bpc_livefixture' } },
      },
    ],
  }
  const user = userEvent.setup()
  render(<AdminStripeSettings data={data} request={request} />)
  await user.click(screen.getByText('Required policies and activation review'))
  await user.type(
    screen.getByLabelText('TEST checkout confirmation'),
    'ENABLE TEST CHECKOUT',
  )
  await user.type(
    screen.getByLabelText('Policy approval confirmation'),
    'APPROVE POLICIES',
  )
  await user.selectOptions(screen.getByLabelText('Environment'), 'live')
  expect(screen.getByLabelText('LIVE checkout confirmation')).toHaveValue('')
  expect(screen.getByLabelText('Policy approval confirmation')).toHaveValue('')
  expect(
    screen.getByLabelText('Reviewed Stripe portal configuration ID'),
  ).toHaveValue('bpc_livefixture')
  await user.type(
    screen.getByLabelText('Existing subscriber review and activation decision'),
    'ENABLE LIVE CHECKOUT',
  )
  await user.click(
    screen.getByRole('button', { name: 'Confirm checkout activation' }),
  )
  expect(request).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent(
    'in LIVE checkout confirmation',
  )
  await user.selectOptions(screen.getByLabelText('Environment'), 'test')
  expect(
    screen.getByLabelText('Reviewed Stripe portal configuration ID'),
  ).toHaveValue('bpc_testfixture')
  expect(screen.getByLabelText('TEST checkout confirmation')).toHaveValue('')
})
