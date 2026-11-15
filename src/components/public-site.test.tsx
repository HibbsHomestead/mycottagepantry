import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
const session = vi.hoisted(() => ({ status: vi.fn() }))
vi.mock('@/lib/identity-session', () => ({
  restoreIdentitySession: async () => {},
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
vi.mock('@/lib/session.functions', () => ({
  getSessionStatus: session.status,
}))
import { SignupPage } from './signup-page'
import { tourPlanScope } from './product-tour'
import { launchFeatures } from '@/lib/launch-plans'
import { featurePresentation, publicPlans } from '@/lib/plan-presentation'
import {
  HomePage,
  FeaturesPage,
  PricingPage,
  LegalPage,
  HelpPage,
} from './public-site'
beforeEach(() => {
  session.status.mockResolvedValue({ signedIn: false })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('view=availability')
        ? Response.json({
            plans: [
              'mixing-bowl',
              'bakers-bench',
              'cottage-kitchen',
              'cottage-mercantile',
            ],
          })
        : url === '/api/stripe/billing'
          ? Response.json(
              { code: 'SIGN_IN_REQUIRED', error: 'Log in to continue.' },
              { status: 401 },
            )
          : Response.json({ policy: null }),
    ),
  )
})
afterEach(() => vi.unstubAllGlobals())
it('shows the website to signed-out visitors and an obvious oven link to signed-in visitors without reading business data', async () => {
  session.status.mockResolvedValue({ signedIn: true })
  const fetcher = vi.fn(async () => Response.json({ policy: null }))
  vi.stubGlobal('fetch', fetcher)
  const view = render(<HomePage />)
  expect(
    await screen.findByRole('link', { name: 'Open oven' }),
  ).toHaveAttribute('href', '/oven')
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Know your costs.Organize your kitchen.Build your business.',
  )
  expect(screen.queryByText('Hibbs Homestead Market')).not.toBeInTheDocument()
  expect(
    fetcher.mock.calls.every(
      (call: unknown[]) => call[0] === '/api/registration?view=policies',
    ),
  ).toBe(true)
  expect(screen.queryByRole('link', { name: 'Terms' })).not.toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Privacy' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByText(/requires publication/)).not.toBeInTheDocument()
  view.unmount()
  vi.unstubAllGlobals()
})
it('compares approved prices, verified purchase availability, user allowances and partial/planned features', async () => {
  render(<PricingPage />)
  expect(
    screen.getByText(/Paid access starts only after verified billing/),
  ).toBeInTheDocument()
  expect(
    await screen.findByText(
      /setup requires email verification and valid business details/,
    ),
  ).toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByText(/Join the beta/)).not.toBeInTheDocument()
  await screen.findByRole('link', { name: 'Choose Cottage Mercantile' })
  const comparison = screen.getByRole('region', {
    name: 'Find your place in the pantry.',
  })
  for (const [name, price, id] of [
    ['Free', '$0', 'free'],
    ['Mixing Bowl', '$10', 'mixing-bowl'],
    ['Baker’s Bench', '$20', 'bakers-bench'],
    ['Cottage Kitchen', '$30', 'cottage-kitchen'],
    ['Cottage Mercantile', '$40', 'cottage-mercantile'],
  ]) {
    const card = within(comparison)
      .getByRole('heading', { name })
      .closest('article')!
    expect(card).toHaveTextContent(price + ' USD / month')
    expect(
      within(card).getByRole('link', {
        name: id === 'free' ? 'Get Started Free' : `Choose ${name}`,
      }),
    ).toHaveAttribute('href', `/signup?plan=${id}&returnTo=%2Foven%2Fbilling`)
  }
  expect(comparison).not.toHaveTextContent(/\$25|\$50|annual|trial/i)
  expect(comparison).toHaveTextContent('Cottage Mercantile')
  expect(comparison).not.toHaveTextContent(
    /total users|including the owner|unlimited users/i,
  )
  expect(comparison).toHaveTextContent('Excludes resale and consignment')
  expect(comparison).toHaveTextContent('Proposed record limits are not active')
  expect(
    [...comparison.querySelectorAll('.plan-status')].filter((n) =>
      /not (yet )?available for purchase/i.test(n.textContent || ''),
    ),
  ).toHaveLength(0)
  expect(comparison).toHaveTextContent('Partial')
  expect(comparison).toHaveTextContent('Coming soon')
  expect(within(comparison).getByRole('table')).toBeInTheDocument()
  const table = within(comparison).getByRole('table')
  for (const feature of launchFeatures) {
    const labels = within(table).getAllByRole('rowheader', {
      name: feature.label,
    })
    expect(labels).toHaveLength(1)
    const cells = within(labels[0].closest('tr')!).getAllByRole('cell')
    publicPlans.forEach((plan, index) => {
      const expected = featurePresentation(plan.id, feature.id)
      expect(cells[index].textContent?.includes('✓')).toBe(
        expected.status === 'implemented',
      )
      if (expected.status !== 'excluded')
        expect(cells[index]).toHaveTextContent(expected.text)
      else
        expect(
          within(cells[index]).getByLabelText('Not included'),
        ).toBeInTheDocument()
    })
  }
  for (const link of screen.getAllByRole('link', { name: /^Get Started/ }))
    expect(link.getAttribute('href')).toMatch(
      /^\/signup(?:\?plan=free&returnTo=%2Foven%2Fbilling)?$/,
    )
  expect(
    screen.queryByRole('link', { name: /checkout|subscribe|purchase/i }),
  ).not.toBeInTheDocument()
})
it.each(['BUSINESS_SETUP_REQUIRED', 'EMAIL_UNVERIFIED'])(
  'keeps plan selection available to an account needing %s',
  async (code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('view=availability')
          ? Response.json({ plans: ['cottage-mercantile'] })
          : url === '/api/stripe/billing'
            ? Response.json({ code, error: 'Complete setup.' }, { status: 409 })
            : Response.json({ policy: null }),
      ),
    )
    render(<PricingPage />)
    expect(
      await screen.findByRole('link', { name: 'Choose Cottage Mercantile' }),
    ).toHaveAttribute(
      'href',
      '/signup?plan=cottage-mercantile&returnTo=%2Foven%2Fbilling',
    )
    expect(screen.queryByText(/owner manages billing/i)).not.toBeInTheDocument()
  },
)
it.each([HomePage, FeaturesPage, PricingPage, HelpPage])(
  'removes beta admission and unavailable plan offers from public screens',
  (Page) => {
    const { container } = render(<Page />)
    expect(container.textContent).not.toMatch(
      /beta|waitlist|invitation-only|plan interest|signup and payments are closed|\$25|\$50/i,
    )
    expect(
      screen.getAllByRole('link', { name: /^Get Started/ }).length,
    ).toBeGreaterThan(0)
    expect(container.querySelector('a[href*="checkout"]')).toBeNull()
  },
)
it('opens accessible phone navigation and offers registration', async () => {
  render(<SignupPage />)
  const toggle = screen.getByRole('button', { name: 'Open navigation' })
  await userEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(
    screen.getByRole('heading', { name: 'Get Started' }),
  ).toBeInTheDocument()
  expect(screen.getByLabelText('Email')).toBeInTheDocument()
})
it('does not invent legal policies', async () => {
  render(<LegalPage kind="Privacy" />)
  expect(
    await screen.findByText(/not a legal policy or agreement/),
  ).toBeInTheDocument()
})

