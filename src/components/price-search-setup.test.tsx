import { afterEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PriceSearchSetup } from './price-search-setup'
const ingredient = {
  id: 'flour',
  name: 'Bread flour',
  unit: 'g',
  quantity: 42,
  packagePrice: 7.5,
}
const configured = {
  configured: true,
  status: 'Configured, not tested',
  lastTest: null,
  message: null,
}
afterEach(() => vi.unstubAllGlobals())
it('refreshes configuration without paid searches and enables an explicit confirmed test', async () => {
  const user = userEvent.setup()
  const fetcher = vi.fn(async (_url: string, _options?: RequestInit) =>
    Response.json({
      ...configured,
      configured: false,
      status: 'Missing configuration',
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  render(<PriceSearchSetup ingredients={[ingredient]} />)
  await screen.findByText('Missing configuration')
  expect(
    screen.getByRole('button', { name: 'Test shopping search' }),
  ).toBeDisabled()
  fetcher.mockImplementation(async () => Response.json(configured))
  await user.click(
    screen.getByRole('button', { name: 'Refresh configuration status' }),
  )
  await screen.findByText('Configured, not tested')
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(
    fetcher.mock.calls.every(([, options]) => options?.method !== 'POST'),
  ).toBe(true)
  expect(
    screen.getByRole('button', { name: 'Test shopping search' }),
  ).toBeDisabled()
  await user.click(screen.getByRole('checkbox'))
  expect(
    screen.getByRole('button', { name: 'Test shopping search' }),
  ).toBeEnabled()
  fetcher.mockImplementation(async () =>
    Response.json({
      ...configured,
      status: 'Connection successful',
      lastTest: '2026-10-31T04:00:00Z',
      message: 'Search successful. Review product matches.',
    }),
  )
  await user.click(screen.getByRole('button', { name: 'Test shopping search' }))
  await screen.findByText('Connection successful')
  expect(fetcher).toHaveBeenCalledTimes(3)
  const options = (
    fetcher.mock.calls as unknown as [string, RequestInit][]
  )[2][1]
  expect(options.method).toBe('POST')
  expect(JSON.parse(options.body as string)).toMatchObject({
    ingredientId: 'flour',
    confirmAllowance: true,
  })
  expect(ingredient).toEqual({
    id: 'flour',
    name: 'Bread flour',
    unit: 'g',
    quantity: 42,
    packagePrice: 7.5,
  })
  expect(
    screen.getByText(/One request searches Google Shopping/),
  ).toBeInTheDocument()
})
it.each([
  [
    'Authentication failed',
    'Authentication failed. Check server configuration.',
  ],
  ['Allowance exhausted', 'Allowance exhausted. Check the provider plan.'],
  ['Provider unavailable', 'Provider unavailable. Try later.'],
  [
    'Connection successful',
    'No matching products. The provider accepted the search.',
  ],
])('shows the explicit outcome %s', async (status, message) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ...configured, status, message })),
  )
  render(<PriceSearchSetup ingredients={[ingredient]} />)
  await screen.findByText(message)
  expect(screen.getByText(status)).toBeInTheDocument()
})
it.each([
  new Response('<html>Sign in</html>', {
    status: 401,
    headers: { 'content-type': 'text/html' },
  }),
  new Response('{broken', { headers: { 'content-type': 'application/json' } }),
  Response.json(null),
  Response.json({ configured: true }),
])(
  'handles unexpected status responses and keeps the paid test disabled',
  async (response) => {
    const fetcher = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetcher)
    render(<PriceSearchSetup ingredients={[ingredient]} />)
    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent(
      /JSON.parse|Unexpected token|SyntaxError/,
    )
    expect(
      screen.getByRole('button', { name: 'Test shopping search' }),
    ).toBeDisabled()
    expect(fetcher).toHaveBeenCalledTimes(1)
  },
)
it('blocks duplicate tests while a confirmed request is pending', async () => {
  let resolve!: (response: Response) => void
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    options?.method === 'POST'
      ? new Promise<Response>((r) => {
          resolve = r
        })
      : Response.json(configured),
  )
  vi.stubGlobal('fetch', fetcher)
  render(<PriceSearchSetup ingredients={[ingredient]} />)
  await screen.findByText('Configured, not tested')
  await userEvent.click(screen.getByRole('checkbox'))
  await userEvent.dblClick(
    screen.getByRole('button', { name: 'Test shopping search' }),
  )
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(
    screen.getByRole('button', { name: 'Testing connection…' }),
  ).toBeDisabled()
  resolve(
    Response.json({
      ...configured,
      status: 'Connection successful',
      message: 'Search successful.',
    }),
  )
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Test shopping search' }),
    ).toBeEnabled(),
  )
})
