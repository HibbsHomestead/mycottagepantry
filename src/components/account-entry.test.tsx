import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const sdk = vi.hoisted(() => ({
  handleAuthCallback: vi.fn(),
  getUser: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  updateUser: vi.fn(),
  requestPasswordRecovery: vi.fn(),
}))
vi.mock('@netlify/identity', () => sdk)
vi.mock('./public-site', () => ({
  PublicSite: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}))
import { LoginPage } from './login-page'
import { SignupPage } from './signup-page'
import { OnboardingPage } from './onboarding-page'
import { VerificationPage } from './verification-page'
import { accountNavigation } from '@/lib/account-access-client'
import { accessFixture } from '../../tests/account-access-fixture'
const transport = vi.fn()
const selection = vi.hoisted(() => ({ resume: vi.fn() }))
vi.mock('@/lib/signup-plan-client', () => ({
  resumeSelectedPlan: selection.resume,
}))
beforeEach(() => {
  history.replaceState({}, '', '/login')
  vi.stubGlobal('fetch', transport)
  transport.mockReset()
  selection.resume.mockReset().mockResolvedValue(null)
  sdk.handleAuthCallback.mockReset()
  sdk.handleAuthCallback.mockResolvedValue(null)
  sdk.getUser.mockReset()
  sdk.getUser.mockResolvedValue(null)
  sdk.login.mockReset()
  sdk.login.mockResolvedValue({ id: 'synthetic-provider-user' })
  sdk.logout.mockReset()
  sdk.logout.mockResolvedValue(undefined)
  sdk.updateUser.mockReset().mockResolvedValue({})
  sdk.requestPasswordRecovery.mockReset().mockResolvedValue(undefined)
  vi.spyOn(accountNavigation, 'replace').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('waits for slow initialization without showing onboarding or permitting a competing login', async () => {
  let complete!: (value: null) => void
  sdk.handleAuthCallback.mockReturnValue(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  render(<LoginPage />)
  expect(
    screen.getByRole('button', { name: 'Checking session…' }),
  ).toBeDisabled()
  expect(transport).not.toHaveBeenCalled()
  complete(null)
  transport.mockResolvedValue(Response.json(accessFixture('signed_out')))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled(),
  )
  expect(accountNavigation.replace).not.toHaveBeenCalled()
})
it('shows no session failure for an ordinary signed-out login visit', async () => {
  transport.mockResolvedValue(Response.json(accessFixture('signed_out')))
  render(<LoginPage />)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled(),
  )
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(sdk.login).not.toHaveBeenCalled()
})
it('shows a session failure only after provider success disagrees with the backend', async () => {
  transport.mockImplementation(async () =>
    Response.json(accessFixture('signed_out')),
  )
  render(<LoginPage />)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled(),
  )
  await userEvent.type(
    screen.getByLabelText('Email'),
    'synthetic@example.invalid',
  )
  await userEvent.type(
    screen.getByLabelText('Password'),
    'synthetic-test-input',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'server could not verify it',
  )
  expect(accountNavigation.replace).not.toHaveBeenCalled()
  expect(
    screen.getByRole('button', { name: 'Retry oven access' }),
  ).toBeEnabled()
})
it('opens the existing business after password sign-in without resuming a plan from the URL', async () => {
  history.replaceState(
    {},
    '',
    '/login?returnTo=%2Fworkspace%23Pantry&plan=cottage-kitchen',
  )
  transport
    .mockResolvedValueOnce(Response.json(accessFixture('signed_out')))
    .mockResolvedValueOnce(Response.json(accessFixture('workspace')))
  selection.resume.mockResolvedValue({ planId: 'cottage-kitchen' })
  render(<LoginPage />)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled(),
  )
  await userEvent.type(
    screen.getByLabelText('Email'),
    'synthetic@example.invalid',
  )
  await userEvent.type(
    screen.getByLabelText('Password'),
    'synthetic-test-input',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
  await waitFor(() => expect(accountNavigation.replace).toHaveBeenCalled())
  const destination = vi.mocked(accountNavigation.replace).mock.calls[0][0]
  expect(destination).toMatch(/^\/oven\?accessTrace=[a-f0-9-]+#Pantry$/)
  expect(selection.resume).not.toHaveBeenCalled()
  const logs = JSON.stringify(vi.mocked(console.info).mock.calls)
  expect(logs).toContain('login_started')
  expect(logs).toContain('provider_result')
  expect(logs).toContain('ignored_for_existing_membership')
  expect(logs).not.toContain('synthetic-test-input')
  expect(logs).not.toContain('synthetic@example.invalid')
})
it('keeps invalid credentials on login and does not look up a new oven', async () => {
  transport.mockResolvedValue(Response.json(accessFixture('signed_out')))
  sdk.login.mockRejectedValue(
    Object.assign(new Error('private provider error'), { status: 400 }),
  )
  render(<LoginPage />)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled(),
  )
  await userEvent.type(
    screen.getByLabelText('Email'),
    'synthetic@example.invalid',
  )
  await userEvent.type(
    screen.getByLabelText('Password'),
    'synthetic-test-input',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'couldn’t sign you in',
  )
  expect(transport).toHaveBeenCalledTimes(1)
  expect(accountNavigation.replace).not.toHaveBeenCalled()
})
it('shows a retryable membership failure without redirecting or treating it as no membership', async () => {
  transport.mockResolvedValue(Response.json(accessFixture('membership_error')))
  render(<LoginPage />)
  expect(
    await screen.findByRole('button', { name: 'Retry oven access' }),
  ).toBeInTheDocument()
  expect(accountNavigation.replace).not.toHaveBeenCalled()
})
it('does not leave a verified existing member on signup', async () => {
  history.replaceState({}, '', '/signup')
  transport.mockResolvedValue(Response.json(accessFixture('workspace')))
  render(<SignupPage />)
  await waitFor(() =>
    expect(accountNavigation.replace).toHaveBeenCalledWith(
      expect.stringMatching(/^\/oven\?/),
    ),
  )
  expect(screen.queryByText('Join the beta.')).not.toBeInTheDocument()
})
it.each(['', '?plan=retired-plan', '?plan=cottage-kitchen'])(
  'opens an authorized existing business despite an unavailable saved preference and URL %s',
  async (search) => {
    history.replaceState({}, '', '/login' + search)
    transport.mockResolvedValue(Response.json(accessFixture('workspace')))
    selection.resume.mockRejectedValue(
      new Error(
        'Your saved plan choice is unavailable or expired. Choose your intended plan again.',
      ),
    )
    render(<LoginPage />)
    await waitFor(() =>
      expect(accountNavigation.replace).toHaveBeenCalledWith(
        expect.stringMatching(/^\/oven\?accessTrace=[a-f0-9-]+$/),
      ),
    )
    expect(selection.resume).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Choose your intended plan again'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'Open your existing business with its current access',
      }),
    ).toHaveClass('public-button')
  },
)
it('does not wait for an unavailable plan service before opening an existing business', async () => {
  transport.mockResolvedValue(Response.json(accessFixture('workspace')))
  selection.resume.mockReturnValue(new Promise(() => {}))
  render(<LoginPage />)
  await waitFor(() => expect(accountNavigation.replace).toHaveBeenCalled())
  expect(selection.resume).not.toHaveBeenCalled()
})
it('preserves an intentional billing return without making billing a login prerequisite', async () => {
  history.replaceState(
    {},
    '',
    '/login?returnTo=%2Foven%2Fbilling&plan=retired-plan',
  )
  transport.mockResolvedValue(Response.json(accessFixture('workspace')))
  render(<LoginPage />)
  await waitFor(() =>
    expect(accountNavigation.replace).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/oven\/billing\?accessTrace=[a-f0-9-]+&returnTo=%2Foven%2Fbilling$/,
      ),
    ),
  )
  expect(selection.resume).not.toHaveBeenCalled()
})
it.each(['signup', 'onboarding', 'verify-email'])(
  'recovers an existing member from %s with an invalid URL plan and expired saved preference',
  async (page) => {
    history.replaceState({}, '', '/' + page + '?plan=retired-plan')
    transport.mockResolvedValue(Response.json(accessFixture('workspace')))
    selection.resume.mockRejectedValue(new Error('PLAN_SELECTION_EXPIRED'))
    render(
      page === 'signup' ? (
        <SignupPage />
      ) : page === 'onboarding' ? (
        <OnboardingPage />
      ) : (
        <VerificationPage />
      ),
    )
    await waitFor(() =>
      expect(accountNavigation.replace).toHaveBeenCalledWith(
        expect.stringMatching(/^\/oven\?accessTrace=[a-f0-9-]+$/),
      ),
    )
    expect(selection.resume).not.toHaveBeenCalled()
  },
)
it('sends multiple verified memberships to business selection without resolving a plan', async () => {
  transport.mockResolvedValue(
    Response.json(accessFixture('workspace_selection')),
  )
  selection.resume.mockRejectedValue(new Error('PLAN_SELECTION_EXPIRED'))
  render(<LoginPage />)
  await waitFor(() =>
    expect(accountNavigation.replace).toHaveBeenCalledWith(
      expect.stringMatching(/^\/oven\?accessTrace=[a-f0-9-]+$/),
    ),
  )
  expect(selection.resume).not.toHaveBeenCalled()
})
it('still resolves preferences for verified new accounts and reports failures without creating a business', async () => {
  transport.mockResolvedValue(Response.json(accessFixture('no_workspace')))
  selection.resume.mockRejectedValue(
    new Error('Your saved plan choice is unavailable or expired.'),
  )
  render(<LoginPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'saved plan choice is unavailable or expired',
  )
  expect(selection.resume).toHaveBeenCalledOnce()
  expect(accountNavigation.replace).not.toHaveBeenCalled()
  expect(
    screen.queryByRole('link', {
      name: 'Open your existing business with its current access',
    }),
  ).not.toBeInTheDocument()
})
it('preserves the resolved plan for a verified account that still needs business setup', async () => {
  history.replaceState({}, '', '/login?plan=cottage-kitchen')
  transport.mockResolvedValue(Response.json(accessFixture('no_workspace')))
  selection.resume.mockResolvedValue({ planId: 'cottage-kitchen' })
  render(<LoginPage />)
  await waitFor(() =>
    expect(accountNavigation.replace).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/onboarding\?accessTrace=[a-f0-9-]+&plan=cottage-kitchen$/,
      ),
    ),
  )
  expect(selection.resume).toHaveBeenCalledOnce()
})
it('does not classify membership loading as new registration on onboarding', async () => {
  history.replaceState({}, '', '/onboarding')
  transport.mockReturnValue(new Promise(() => {}))
  render(<OnboardingPage />)
  expect(
    screen.getByRole('heading', { name: 'Checking account access…' }),
  ).toBeInTheDocument()
  expect(
    screen.queryByLabelText('Business/display name'),
  ).not.toBeInTheDocument()
})
it('offers free setup to a verified no-workspace account without fabricated policy acceptance', async () => {
  history.replaceState({}, '', '/onboarding')
  transport.mockImplementation(async (url: string) =>
    Response.json(
      url.includes('view=policies')
        ? { policy: null }
        : accessFixture('no_workspace'),
    ),
  )
  render(<OnboardingPage />)
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Create your business' }),
    ).toBeEnabled(),
  )
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Business/display name')).toBeInTheDocument()
  expect(accountNavigation.replace).not.toHaveBeenCalled()
})
it('makes unverified email a stable state with recheck and explicit sign-out, not a login loop', async () => {
  history.replaceState({}, '', '/verify-email')
  transport.mockResolvedValue(Response.json(accessFixture('email_unverified')))
  render(<VerificationPage />)
  expect(
    await screen.findByRole('button', { name: 'Check account status' }),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Return to login' }),
  ).not.toBeInTheDocument()
  expect(accountNavigation.replace).not.toHaveBeenCalled()
})

