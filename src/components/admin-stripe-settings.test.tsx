import { expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminStripeSettings } from './admin-stripe-settings'

vi.mock('./admin-step-up', () => ({ AdminStepUp: () => null }))

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
