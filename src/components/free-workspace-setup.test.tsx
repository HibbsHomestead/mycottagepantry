import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({
  request: vi.fn(),
  ready: false,
  loading: false,
  error: '',
  retry: vi.fn(),
  revision: 'synthetic-v1',
}))
vi.mock('@/lib/registration-client', () => ({
  registrationRequest: fixture.request,
}))
vi.mock('@/lib/registration-policy-client', () => ({
  useRegistrationPolicy: () => ({
    loading: fixture.loading,
    error: fixture.error,
    retry: fixture.retry,
    policy: fixture.ready
      ? {
          revision: fixture.revision,
          terms: 'Synthetic test Terms',
          privacy: 'Synthetic test Privacy',
        }
      : null,
  }),
}))
vi.mock('./public-site', () => ({
  PublicSite: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}))
import { FreeWorkspaceSetup } from './free-workspace-setup'
beforeEach(() => {
  fixture.request.mockReset()
  fixture.ready = false
  fixture.loading = false
  fixture.error = ''
  fixture.revision = 'synthetic-v1'
  fixture.retry.mockReset()
})

it('blocks activation and never fabricates consent when approved policies are missing', () => {
  render(<FreeWorkspaceSetup onCreated={vi.fn()} />)
  expect(screen.getByRole('status')).toHaveTextContent(
    'owner needs to publish approved Terms and Privacy',
  )
  expect(
    screen.getByRole('button', { name: 'Create your business' }),
  ).toBeDisabled()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(fixture.request).not.toHaveBeenCalled()
})

it('requires explicit consent and posts only free setup without billing fields', async () => {
  fixture.ready = true
  fixture.request.mockResolvedValue({ workspaceId: 'synthetic-workspace' })
  const created = vi.fn()
  render(<FreeWorkspaceSetup onCreated={created} />)
  const user = userEvent.setup()
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(
    screen.getByRole('button', { name: 'Create your business' }),
  ).toBeDisabled()
  await user.type(
    screen.getByLabelText('Business/display name'),
    'Synthetic Kitchen',
  )
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Create your business' }))
  await waitFor(() => expect(created).toHaveBeenCalledOnce())
  expect(fixture.request).toHaveBeenCalledWith('free', {
    action: 'createFreeWorkspace',
    profile: expect.objectContaining({
      name: 'Synthetic Kitchen',
      currency: 'USD',
    }),
    consent: { accepted: true, revision: 'synthetic-v1' },
  })
  expect(JSON.stringify(fixture.request.mock.calls)).not.toMatch(
    /subscription|checkout|price|planId/,
  )
})

it('keeps business fields and consent in the open editor after a failed create request', async () => {
  fixture.ready = true
  fixture.request.mockRejectedValue(new Error('Please retry.'))
  render(<FreeWorkspaceSetup onCreated={vi.fn()} />)
  const user = userEvent.setup()
  await user.type(
    screen.getByLabelText('Business/display name'),
    'Synthetic Kitchen',
  )
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Create your business' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Please retry.')
  expect(screen.getByLabelText('Business/display name')).toHaveValue(
    'Synthetic Kitchen',
  )
  expect(screen.getByRole('checkbox')).toBeChecked()
})

it('keeps details through a policy-check failure, refresh, and a changed revision', async () => {
  fixture.ready = true
  const { rerender } = render(<FreeWorkspaceSetup onCreated={vi.fn()} />)
  const user = userEvent.setup()
  await user.type(
    screen.getByLabelText('Business/display name'),
    'Synthetic Kitchen',
  )
  await user.click(screen.getByRole('checkbox'))
  fixture.error = 'Terms and Privacy could not be checked.'
  rerender(<FreeWorkspaceSetup onCreated={vi.fn()} />)
  expect(
    screen.getByRole('button', { name: 'Create your business' }),
  ).toBeDisabled()
  await user.click(
    screen.getByRole('button', { name: 'Check published policies again' }),
  )
  expect(fixture.retry).toHaveBeenCalledOnce()
  fixture.error = ''
  fixture.revision = 'synthetic-v2'
  rerender(<FreeWorkspaceSetup onCreated={vi.fn()} />)
  expect(screen.getByLabelText('Business/display name')).toHaveValue(
    'Synthetic Kitchen',
  )
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(
    screen.getByRole('button', { name: 'Create your business' }),
  ).toBeDisabled()
})

it('identifies invalid timezone without submitting or dropping entered details', async () => {
  fixture.ready = true
  render(<FreeWorkspaceSetup onCreated={vi.fn()} />)
  const user = userEvent.setup()
  await user.type(
    screen.getByLabelText('Business/display name'),
    'Synthetic Kitchen',
  )
  await user.clear(screen.getByLabelText('Timezone'))
  await user.type(screen.getByLabelText('Timezone'), 'Not/AZone')
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Create your business' }))
  expect(
    await screen.findByText(
      'Choose a valid timezone, such as America/Chicago.',
    ),
  ).toBeInTheDocument()
  expect(screen.getByLabelText('Timezone')).toHaveAttribute(
    'aria-invalid',
    'true',
  )
  expect(fixture.request).not.toHaveBeenCalled()
})

it('resets consent on a stale-policy response and blocks duplicate in-flight submits', async () => {
  fixture.ready = true
  let reject!: (error: Error) => void
  fixture.request.mockImplementation(
    () =>
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise
      }),
  )
  render(<FreeWorkspaceSetup onCreated={vi.fn()} />)
  const user = userEvent.setup()
  await user.type(
    screen.getByLabelText('Business/display name'),
    'Synthetic Kitchen',
  )
  await user.click(screen.getByRole('checkbox'))
  await user.dblClick(
    screen.getByRole('button', { name: 'Create your business' }),
  )
  expect(fixture.request).toHaveBeenCalledOnce()
  reject(
    Object.assign(new Error('Review the current policies.'), {
      code: 'POLICY_CHANGED',
    }),
  )
  await waitFor(() => expect(fixture.retry).toHaveBeenCalledOnce())
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(screen.getByLabelText('Business/display name')).toHaveValue(
    'Synthetic Kitchen',
  )
})
