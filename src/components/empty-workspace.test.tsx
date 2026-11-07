import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceApp } from './workspace-app'
import { TooltipProvider } from './ui/tooltip'
import { demoData } from '@/lib/demo'
import { financeTables } from '@/lib/finance'
vi.mock('@netlify/identity', () => ({ onAuthChange: () => () => {} }))
afterEach(() => vi.unstubAllGlobals())
it('never flashes sample records while loading and renders a new empty private oven', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  let respond: (value: Response) => void = () => {}
  const pending = new Promise<Response>((resolve) => {
    respond = resolve
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(() => pending),
  )
  history.replaceState({}, '', '/workspace')
  render(
    <TooltipProvider>
      <WorkspaceApp />
    </TooltipProvider>,
  )
  expect(
    screen.getByRole('heading', { name: 'Opening your oven…' }),
  ).toBeInTheDocument()
  expect(screen.queryByText('Hibbs Homestead Market')).not.toBeInTheDocument()
  const workspace = Object.fromEntries(
    [
      ...Object.keys(demoData()),
      ...financeTables,
      'accounts',
      'journals',
      'units',
      'lots',
      'inventory_counts',
    ].map((key) => [key, []]),
  )
  workspace.settings = [
    {
      id: 'business',
      name: 'Juniper Crumb Kitchen',
      owner: '',
      laborRate: 0,
      targetMargin: 0,
      taxRates: [],
      currency: 'USD',
      measurements: 'metric',
      appearance: { theme: 'cottage', mode: 'light' },
    },
  ] as any
  respond(Response.json({ workspace, role: 'Owner', demo: false }))
  await waitFor(() =>
    expect(
      screen.queryByRole('heading', { name: 'Opening your oven…' }),
    ).not.toBeInTheDocument(),
  )
  expect(screen.getAllByText('Juniper Crumb Kitchen').length).toBeGreaterThan(0)
  expect(screen.queryByText('Bread flour')).not.toBeInTheDocument()
  expect(screen.queryByText('Hibbs Homestead Market')).not.toBeInTheDocument()
})
