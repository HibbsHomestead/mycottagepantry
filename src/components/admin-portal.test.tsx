import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
const sdk = vi.hoisted(() => ({
  handleAuthCallback: vi.fn(),
  updateUser: vi.fn(),
  logout: vi.fn(),
}))
vi.mock('@netlify/identity', () => sdk)
const runtime = vi.hoisted(() => ({
  search: '?section=overview',
  authenticated: false,
  pendingStage: '',
  loginError: '',
  denied: false,
  calls: [] as string[],
}))
vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => ({ searchStr: runtime.search }),
}))
vi.mock('./label-studio', () => ({
  LabelCanvas: () => <svg aria-label="Stock label preview" />,
}))
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startAuthentication: vi.fn(async () => ({ id: 'test-assertion' })),
  startRegistration: vi.fn(async () => ({ id: 'test-enrollment' })),
}))
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { AdminPortal } from './admin-portal'
beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/admin')
  sdk.handleAuthCallback.mockReset().mockResolvedValue({ type: 'recovery' })
  sdk.updateUser.mockReset().mockResolvedValue({})
  sdk.logout.mockReset().mockResolvedValue(undefined)
  vi.mocked(startRegistration)
    .mockReset()
    .mockResolvedValue({ id: 'test-enrollment' } as never)
  vi.mocked(startAuthentication)
    .mockReset()
    .mockResolvedValue({ id: 'test-assertion' } as never)
  Object.assign(runtime, {
    search: '?section=overview',
    authenticated: false,
    pendingStage: '',
    loginError: '',
    denied: false,
    calls: [],
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      runtime.calls.push(url)
      if (url.includes('action=session'))
        return Response.json(
          runtime.authenticated
            ? {
                stage: 'authenticated',
                identityId: 'fixture-platform-admin',
                role: 'owner',
                expiresAt: '2026-12-01T00:00:00Z',
              }
            : runtime.pendingStage
              ? { stage: runtime.pendingStage }
              : { error: 'Sign in required' },
          { status: runtime.authenticated || runtime.pendingStage ? 200 : 401 },
        )
      if (url.includes('action=login')) {
        if (runtime.loginError)
          return Response.json({ error: runtime.loginError }, { status: 401 })
        runtime.authenticated = true
        return Response.json({ stage: 'authenticated' })
      }
      if (url.includes('action=password-recovery'))
        return Response.json({
          message:
            'If this address has an account, a password reset link has been sent.',
        })
      if (url.includes('action=logout')) {
        runtime.authenticated = false
        return Response.json({ stage: 'signed_out' })
      }
      if (url.includes('section=content'))
        return Response.json({
          note: 'Source catalogue only. Publishing is unavailable.',
        })
      if (url.includes('section=customers'))
        return Response.json({ rows: [], total: 0, page: 1, pageSize: 25 })
      if (runtime.denied)
        return Response.json({ error: 'Session revoked' }, { status: 401 })
      if (options?.method === 'POST') throw new Error('Unexpected mutation')
      return Response.json({
        totals: { customer_accounts: 12, ovens: 14, recent_accounts: 3 },
        definitions: {
          customer_accounts: 'Persisted owner/member identities.',
          ovens: 'Owned customer Ovens.',
          recent_accounts: 'First recorded in the last 30 days.',
          failed_jobs: 'No complete job registry exists.',
          subscriptions: 'Recorded states only.',
        },
        subscriptions: [],
        recent: [],
        activity: [],
        asOf: '2026-11-03T00:00:00Z',
      })
    }),
  )
})
it('renders the separate administration brand and never loads customer data while signed out', async () => {
  render(<AdminPortal />)
  expect(
    await screen.findByRole('button', { name: /^Sign in$/ }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { name: 'Cottage Pantry Admin' }),
  ).toBeInTheDocument()
  expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
  expect(runtime.calls.every((c) => c.includes('action=session'))).toBe(true)
  expect(screen.queryByText('Customer accounts')).not.toBeInTheDocument()
})
it('shows real metric definitions and unavailable monitoring without inventing revenue or trends', async () => {
  runtime.authenticated = true
  render(<AdminPortal />)
  expect(await screen.findByText('Customer accounts')).toBeInTheDocument()
  expect(screen.getByText('12')).toBeInTheDocument()
  expect(screen.getByText('Unavailable')).toBeInTheDocument()
  expect(screen.getByText(/Snapshot as of/)).toHaveTextContent(
    'No historical trend is inferred',
  )
  expect(screen.queryByText(/collected revenue/i)).not.toBeInTheDocument()
  expect(document.title).toBe('Overview | Cottage Pantry Admin')
  expect(screen.getByRole('link', { name: 'Customers' })).toHaveAttribute(
    'href',
    '/admin?section=customers',
  )
})
it('preserves customer deep links and renders an honestly empty paginated directory', async () => {
  runtime.authenticated = true
  runtime.search = '?section=customers&kind=accounts&q=stable-id&page=1'
  render(<AdminPortal />)
  expect(
    await screen.findByRole('textbox', { name: 'Search accounts' }),
  ).toHaveValue('stable-id')
  expect(screen.getByText('No records match this view.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Accounts' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  expect(runtime.calls).toContain(
    '/api/admin?section=customers&q=stable-id&page=1&kind=accounts',
  )
})
it('clears the customer view when the server rejects the session', async () => {
  runtime.authenticated = true
  runtime.denied = true
  render(<AdminPortal />)
  expect(await screen.findByText('Session revoked')).toBeInTheDocument()
  expect(screen.queryByText('Customer accounts')).not.toBeInTheDocument()
})
it('previews the existing stock templates without offering write or publish controls', async () => {
  runtime.authenticated = true
  runtime.search = '?section=content'
  render(<AdminPortal />)
  expect(await screen.findByText('System label templates')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: /Homestead bold/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: /The artisan loaf/ }))
  expect(
    screen.getByRole('button', { name: /The artisan loaf/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(
    screen.queryByRole('button', { name: /Publish/ }),
  ).not.toBeInTheDocument()
})

it('requests recovery with email only and returns to secure sign in', async () => {
  render(<AdminPortal />)
  fireEvent.click(await screen.findByRole('button', { name: 'Reset password' }))
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'owner@example.org' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
  expect(await screen.findByRole('status')).toHaveTextContent(
    'If this address has an account',
  )
  expect(fetch).toHaveBeenCalledWith(
    '/api/admin?action=password-recovery',
    expect.objectContaining({
      body: JSON.stringify({ email: 'owner@example.org' }),
    }),
  )
  expect(runtime.calls.every((c) => c.includes('action='))).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))
  expect(screen.getByLabelText('Password')).toHaveValue('')
  expect(screen.getByLabelText('Email address')).toHaveValue(
    'owner@example.org',
  )
})

it('completes an emailed recovery link before checking admin access and returns to password sign in', async () => {
  history.replaceState(null, '', '/admin#recovery_token=synthetic-fixture')
  render(<AdminPortal />)
  await screen.findByLabelText('New password')
  expect(runtime.calls).toEqual([])
  expect(window.location.hash).toBe('')
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'synthetic-new-password' },
  })
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: 'synthetic-new-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
  expect(
    await screen.findByRole('button', { name: /^Sign in$/ }),
  ).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Your password has been updated',
  )
  expect(sdk.logout).toHaveBeenCalledTimes(1)
  expect(runtime.calls.every((call) => call.includes('action=session'))).toBe(
    true,
  )
  expect(screen.queryByText('Customer accounts')).not.toBeInTheDocument()
})

