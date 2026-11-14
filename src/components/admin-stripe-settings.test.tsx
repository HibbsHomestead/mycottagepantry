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
    screen.getByRole('button', { name: 'Refresh storage status' }),
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
