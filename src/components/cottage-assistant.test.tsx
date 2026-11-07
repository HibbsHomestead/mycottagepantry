import { afterEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CottageAssistant } from './cottage-assistant'
afterEach(() => vi.unstubAllGlobals())
const status = {
  configured: true,
  status: 'Configured, not tested',
  model: 'perplexity/sonar',
  checkedAt: null,
  sourcesReturned: null,
  message: null,
}
const suggestion = {
  mode: 'paste',
  model: 'perplexity/sonar',
  fields: { name: 'Bread flour', packagePrice: 6.49, barcode: '071012041053' },
  evidence: {
    name: 'Bread flour',
    packagePrice: '6.49 USD',
    barcode: '071012041053',
  },
  answer: '',
  sources: [],
  warnings: [],
  checkedAt: '2026-10-31T04:00:00Z',
  usage: { totalTokens: 200, costUsd: 0.0052 },
}
async function setup(response: Response = Response.json(suggestion)) {
  const request = vi.fn(async (_url: string, options?: RequestInit) =>
    options?.method === 'POST' ? response : Response.json(status),
  )
  vi.stubGlobal('fetch', request)
  const apply = vi.fn()
  render(
    <CottageAssistant
      existing
      draft={{
        name: 'Original',
        packagePrice: 9,
        quantity: 42,
        reviewed: true,
      }}
      apply={apply}
    />,
  )
  expect(request).not.toHaveBeenCalled()
  await userEvent.click(screen.getByText('Cottage Pantry Assistant'))
  await screen.findByText('Configured, not tested')
  return { apply, request }
}
it('requires field selection and approval, applies only to a draft, and never saves', async () => {
  const { apply, request } = await setup()
  expect(screen.queryByText('Connection successful')).not.toBeInTheDocument()
  await userEvent.type(
    screen.getByLabelText('Paste product information'),
    'Bread flour 5 lb, 6.49 USD. UPC 071012041053',
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Suggest ingredient fields' }),
  )
  await screen.findByText('Review suggested fields')
  expect(apply).not.toHaveBeenCalled()
  expect(screen.getByText('Connection successful')).toBeInTheDocument()
  const button = screen.getByRole('button', {
    name: 'Apply selected fields to draft',
  })
  expect(button).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox', { name: /^Name/ }))
  expect(button).toBeDisabled()
  await userEvent.click(screen.getByLabelText(/I reviewed and approve/))
  await userEvent.click(button)
  expect(apply).toHaveBeenCalledWith({ name: 'Bread flour', reviewed: false })
  expect(request).toHaveBeenCalledTimes(2)
  expect(JSON.parse(request.mock.calls[1][1]!.body as string)).toEqual({
    mode: 'paste',
    text: 'Bread flour 5 lb, 6.49 USD. UPC 071012041053',
  })
  expect(
    await screen.findByText(/Selected fields applied to your unsaved draft/),
  ).toBeInTheDocument()
})
it('discards without changing the ingredient', async () => {
  const { apply } = await setup()
  await userEvent.type(
    screen.getByLabelText('Paste product information'),
    'Bread flour 5 lb',
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Suggest ingredient fields' }),
  )
  await screen.findByText('Review suggested fields')
  await userEvent.click(
    screen.getByRole('button', { name: 'Discard suggestions' }),
  )
  expect(apply).not.toHaveBeenCalled()
})
it('displays separate research with clickable citations and no field-apply action', async () => {
  const { apply, request } = await setup(
    Response.json({
      ...suggestion,
      mode: 'research',
      fields: {},
      evidence: {},
      answer: 'The manufacturer describes a 5 lb package. [1]',
      sources: [
        { url: 'https://maker.test/flour', title: 'Manufacturer package' },
      ],
    }),
  )
  await userEvent.click(screen.getByText('Web product research'))
  await userEvent.type(
    screen.getByLabelText('Product to research'),
    'Brand bread flour 5 lb',
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Research web sources' }),
  )
  expect(
    await screen.findByRole('link', { name: 'Manufacturer package' }),
  ).toHaveAttribute('href', 'https://maker.test/flour')
  expect(
    screen.queryByRole('button', { name: 'Apply selected fields to draft' }),
  ).not.toBeInTheDocument()
  expect(apply).not.toHaveBeenCalled()
  expect(JSON.parse(request.mock.calls[1][1]!.body as string).mode).toBe(
    'research',
  )
})
it.each([
  Response.json({ error: 'Assistant request limit reached.' }, { status: 429 }),
  new Response('<html>Login</html>', {
    status: 401,
    headers: { 'content-type': 'text/html' },
  }),
  Response.json({ ...suggestion, fields: { quantity: 100, reviewed: true } }),
])('preserves the draft and manual path on failure', async (response) => {
  const { apply } = await setup(response)
  await userEvent.type(
    screen.getByLabelText('Paste product information'),
    'Bread flour 5 lb',
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Suggest ingredient fields' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Your ingredient draft is preserved',
  )
  expect(screen.getByText('Last request failed')).toBeInTheDocument()
  expect(apply).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Paste product information')).toHaveValue(
    'Bread flour 5 lb',
  )
})
