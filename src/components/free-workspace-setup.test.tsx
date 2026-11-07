import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ request: vi.fn(), ready: false }))
vi.mock('@/lib/registration-client', () => ({
  registrationRequest: fixture.request,
}))
vi.mock('@/lib/free-registration-policy', () => ({
  freeRegistrationPolicyReady: () => fixture.ready,
  freeRegistrationPolicy: {
    revision: 'synthetic-v1',
    terms: 'Synthetic test Terms',
    privacy: 'Synthetic test Privacy',
  },
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
