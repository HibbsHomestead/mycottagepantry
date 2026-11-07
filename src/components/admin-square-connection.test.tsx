import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AdminSquareConnection } from './admin-square-connection'
const data = {
  connection: [
    {
      environment: 'sandbox',
      missing: [],
      releaseApproved: true,
      deploymentAllowed: true,
    },
  ],
  checks: [],
  mappings: [],
  events: [],
  oauth: {
    connections: [],
    setup: [
      {
        environment: 'sandbox',
        missing: [],
        callbackUrl: 'https://preview.example.test/api/admin/square/callback',
        webhookUrl: 'https://preview.example.test/api/square/sandbox/webhook',
        events: ['subscription.updated'],
      },
    ],
    pending: { environment: 'sandbox', callbackReady: true },
  },
}
it('separates all seven readiness indicators and keeps checkout disabled after OAuth', async () => {
  const request = vi.fn(async () => ({
    ok: true,
    candidate: {
      merchantId: 'MERCHANT',
      merchantName: 'Revenue business',
      locations: [
        {
          id: 'LOC',
          name: 'Billing location',
          status: 'ACTIVE',
          currency: 'USD',
          capabilities: ['CREDIT_CARD_PROCESSING'],
        },
      ],
    },
  }))
  render(<AdminSquareConnection data={data} request={request} />)
  for (const title of [
    'Square account connected',
    'Required permissions verified',
    'Billing location selected',
    'Plan mappings ready',
    'Webhook processing verified',
    'Subscription synchronization ready',
    'Live checkout enabled',
  ])
    expect(screen.getByText(title)).toBeInTheDocument()
  expect(screen.getByText('Disabled')).toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Verify Square authorization' }),
  )
  await screen.findByText('Revenue business')
  expect(request).toHaveBeenCalledWith(
    'action=billing-oauth-complete&environment=sandbox',
    {},
  )
  const confirm = screen.getByRole('button', {
    name: 'Confirm account and billing location',
  })
  expect(confirm).toBeDisabled()
  fireEvent.change(screen.getByRole('combobox', { name: 'Billing location' }), {
    target: { value: 'LOC' },
  })
  expect(confirm).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  expect(confirm).toBeEnabled()
  expect(screen.getByText('Disabled')).toBeInTheDocument()
})
it('shows exact setup URLs and fixed failure messages without a purchase action', async () => {
  const request = vi.fn(async () => {
    throw new Error('Reconnect the platform billing account.')
  })
  render(<AdminSquareConnection data={data} request={request} />)
  expect(screen.getByText(data.oauth.setup[0].callbackUrl)).toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Verify billing configuration' }),
  )
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Reconnect the platform billing account.',
    ),
  )
  expect(
    screen.queryByRole('button', { name: /buy|subscribe|enable live/i }),
  ).not.toBeInTheDocument()
})
