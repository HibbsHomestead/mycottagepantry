import { fireEvent, render, screen } from '@testing-library/react'
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
    await screen.findByRole('button', { name: 'Prepare passkey verification' }),
  )
  expect(request).toHaveBeenNthCalledWith(1, 'action=session')
  expect(request).toHaveBeenNthCalledWith(2, 'action=mfa-options', {
    kind: 'authentication',
    method: 'device',
  })
  expect(startAuthentication).not.toHaveBeenCalled()
  expect(
    await screen.findByRole('button', { name: 'Verify with enrolled passkey' }),
  ).toBeEnabled()
})
