import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceApp } from './workspace-app'
import { TooltipProvider } from './ui/tooltip'
import { demoData } from '@/lib/demo'
import type { Item } from '@/lib/domain'

vi.mock('@netlify/identity', () => ({ onAuthChange: () => () => {} }))
afterEach(() => vi.unstubAllGlobals())

async function start() {
  history.replaceState({}, '', '/workspace#Products/Food')
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  const workspace = demoData()
  const mutations: { action: string; table: string; data: Item }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        const mutation = JSON.parse(String(options.body))
        mutations.push(mutation)
        if (mutation.action === 'save' && mutation.table === 'products')
          workspace.products.push(mutation.data)
      }
      return Response.json({ workspace, role: 'Owner', demo: false })
    }),
  )
  render(
    <TooltipProvider>
      <WorkspaceApp />
    </TooltipProvider>,
  )
  await waitFor(() =>
    expect(screen.queryByText('Opening your oven…')).not.toBeInTheDocument(),
  )
  return { mutations, user: userEvent.setup() }
}

it('keeps one draft across food product tabs with the summary outside them', async () => {
  const { mutations, user } = await start()
  await user.click(
    (await screen.findAllByRole('button', { name: /Create food product/ }))[0],
  )
  const dialog = await screen.findByRole('dialog')
  const tabs = within(dialog).getByRole('tablist', { name: 'Product sections' })
  expect(
    within(tabs)
      .getAllByRole('tab')
      .map((t) => t.textContent),
  ).toEqual(['Details & Pricing', 'Images & Labels', 'Stock & Other Details'])
  // The cost summary is a sibling of the tabs, not inside a tab panel.
  const summary = dialog.querySelector('.editor-product > .pricing-summary')
  expect(summary).not.toBeNull()
  expect(summary!.closest('[role="tabpanel"]')).toBeNull()

  await user.type(within(dialog).getByLabelText('Product name'), 'Rye Loaf')
  await user.click(within(tabs).getByRole('tab', { name: 'Images & Labels' }))
  expect(
    within(dialog).getByRole('region', { name: 'Product photo' }),
  ).toBeVisible()
  await user.type(
    within(dialog).getByLabelText('Label main name (optional)'),
    'Rustic Rye',
  )
  await user.click(
    within(tabs).getByRole('tab', { name: 'Stock & Other Details' }),
  )
  await user.type(
    within(dialog).getByLabelText('Storage instructions'),
    'Keep wrapped.',
  )
  await user.click(within(tabs).getByRole('tab', { name: 'Details & Pricing' }))
  expect(within(dialog).getByLabelText('Product name')).toHaveValue('Rye Loaf')
  expect(summary).toBeVisible()

  await user.click(
    within(dialog).getByRole('button', { name: /Create Product/ }),
  )
  await waitFor(() =>
    expect(
      mutations.find((m) => m.action === 'save' && m.table === 'products'),
    ).toBeTruthy(),
  )
  const saved = mutations.find(
    (m) => m.action === 'save' && m.table === 'products',
  )!.data
  expect(saved).toMatchObject({
    name: 'Rye Loaf',
    labelMainName: 'Rustic Rye',
    storage: 'Keep wrapped.',
  })
})

it('opens the tab holding an invalid field when saving from another tab', async () => {
  const { mutations, user } = await start()
  await user.click(
    (await screen.findAllByRole('button', { name: /Create food product/ }))[0],
  )
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('tab', { name: 'Images & Labels' }))
  await user.click(
    within(dialog).getByRole('button', { name: /Create Product/ }),
  )
  await waitFor(() =>
    expect(
      within(dialog).getByRole('tab', { name: 'Details & Pricing' }),
    ).toHaveAttribute('data-state', 'active'),
  )
  expect(within(dialog).getByLabelText('Product name')).toBeVisible()
  expect(mutations.some((m) => m.table === 'products')).toBe(false)
})
