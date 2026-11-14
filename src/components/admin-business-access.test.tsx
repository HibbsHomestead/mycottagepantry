import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
const api = vi.hoisted(() => vi.fn())
vi.mock('./admin-portal', () => ({ adminRequest: api }))
import { AdminBusinessAccess } from './admin-business-access'
import { launchPricing } from '@/lib/launch-plans'
import { assignableTierIssue } from '../../netlify/lib/manual-access'
it('offers approved Mercantile with six users, uses singular user and requires a preview', async () => {
  const user = userEvent.setup()
  api.mockResolvedValue({
    confirmation: 'review-token',
    preview: {
      business: {
        business_name: 'Disposable business',
        id: 'business',
        identity_owner: 'owner',
      },
      current: { plan: null, source: 'unassigned' },
      after: { plan: 'cottage-mercantile', source: 'owner_internal' },
      memberLimit: 6,
      activeMembers: 1,
      billingNotice: 'No payment is created.',
    },
  })
  render(
    <AdminBusinessAccess
      data={{
        oven: { id: 'business', identity_owner: 'owner' },
        effective: { plan: null, source: 'unassigned' },
        memberships: [],
        manualHistory: [],
        tierCatalog: launchPricing.plans.map((p) => ({
          ...p,
          issue: assignableTierIssue(p.id),
        })),
      }}
    />,
  )
  const option = screen.getByRole('option', {
    name: 'Cottage Mercantile · 6 users',
  })
  expect(option).toBeEnabled()
  expect(screen.getByRole('option', { name: 'Free · 1 user' })).toBeEnabled()
  expect(
    screen.queryByRole('option', { name: /1 users/ }),
  ).not.toBeInTheDocument()
  await user.selectOptions(
    screen.getByLabelText('Internal tier'),
    'cottage-mercantile',
  )
  await user.type(screen.getByLabelText('Reason'), 'Approved disposable test')
  await user.click(
    screen.getByRole('button', { name: /Preview access change/ }),
  )
  expect(await screen.findByText(/No payment is created/)).toBeInTheDocument()
  expect(api).toHaveBeenCalledWith(
    'action=business-access',
    expect.objectContaining({ plan: 'cottage-mercantile' }),
  )
  expect(api.mock.calls[0][1]).not.toHaveProperty('confirmation')
})
