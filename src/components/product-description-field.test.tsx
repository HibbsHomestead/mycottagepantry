import { afterEach, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useState } from 'react'
import { ProductDescriptionField } from './product-description-field'
import { demoData } from '@/lib/demo'
import type { Item } from '@/lib/domain'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const original: Item = {
  id: 'isolated',
  name: 'Example',
  workflow: 'resale',
  description: 'Existing description',
  notes: 'Private note',
}
function Harness() {
  const [product, setProduct] = useState(original)
  return (
    <>
      <button onClick={() => setProduct({ ...product, name: 'Changed' })}>
        Change source
      </button>
      <button
        onClick={() =>
          setProduct({
            ...product,
            id: 'another',
            description: 'Another product',
          })
        }
      >
        Switch product
      </button>
      <ProductDescriptionField
        product={product}
        workspace={demoData()}
        change={(key, value) => setProduct({ ...product, [key]: value })}
      />
    </>
  )
}
function deferred() {
  let resolve!: (r: Response) => void
  const promise = new Promise<Response>((r) => {
    resolve = r
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(() => promise),
  )
  return resolve
}
it('blocks duplicate calls, preserves text on cancel, and ignores late responses after switching products', async () => {
  const resolve = deferred()
  render(<Harness />)
  fireEvent.click(
    screen.getByRole('button', { name: 'Generate description' }),
  )
  expect(screen.getByRole('button', { name: 'Generate again' })).toBeDisabled()
  expect(fetch).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(
    screen.getByLabelText('Product description (customer-facing)'),
  ).toHaveValue('Existing description')
  fireEvent.click(screen.getByRole('button', { name: 'Switch product' }))
  resolve(Response.json({ description: 'Late suggestion' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  )
  expect(
    screen.getByLabelText('Product description (customer-facing)'),
  ).toHaveValue('Another product')
})
it('requires acknowledgement of changed sources, applies only on approval and can restore', async () => {
  const resolve = deferred()
  render(<Harness />)
  fireEvent.click(
    screen.getByRole('button', { name: 'Generate description' }),
  )
  // Simulate an upstream change while a request is running.
  fireEvent.click(screen.getByText('Change source'))
  resolve(Response.json({ description: 'Proposed text' }))
  await screen.findByDisplayValue('Proposed text')
  expect(screen.getByRole('button', { name: 'Use description' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Use description' }))
  expect(
    screen.getByLabelText('Product description (customer-facing)'),
  ).toHaveValue('Proposed text')
  fireEvent.click(
    screen.getByRole('button', { name: 'Restore previous description' }),
  )
  expect(
    screen.getByLabelText('Product description (customer-facing)'),
  ).toHaveValue('Existing description')
})
it('shows a failure without replacing draft text or automatically retrying', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ error: 'AI usage limit reached.' }, { status: 429 }),
    ),
  )
  render(<Harness />)
  fireEvent.click(
    screen.getByRole('button', { name: 'Generate description' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'AI usage limit reached',
  )
  expect(screen.getByRole('button', { name: 'Use description' })).toBeDisabled()
  expect(fetch).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(
    screen.getByLabelText('Product description (customer-facing)'),
  ).toHaveValue('Existing description')
})

it('aborts a timed-out request, preserves the draft and does not retry', async () => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new Error('Aborted')),
          )
        }),
    ),
  )
  render(<Harness />)
  fireEvent.click(
    screen.getByRole('button', { name: 'Generate description' }),
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(25001)
  })
  expect(screen.getByRole('alert')).toHaveTextContent('timed out')
  expect(fetch).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(
    screen.getByLabelText('Product description (customer-facing)'),
  ).toHaveValue('Existing description')
})