it('offers a fresh recovery request when an emailed link has expired', async () => {
  history.replaceState(null, '', '/admin#recovery_token=expired-fixture')
  sdk.handleAuthCallback.mockRejectedValue(new Error('PRIVATE_PROVIDER_ERROR'))
  render(<AdminPortal />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'invalid, expired, or already used',
  )
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  expect(window.location.hash).toBe('')
  fireEvent.click(
    screen.getByRole('button', { name: 'Request a new reset link' }),
  )
  expect(
    await screen.findByRole('button', { name: 'Send reset link' }),
  ).toBeInTheDocument()
  expect(sdk.updateUser).not.toHaveBeenCalled()
})

it('redeems recovery once during effect replay and preserves the form after validation or provider failure', async () => {
  history.replaceState(null, '', '/admin#recovery_token=synthetic-fixture')
  render(
    <StrictMode>
      <AdminPortal />
    </StrictMode>,
  )
  await screen.findByLabelText('New password')
  expect(sdk.handleAuthCallback).toHaveBeenCalledTimes(1)
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'synthetic-new-password' },
  })
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: 'synthetic-different-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
  expect(screen.getByRole('alert')).toHaveTextContent('passwords do not match')
  expect(sdk.updateUser).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: 'synthetic-new-password' },
  })
  sdk.updateUser.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_ERROR'))
  fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'could not be updated',
  )
  expect(screen.getByLabelText('New password')).toHaveValue(
    'synthetic-new-password',
  )
  expect(screen.queryByText('Customer accounts')).not.toBeInTheDocument()
  expect(sdk.logout).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
  expect(
    await screen.findByRole('button', { name: /^Sign in$/ }),
  ).toBeInTheDocument()
})

