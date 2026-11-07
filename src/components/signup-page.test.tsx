import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
const auth = vi.hoisted(() => ({ signup: vi.fn() }))
const plans = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/signup-plan-client', () => ({
  signupPlanRequest: plans.request,
}))
vi.mock('@/lib/account-access-client', () => ({
  useAccountAccess: () => ({
    loading: false,
    error: false,
    access: { status: 'signed_out' },
    traceId: '',
    retry: vi.fn(),
  }),
}))
vi.mock('@netlify/identity', () => auth)
vi.mock('@/lib/session.functions', () => ({
  getSessionStatus: vi.fn().mockResolvedValue({ signedIn: false }),
}))
import { SignupPage } from './signup-page'
beforeEach(() => {
  auth.signup.mockReset()
  plans.request
    .mockReset()
    .mockResolvedValue({ intentId: '00000000-0000-4000-8000-000000000001' })
  history.replaceState({}, '', '/signup')
})
it('offers registration with clear availability without checkout or fake policy acceptance', () => {
  render(<SignupPage />)
  expect(
    screen.getByRole('heading', { name: 'Get Started' }),
  ).toBeInTheDocument()
  expect(screen.getByLabelText('Email')).toBeInTheDocument()
  expect(screen.getByLabelText('Password')).toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /pay|subscribe|checkout/i }),
  ).not.toBeInTheDocument()
  expect(auth.signup).not.toHaveBeenCalled()
})
it('requests provider signup and waits for verification without claiming delivery', async () => {
  auth.signup.mockResolvedValue({ id: 'new-account' })
  render(<SignupPage />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), 'new@example.invalid')
  await user.type(screen.getByLabelText('Password'), 'synthetic-password')
  await user.click(screen.getByRole('button', { name: 'Get Started' }))
  await waitFor(() =>
    expect(auth.signup).toHaveBeenCalledWith(
      'new@example.invalid',
      'synthetic-password',
      { cottage_signup_intent: '00000000-0000-4000-8000-000000000001' },
    ),
  )
  expect(
    await screen.findByRole('heading', { name: 'Check your email' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Delivery has not been independently confirmed',
  )
})
it('directs an existing account to login without showing raw provider errors', async () => {
  auth.signup.mockRejectedValue(
    Object.assign(new Error('private provider details'), { status: 422 }),
  )
  render(<SignupPage />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), 'existing@example.invalid')
  await user.type(screen.getByLabelText('Password'), 'synthetic-password')
  await user.click(screen.getByRole('button', { name: 'Get Started' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'already have an account, log in',
  )
  expect(screen.getByRole('alert')).not.toHaveTextContent(
    'private provider details',
  )
  expect(
    screen.getByRole('link', { name: 'Already have an account? Log in.' }),
  ).toHaveAttribute('href', '/login?plan=free')
})
it('preserves a paid plan choice while ignoring browser prices', async () => {
  history.replaceState({}, '', '/signup?plan=mixing-bowl&price=1')
  render(<SignupPage />)
  expect(
    screen.getByRole('radio', { name: /Mixing Bowl — \$10 USD/ }),
  ).toBeChecked()
  expect(screen.getByRole('radio', { name: /Baker’s Bench/ })).toBeEnabled()
  expect(screen.getByRole('radio', { name: /Cottage Kitchen/ })).toBeEnabled()
  expect(
    screen.queryByRole('radio', { name: /Cottage Mercantile/ }),
  ).toBeEnabled()
  expect(
    screen.getByText(/Creating an account does not activate a paid plan/),
  ).toBeInTheDocument()
  auth.signup.mockResolvedValue({ id: 'new' })
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), 'selected@example.invalid')
  await user.type(screen.getByLabelText('Password'), 'synthetic-password')
  await user.click(screen.getByRole('button', { name: 'Get Started' }))
  expect(plans.request).toHaveBeenCalledWith({
    action: 'prepare',
    planId: 'mixing-bowl',
  })
  expect(
    await screen.findByRole('link', { name: 'Continue to login' }),
  ).toHaveAttribute('href', '/login?plan=mixing-bowl')
})
it('keeps the approved $40 plan selected and offers sign-in continuation', () => {
  history.replaceState({}, '', '/signup?plan=cottage-mercantile')
  render(<SignupPage />)
  expect(
    screen.getByRole('radio', { name: /Cottage Mercantile/ }),
  ).toBeChecked()
  expect(
    screen.getByRole('link', { name: 'Already have an account? Log in.' }),
  ).toHaveAttribute('href', '/login?plan=cottage-mercantile')
})
it('does not substitute Free for an invalid plan or create an account if saving the preference fails', async () => {
  history.replaceState({}, '', '/signup?plan=unknown')
  const view = render(<SignupPage />)
  expect(screen.getByRole('button', { name: 'Get Started' })).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent(
    'No different plan was selected',
  )
  view.unmount()
  history.replaceState({}, '', '/signup?plan=bakers-bench')
  plans.request.mockRejectedValue(new Error('unavailable'))
  render(<SignupPage />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), 'selected@example.invalid')
  await user.type(screen.getByLabelText('Password'), 'synthetic-password')
  await user.click(screen.getByRole('button', { name: 'Get Started' }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(auth.signup).not.toHaveBeenCalled()
})
