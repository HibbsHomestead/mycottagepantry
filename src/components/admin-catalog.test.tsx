import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AdminCatalog } from './admin-catalog'
afterEach(() => vi.unstubAllGlobals())
it('keeps the administration editor reviewable and requires a scoped review before publishing', async () => {
  const fetch = vi.fn(async (url: string, options?: RequestInit) =>
    url.includes('action=catalog') && options?.method === 'POST'
      ? Response.json({ ok: true })
      : Response.json({ items: [], submissions: [] }),
  )
  vi.stubGlobal('fetch', fetch)
  render(<AdminCatalog />)
  await screen.findByText('No pending contributions.')
  fireEvent.change(
    screen.getByLabelText('Shared snapshot (only listed fields are permitted)'),
    {
      target: {
        value: JSON.stringify({
          kind: 'ingredient',
          entryType: 'generic',
          fields: { name: 'Rye flour' },
        }),
      },
    },
  )
  expect(
    screen.getByRole('button', { name: 'Publish reviewed revision' }),
  ).toBeDisabled()
  fireEvent.change(
    screen.getByLabelText('Fields checked, review scope or withdrawal reason'),
    {
      target: {
        value:
          'Generic ingredient name and type only; package details unknown.',
      },
    },
  )
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(
    screen.getByRole('button', { name: 'Publish reviewed revision' }),
  )
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
  const body = JSON.parse(String(fetch.mock.calls[1][1]?.body))
  expect(body.snapshot.fields).toEqual({ name: 'Rye flour' })
  expect(body.rights).toBe(true)
})
it('reports malformed responses without crashing or treating an unreadable queue as empty', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ unreadable: true })),
  )
  render(<AdminCatalog />)
  await screen.findByRole('alert')
  expect(
    screen.queryByText('No pending contributions.'),
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Retry catalog administration' }),
  ).toBeVisible()
})