async function submitPassword() {
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: 'owner@example.invalid' },
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'fixture-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: /^Sign in$/ }))
}

it('opens the dashboard with email and password without invoking any second factor', async () => {
  // A browser without WebAuthn support follows the same password-only path.
  vi.stubGlobal('PublicKeyCredential', undefined)
  render(<AdminPortal />)
  await screen.findByRole('button', { name: /^Sign in$/ })
  await submitPassword()
  expect(await screen.findByText('Customer accounts')).toBeVisible()
  expect(fetch).toHaveBeenCalledWith(
    '/api/admin?action=login',
    expect.objectContaining({
      body: JSON.stringify({
        email: 'owner@example.invalid',
        password: 'fixture-password',
      }),
    }),
  )
  expect(startAuthentication).not.toHaveBeenCalled()
  expect(startRegistration).not.toHaveBeenCalled()
  expect(runtime.calls.some((call) => /mfa-|totp-|sms-/.test(call))).toBe(false)
  expect(screen.queryByText('Admin sign-in security')).not.toBeInTheDocument()
  expect(screen.queryByText('Text-message sign-in')).not.toBeInTheDocument()
})

it('keeps failed password sign-in on the form and permits retry', async () => {
  runtime.loginError =
    'Sign-in failed. Check your email, password, and administrator access.'
  render(<AdminPortal />)
  await screen.findByRole('button', { name: /^Sign in$/ })
  await submitPassword()
  expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in failed')
  expect(screen.getByLabelText('Password')).toHaveValue('')
  expect(screen.queryByText('Customer accounts')).not.toBeInTheDocument()
  runtime.loginError = ''
  await submitPassword()
  expect(await screen.findByText('Customer accounts')).toBeVisible()
})

it.each(['mfa_required', 'enrollment_required'])(
  'returns a legacy %s session to password sign-in without opening a key prompt',
  async (stage) => {
    runtime.pendingStage = stage
    render(<AdminPortal />)
    await screen.findByRole('button', { name: /^Sign in$/ })
    expect(screen.queryByText(/enrollment is closed/)).not.toBeInTheDocument()
    await submitPassword()
    expect(await screen.findByText('Customer accounts')).toBeVisible()
    expect(startAuthentication).not.toHaveBeenCalled()
    expect(startRegistration).not.toHaveBeenCalled()
  },
)

it('signs out, clears dashboard data and returns to password sign-in', async () => {
  runtime.authenticated = true
  render(<AdminPortal />)
  await screen.findByText('Customer accounts')
  fireEvent.click(screen.getByRole('button', { name: /^Sign out$/ }))
  expect(await screen.findByRole('button', { name: /^Sign in$/ })).toBeVisible()
  expect(screen.queryByText('Customer accounts')).not.toBeInTheDocument()
  expect(runtime.authenticated).toBe(false)
})
