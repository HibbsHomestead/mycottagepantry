import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({
  request: vi.fn(),
  account: null as any,
  resume: vi.fn(),
}))
vi.mock('@/lib/signup-plan-client', () => ({
  resumeSelectedPlan: api.resume,
}))
vi.mock('@/lib/account-access-client', () => ({
  useAccountAccess: () => api.account,
}))
vi.mock('@/lib/registration-client', () => ({
  registrationRequest: api.request,
}))
vi.mock('@/lib/registration-policy-client', () => ({
  useRegistrationPolicy: () => ({
    policy: null,
    loading: false,
    error: '',
    retry: vi.fn(),
  }),
}))
vi.mock('@/lib/session.functions', () => ({
  getSessionStatus: async () => ({ signedIn: true }),
}))
import { OnboardingPage } from './onboarding-page'
import { BillingPage } from './billing-page'
import { VerificationPage } from './verification-page'
const profile = {
  name: 'Juniper Crumb Kitchen',
  country: 'US',
  timezone: 'America/Chicago',
  currency: 'USD',
  measurements: 'metric',
  phone: '',
  website: '',
  description: '',
  focus: '',
}
beforeEach(() => {
  api.request.mockReset()
  api.resume.mockReset().mockResolvedValue(null)
  api.account = {
    loading: false,
    error: false,
    traceId: 'b5b2cac8-b9a1-42e8-a8d7-318a6832c28b',
    retry: vi.fn(),
    access: { status: 'no_workspace', privateTest: true },
  }
  history.replaceState({}, '', '/onboarding')
})
it('does not expose the private form or acceptance to an unauthorized visitor', async () => {
  api.account.error = true
  render(<OnboardingPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'could not be checked',
  )
  expect(
    screen.queryByLabelText('Business/display name'),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})

it('shows a failed ordinary setup lookup and preserves business details during Retry', async () => {
  api.account.access.privateTest = false
  api.resume
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce(null)
  render(<OnboardingPage />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'saved setup could not be checked',
  )
  const user = userEvent.setup()
  await user.type(
    screen.getByLabelText('Business/display name'),
    'Synthetic Kitchen',
  )
  await user.click(screen.getByRole('button', { name: 'Retry setup check' }))
  await waitFor(() => expect(api.resume).toHaveBeenCalledTimes(2))
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
  )
  expect(screen.getByLabelText('Business/display name')).toHaveValue(
    'Synthetic Kitchen',
  )
})
it('resumes safe server fields, saves edits and leaves marketing optional', async () => {
  const state = {
    privateTest: true,
    membership: null,
    draft: {
      profile,
      plan_id: 'free',
      marketing_consent: false,
      checklist: [],
    },
  }
  api.request.mockResolvedValue(state)
  render(<OnboardingPage />)
  expect(await screen.findByLabelText('Business/display name')).toHaveValue(
    profile.name,
  )
  expect(screen.getByLabelText('Preferred measurement display')).toHaveValue(
    'metric',
  )
  expect(screen.getByLabelText(/Optional product updates/)).not.toBeChecked()
  const user = userEvent.setup()
  await user.clear(screen.getByLabelText('Business/display name'))
  await user.type(
    screen.getByLabelText('Business/display name'),
    'Juniper Crumb Co.',
  )
  await user.click(screen.getByRole('button', { name: 'Save test setup' }))
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        action: 'saveDraft',
        profile: expect.objectContaining({
          name: 'Juniper Crumb Co.',
          measurements: 'metric',
        }),
        marketingConsent: false,
      }),
    ),
  )
  expect(
    screen.getByRole('button', { name: 'Create empty Free test oven' }),
  ).toBeDisabled()
})
it('does not create another oven for an existing membership', async () => {
  api.account.loading = true
  api.account.access = null
  render(<OnboardingPage />)
  expect(
    screen.getByRole('heading', { name: 'Checking account access…' }),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Create empty Free test oven' }),
  ).not.toBeInTheDocument()
  expect(api.request).not.toHaveBeenCalledWith('', { action: 'provisionTest' })
})
it('marks handmade production unavailable and keeps premium interest from activating access', async () => {
  api.request.mockResolvedValue({
    privateTest: true,
    membership: null,
    draft: {
      profile: { ...profile, focus: 'handmade' },
      plan_id: 'cottage-kitchen',
      checklist: [],
    },
  })
  render(<OnboardingPage />)
  expect(
    await screen.findByText(/Specialized handmade-materials/),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Create empty Free test oven' }),
  ).toBeDisabled()
  expect(
    screen.queryByRole('button', { name: /pay|subscribe/i }),
  ).not.toBeInTheDocument()
})
it('shows uncertain payment without offering another charge or fabricated invoice', async () => {
  api.request.mockResolvedValue({
    workspace: { id: 'test', name: 'Test Kitchen' },
    billing: {
      source: 'square_sandbox',
      plan_id: 'mixing-bowl',
      status: 'payment_processing',
      snapshot: {},
    },
    attempts: [
      {
        id: 'fixture-attempt',
        plan_id: 'mixing-bowl',
        status: 'payment_processing',
      },
    ],
    invoiceHistoryAvailable: false,
  })
  render(<BillingPage />)
  expect(
    await screen.findByText(/Payment pending confirmation\. This can take/),
  ).toBeInTheDocument()
  expect(
    screen.getByText(/Sample invoices are never shown/),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /Square checkout/ }),
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
  // Refresh only re-reads status from Square; it never starts a checkout.
  expect(
    api.request.mock.calls.every(
      (call: any[]) =>
        call[0] === 'billing' &&
        (call.length === 1 || call[1]?.action === 'refresh'),
    ),
  ).toBe(true)
})
it('offers recovery without claiming that mail was already requested or delivered', () => {
  render(<VerificationPage recovery />)
  expect(
    screen.getByRole('heading', { name: 'Recover your account.' }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Send reset link' }),
  ).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(api.request).not.toHaveBeenCalled()
})

it('keeps the saved paid choice while allowing business setup without unpublished policies or paid activation', async () => {
  api.resume.mockResolvedValue({
    planId: 'cottage-kitchen',
    name: 'Cottage Kitchen',
    monthlyUsd: 30,
    currency: 'USD',
    interval: 'month',
    paidActivationAvailable: false,
  })
  api.account.access = { status: 'no_workspace', privateTest: false }
  history.replaceState({}, '', '/onboarding?plan=cottage-kitchen')
  render(<OnboardingPage />)
  expect(
    await screen.findByRole('heading', { name: 'Create your business' }),
  ).toBeInTheDocument()
  expect(screen.getByLabelText('Business/display name')).toBeInTheDocument()
  expect(screen.getByText(/Selected plan: Cottage Kitchen/)).toHaveTextContent(
    'no paid subscription exists',
  )
  expect(screen.queryByLabelText('Plan interest')).not.toBeInTheDocument()
  expect(
    screen.queryByText(/Private development only|Save test setup/),
  ).not.toBeInTheDocument()
  expect(api.request).not.toHaveBeenCalled()
  expect(
    screen.getByRole('button', { name: 'Create your business' }),
  ).toBeEnabled()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
})
