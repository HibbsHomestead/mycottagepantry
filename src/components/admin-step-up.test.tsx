import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { AdminStepUp } from './admin-step-up'

it('offers password confirmation for an account without an authenticator and clears rejected passwords', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ totpEnabled: false, totpAvailable: false })
    .mockRejectedValueOnce(new Error('Password verification failed.'))
  render(<AdminStepUp request={request} />)
  expect(request).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByText(
      'Verify existing admin authentication for sensitive actions',
    ),
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Check verification methods' }),
  )
  const password = await screen.findByLabelText(
    'Current administrator password',
  )
  expect(password).toHaveAttribute('type', 'password')
  fireEvent.change(password, { target: { value: 'fixture-wrong-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Verify password' }))
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Password verification failed.',
  )
  expect(password).toHaveValue('')
  expect(request).toHaveBeenLastCalledWith('action=password-verify', {
    password: 'fixture-wrong-password',
  })
  expect(screen.queryByText(/security.key|passkey/i)).not.toBeInTheDocument()
})

it('offers enrolled authenticator and recovery codes without a password fallback', async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ totpEnabled: true, totpAvailable: true })
  render(<AdminStepUp request={request} />)
  fireEvent.click(
    screen.getByText(
      'Verify existing admin authentication for sensitive actions',
    ),
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Check verification methods' }),
  )
  expect(await screen.findByLabelText('Authenticator code')).toBeVisible()
  expect(
    screen.queryByLabelText('Current administrator password'),
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }))
  expect(screen.getByLabelText('Single-use recovery code')).toBeVisible()
  expect(request).toHaveBeenCalledTimes(1)
})
