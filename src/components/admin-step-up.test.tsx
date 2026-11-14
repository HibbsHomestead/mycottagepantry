import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AdminStepUp } from './admin-step-up'
import { startAuthentication } from '@simplewebauthn/browser'
vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: vi.fn() }))
it('reuses enrolled methods without automatically opening a passkey or enrolling a new factor', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      credentials: [{ id: 'fixture' }],
      totpEnabled: false,
      smsEnabled: false,
    })
    .mockResolvedValueOnce({
      options: { challenge: 'fixture' },
      expiresAt: new Date(Date.now() + 120000).toISOString(),
    })
  render(<AdminStepUp request={request} />)
  expect(request).not.toHaveBeenCalled()
  expect(startAuthentication).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByText(
      'Verify existing admin authentication for sensitive actions',
    ),
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Check enrolled verification methods' }),
  )
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Prepare phone passkey verification',
    }),
  )
  expect(request).toHaveBeenNthCalledWith(1, 'action=session')
  expect(request).toHaveBeenNthCalledWith(2, 'action=mfa-options', {
    kind: 'authentication',
    method: 'phone',
  })
  expect(startAuthentication).not.toHaveBeenCalled()
  expect(
    await screen.findByRole('button', {
      name: 'Use existing phone or tablet passkey',
    }),
  ).toBeEnabled()
})

it('keeps enrolled code methods usable after the phone passkey chooser is cancelled', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      credentials: [{ id: 'fixture' }],
      totpEnabled: true,
      totpAvailable: true,
      smsEnabled: false,
    })
    .mockResolvedValueOnce({
      options: { challenge: 'fixture' },
      expiresAt: new Date(Date.now() + 120000).toISOString(),
    })
  vi.mocked(startAuthentication).mockRejectedValueOnce(
    new Error('Passkey chooser cancelled'),
  )
  render(<AdminStepUp request={request} />)
  fireEvent.click(
    screen.getByText(
      'Verify existing admin authentication for sensitive actions',
    ),
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Check enrolled verification methods' }),
  )
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Prepare phone passkey verification',
    }),
  )
  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: 'Use existing phone or tablet passkey',
      }),
    ).toBeEnabled(),
  )
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Use existing phone or tablet passkey',
    }),
  )
  expect(await screen.findByRole('status')).toHaveTextContent(
    'No verification completed',
  )
  expect(
    screen.getByRole('button', { name: 'Verify authenticator code' }),
  ).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }))
  expect(screen.getByLabelText('Single-use recovery code')).toBeEnabled()
  expect(request).toHaveBeenCalledTimes(2)
})