it('shows the published legal text and revision together without the unpublished notice', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        policy: {
          revision: 'synthetic-v1',
          terms: 'Synthetic approved Terms.',
          privacy: 'Synthetic approved Privacy.',
        },
      }),
    ),
  )
  render(<LegalPage kind="Privacy" />)
  expect(
    await screen.findByText('Synthetic approved Privacy.'),
  ).toBeInTheDocument()
  expect(screen.getByText('Revision synthetic-v1')).toBeInTheDocument()
  expect(await screen.findByRole('link', { name: 'Terms' })).toHaveAttribute(
    'href',
    '/terms',
  )
  expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute(
    'href',
    '/privacy',
  )
  expect(
    screen.queryByText(/not a legal policy or agreement/),
  ).not.toBeInTheDocument()
})

it('offers a six-section product tour with feature availability and an accessible screenshot viewer', async () => {
  render(<FeaturesPage />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Your recipes. Your pantry. Your business.Finally, working together.',
  )
  const nav = screen.getByRole('navigation', { name: 'Product tour sections' })
  expect(nav.querySelectorAll('a')).toHaveLength(6)
  expect(
    screen.getAllByRole('button', { name: /^Expand .* screenshot$/ }),
  ).toHaveLength(6)
  expect(
    screen.getByRole('heading', {
      name: 'Follow one loaf from pantry to product.',
    }),
  ).toBeInTheDocument()
  expect(screen.getAllByText(/Available in the oven/).length).toBeGreaterThan(0)
  expect(
    screen.getByText(/Advanced multi-batch planning is not available/),
  ).toBeInTheDocument()
  const trigger = screen.getByRole('button', {
    name: 'Expand Costing screenshot',
  })
  await userEvent.click(trigger)
  expect(screen.getByRole('dialog', { name: 'Costing' })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('does not present centrally planned capabilities as available in the tour', () => {
  expect(tourPlanScope('invitations')).toBe('Not yet available')
  expect(tourPlanScope('multiBatchPlanning')).toBe('Not yet available')
  expect(tourPlanScope('recipeImport')).toBe('Available in the oven')
})
