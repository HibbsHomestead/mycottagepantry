import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AdminCodeSignIn, AdminMfaSettings } from './admin-mfa'
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,fixture') },
}))
it('offers enrolled code sign-in without WebAuthn, clears failed input and supports retry', async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error('Invalid or used code'))
    .mockResolvedValueOnce({ stage: 'authenticated' })
  const success = vi.fn()
  render(<AdminCodeSignIn request={request} onSuccess={success} />)
  fireEvent.change(screen.getByLabelText('Authenticator code'), {
    target: { value: '123456' },
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Verify authenticator code' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Invalid or used code',
  )
  expect(screen.getByLabelText('Authenticator code')).toHaveValue('')
  expect(
    screen.getByRole('button', { name: 'Verify authenticator code' }),
  ).toBeEnabled()
  expect(success).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Authenticator code'), {
    target: { value: '234567' },
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Verify authenticator code' }),
  )
  await waitFor(() => expect(success).toHaveBeenCalledOnce())
})
it('requires a recovery code submission and can switch back without retaining code text', async () => {
  const request = vi.fn().mockResolvedValue({ stage: 'authenticated' }),
    success = vi.fn()
  render(<AdminCodeSignIn request={request} onSuccess={success} />)
  fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }))
  fireEvent.change(screen.getByLabelText('Single-use recovery code'), {
    target: { value: 'fixture-recovery' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Use recovery code' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('action=totp-recover', {
      code: 'fixture-recovery',
    }),
  )
  await waitFor(() => expect(success).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: 'Use authenticator app' }))
  expect(screen.getByLabelText('Authenticator code')).toHaveValue('')
})
it('requests server-authorized inactive setup and confirms before showing recovery codes', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      stage: 'totp_setup',
      secret: 'FIXTURESETUP',
      uri: 'otpauth://totp/fixture',
    })
    .mockResolvedValueOnce({
      stage: 'recovery_codes',
      recoveryCodes: ['fixture-one-use-code'],
    })
  const changed = vi.fn()
  render(
    <AdminMfaSettings
      enabled={false}
      available
      request={request}
      onChange={changed}
    />,
  )
  fireEvent.click(screen.getByText('Admin sign-in security'))
  fireEvent.click(
    screen.getByRole('button', { name: 'Set up authenticator app' }),
  )
  expect(request).toHaveBeenNthCalledWith(1, 'action=totp-enroll', {})
  expect(await screen.findByText('FIXTURESETUP')).toBeInTheDocument()
  expect(changed).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('First authenticator code'), {
    target: { value: '123456' },
  })
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Confirm and enable authenticator codes',
    }),
  )
  expect(await screen.findByText('fixture-one-use-code')).toBeInTheDocument()
  expect(screen.queryByText('FIXTURESETUP')).not.toBeInTheDocument()
  expect(request).toHaveBeenLastCalledWith('action=totp-confirm', {
    code: '123456',
  })
  expect(changed).toHaveBeenCalledOnce()
  fireEvent.click(
    screen.getByRole('button', { name: 'I saved my recovery codes' }),
  )
  expect(screen.queryByText('fixture-one-use-code')).not.toBeInTheDocument()
})
it('clears setup secret and QR after canceling enrollment server-side', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      stage: 'totp_setup',
      secret: 'FIXTURESETUP',
      uri: 'otpauth://totp/fixture',
    })
    .mockResolvedValueOnce({ stage: 'totp_canceled' })
  render(
    <AdminMfaSettings
      enabled={false}
      available
      request={request}
      onChange={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByText('Admin sign-in security'))
  fireEvent.click(
    screen.getByRole('button', { name: 'Set up authenticator app' }),
  )
  await screen.findByText('FIXTURESETUP')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel setup' }))
  await waitFor(() =>
    expect(screen.queryByText('FIXTURESETUP')).not.toBeInTheDocument(),
  )
  expect(
    screen.queryByAltText('Authenticator enrollment QR code'),
  ).not.toBeInTheDocument()
  expect(request).toHaveBeenLastCalledWith('action=totp-cancel', {})
})
it('explains unavailable encryption configuration and prevents starting enrollment', () => {
  render(
    <AdminMfaSettings
      enabled={false}
      available={false}
      request={vi.fn()}
      onChange={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByText('Admin sign-in security'))
  expect(
    screen.getByRole('button', { name: 'Set up authenticator app' }),
  ).toBeDisabled()
  expect(
    screen.getByText(/until server encryption is configured/),
  ).toBeInTheDocument()
})
it('requests server-authorized authenticator removal', async () => {
  const request = vi.fn().mockResolvedValue({ stage: 'totp_removed' })
  render(
    <AdminMfaSettings enabled available request={request} onChange={vi.fn()} />,
  )
  fireEvent.click(screen.getByText('Admin sign-in security'))
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare authenticator removal' }),
  )
  expect(request).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Confirm authenticator removal' }),
  )
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Other administrator sessions were signed out.',
  )
  expect(request).toHaveBeenCalledWith('action=totp-remove', {})
})
