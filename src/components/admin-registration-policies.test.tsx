import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { AdminRegistrationPolicies } from './admin-registration-policies'
afterEach(() => vi.unstubAllGlobals())

it('uploads approved text for review before publishing and reopens the saved document and revision together', async () => {
  let saved: unknown = null
  const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'POST')
      saved = JSON.parse(String(options.body)).policy
    return Response.json({ policy: saved, history: [] })
  })
  vi.stubGlobal('fetch', fetch)
  const view = render(<AdminRegistrationPolicies />)
  await screen.findByText(
    'No policies published. Business creation is available without policy acceptance.',
  )
  const file = new File(
    ['Synthetic approved Terms for testing only.'],
    'terms.txt',
    { type: 'text/plain' },
  )
  // jsdom File lacks text() in this version; retain the browser file interface.
  Object.defineProperty(file, 'text', {
    value: async () => 'Synthetic approved Terms for testing only.',
  })
  fireEvent.change(
    screen.getByLabelText('Upload approved Terms (.txt or .md)'),
    { target: { files: [file] } },
  )
  await waitFor(() =>
    expect(screen.getByLabelText('Terms text')).toHaveValue(
      'Synthetic approved Terms for testing only.',
    ),
  )
  fireEvent.change(screen.getByLabelText('Privacy text'), {
    target: { value: 'Synthetic approved Privacy for testing only.' },
  })
  fireEvent.change(screen.getByLabelText('New policy revision'), {
    target: { value: 'synthetic-approved-v1' },
  })
  expect(
    screen.getByRole('button', { name: 'Publish Terms and Privacy' }),
  ).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox'))
  await userEvent.click(
    screen.getByRole('button', { name: 'Publish Terms and Privacy' }),
  )
  await screen.findByText(/Terms and Privacy published/)
  expect(
    JSON.parse(
      String(
        fetch.mock.calls.find((call) => call[1]?.method === 'POST')?.[1]?.body,
      ),
    ),
  ).toMatchObject({
    approved: true,
    expectedRevision: null,
    policy: { revision: 'synthetic-approved-v1' },
  })
  view.unmount()
  render(<AdminRegistrationPolicies />)
  await screen.findByText('Published revision: synthetic-approved-v1')
  expect(
    screen.getByText('Synthetic approved Terms for testing only.'),
  ).toBeInTheDocument()
  expect(
    screen.getByText('Synthetic approved Privacy for testing only.'),
  ).toBeInTheDocument()
})

it('preserves the policy editor after failed publication and rejects unsupported file types', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) =>
      options?.method === 'POST'
        ? Response.json(
            { error: 'Publication unavailable. Retry.' },
            { status: 503 },
          )
        : Response.json({ policy: null }),
    ),
  )
  render(<AdminRegistrationPolicies />)
  await screen.findByText(
    'No policies published. Business creation is available without policy acceptance.',
  )
  fireEvent.change(
    screen.getByLabelText('Upload approved Terms (.txt or .md)'),
    {
      target: {
        files: [new File(['binary'], 'terms.pdf', { type: 'application/pdf' })],
      },
    },
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'PDF and Word files must first be exported as plain text',
  )
  fireEvent.change(screen.getByLabelText('New policy revision'), {
    target: { value: 'synthetic-v1' },
  })
  fireEvent.change(screen.getByLabelText('Terms text'), {
    target: { value: 'Synthetic fixture Terms' },
  })
  fireEvent.change(screen.getByLabelText('Privacy text'), {
    target: { value: 'Synthetic fixture Privacy' },
  })
  await userEvent.click(screen.getByRole('checkbox'))
  await userEvent.click(
    screen.getByRole('button', { name: 'Publish Terms and Privacy' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Publication unavailable',
  )
  expect(screen.getByLabelText('Terms text')).toHaveValue(
    'Synthetic fixture Terms',
  )
  expect(screen.getByLabelText('Privacy text')).toHaveValue(
    'Synthetic fixture Privacy',
  )
})
