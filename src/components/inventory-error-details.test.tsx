import { afterEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { RouteErrorPage } from './error-pages'
import { InventoryErrorDetails } from './inventory-error-details'
import { captureInventoryError } from '@/lib/inventory-error-details'

afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
})

it('copies collapsed, sanitized diagnostics from the real route catch boundary, then retries normally', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  window.history.replaceState({}, '', '/oven?private-query#Inventory/Overview')
  const user = userEvent.setup()
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  let fails = true
  function PantryInventory() {
    if (fails) throw new TypeError('private-item private-credential')
    return <h1>Inventory</h1>
  }
  const root = createRootRoute()
  const oven = createRoute({
    getParentRoute: () => root,
    path: '/oven',
    component: PantryInventory,
  })
  const router = createRouter({
    routeTree: root.addChildren([oven]),
    defaultErrorComponent: RouteErrorPage,
    defaultOnCatch: captureInventoryError,
    history: createMemoryHistory({ initialEntries: ['/oven'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
  expect(
    await screen.findByRole('heading', { name: 'This page couldn’t load' }),
  ).toBeVisible()
  const summary = await screen.findByText('Inventory error details', {
    selector: 'summary',
  })
  expect(summary.closest('details')).not.toHaveAttribute('open')
  expect(screen.getByText('Copy error details')).not.toBeVisible()
  await user.click(summary)
  await user.click(screen.getByRole('button', { name: 'Copy error details' }))
  const report = write.mock.calls[0][0]
  const details = JSON.parse(report)
  expect(details.pathname).toBe('/oven')
  expect(details.error.type).toBe('TypeError')
  expect(details.error.componentStack).toContain('PantryInventory')
  expect(report).not.toMatch(/private-item|private-credential|private-query/)
  expect(screen.getByRole('status')).toHaveTextContent('Error details copied.')
  fails = false
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(
    await screen.findByRole('heading', { name: 'Inventory' }),
  ).toBeVisible()
  expect(screen.queryByText('Inventory error details')).not.toBeInTheDocument()
})

it('offers manual copying when clipboard access fails', async () => {
  window.history.replaceState({}, '', '/oven#Inventory/Overview')
  const user = userEvent.setup()
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
    new Error('denied'),
  )
  render(
    <InventoryErrorDetails error={new Error('Choose a supported unit.')} />,
  )
  await user.click(
    await screen.findByText('Inventory error details', { selector: 'summary' }),
  )
  await user.click(screen.getByRole('button', { name: 'Copy error details' }))
  expect(screen.getByRole('status')).toHaveTextContent(
    'Select and copy the details below.',
  )
  const textarea = screen.getByLabelText(
    'Sanitized error details',
  ) as HTMLTextAreaElement
  expect(textarea).toHaveFocus()
  expect(textarea.selectionEnd).toBe(textarea.value.length)
})

it.each([
  '/login#Inventory/Overview',
  '/oven#Dashboard',
  '/oven#Finance/Overview',
])('keeps diagnostics off other routes: %s', async (url) => {
  window.history.replaceState({}, '', url)
  render(<InventoryErrorDetails error={new Error('private-message')} />)
  expect(screen.queryByText('Inventory error details')).not.toBeInTheDocument()
  expect(screen.queryByText('private-message')).not.toBeInTheDocument()
})