it('requests a recovery email from the public recovery page without workspace creation', async () => {
  history.replaceState(null, '', '/recover')
  render(<VerificationPage recovery />)
  await userEvent.type(
    screen.getByLabelText('Email address'),
    'Owner@example.invalid',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
  expect(await screen.findByRole('status')).toHaveTextContent(
    'If this address has an account',
  )
  expect(sdk.requestPasswordRecovery).toHaveBeenCalledWith(
    'owner@example.invalid',
  )
  expect(transport).not.toHaveBeenCalled()
  expect(accountNavigation.replace).not.toHaveBeenCalled()
})

it('shows a recovery service failure without claiming an email was sent', async () => {
  sdk.requestPasswordRecovery.mockRejectedValue(
    new Error('PRIVATE_PROVIDER_ERROR'),
  )
  render(<VerificationPage recovery />)
  await userEvent.type(
    screen.getByLabelText('Email address'),
    'owner@example.invalid',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'could not be requested',
  )
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('redeems recovery once and offers admin sign in after a main-site reset without opening an Oven', async () => {
  history.replaceState(null, '', '/login#recovery_token=synthetic-fixture')
  sdk.handleAuthCallback.mockResolvedValue({ type: 'recovery' })
  render(
    <StrictMode>
      <LoginPage />
    </StrictMode>,
  )
  const password = await screen.findByLabelText('New password')
  await userEvent.type(password, 'synthetic-new-password')
  await userEvent.click(
    screen.getByRole('button', { name: 'Save new password' }),
  )
  expect(
    await screen.findByRole('link', {
      name: 'Sign in to Cottage Pantry Admin',
    }),
  ).toHaveAttribute('href', 'https://admin.mycottagepantry.com/admin')
  expect(sdk.handleAuthCallback).toHaveBeenCalledTimes(1)
  expect(sdk.logout).toHaveBeenCalledTimes(1)
  expect(sdk.updateUser).toHaveBeenCalledWith({
    password: 'synthetic-new-password',
  })
  expect(screen.getByLabelText('Password')).toHaveValue('')
  expect(transport).not.toHaveBeenCalled()
  expect(accountNavigation.replace).not.toHaveBeenCalled()
})
