import { render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceApp } from './workspace-app'
import { TooltipProvider } from './ui/tooltip'
import { demoData } from '@/lib/demo'

vi.mock('@netlify/identity', () => ({ onAuthChange: () => () => {} }))
afterEach(() => {
  vi.unstubAllGlobals()
  history.replaceState({}, '', '/oven')
})

it('opens Products → Categories with a category heading, real list and Add Category instead of Create product', async () => {
  const workspace = demoData()
  const categories = [
    { id: 'stable-food', name: 'Bread', classification: 'food' },
  ]
  workspace.settings[0].productCategories = categories
  workspace.products[0].productCategoryId = 'stable-food'
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.includes('productCategories')
          ? {
              categories,
              products: workspace.products,
              rates: [],
              mappings: {},
              revision: 0,
            }
          : { workspace, role: 'Owner', demo: false },
      ),
    ),
  )
  history.replaceState({}, '', '/oven#Products/Categories')
  render(
    <TooltipProvider>
      <WorkspaceApp />
    </TooltipProvider>,
  )
  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: 'Product Categories',
    }),
  ).toBeVisible()
  const manager = screen.getByRole('region', { name: 'Product Categories' })
  expect(
    await within(manager).findByRole('heading', { name: 'Bread' }),
  ).toBeVisible()
  expect(
    within(manager).getByRole('button', { name: 'Add Category' }),
  ).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Create product' })).toBeNull()
  expect(within(manager).getByLabelText('Search categories')).toBeVisible()
})
