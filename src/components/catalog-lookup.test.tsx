import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { demoData } from '@/lib/demo'
import {
  CatalogLookup,
  CatalogUpdates,
  CatalogContribution,
} from './catalog-lookup'
import type { Item } from '@/lib/domain'
const result = {
  id: 'catalog-flour',
  revisionId: 'revision1',
  kind: 'ingredient',
  entryType: 'branded',
  status: 'active',
  fields: {
    name: 'Catalog flour',
    brand: 'Mill brand',
    subingredients: 'Wheat (flour, malt)',
    sourceContains: 'Contains wheat.',
    sourceMayContain: 'May contain soy.',
  },
  reviewScope: 'Compared visible package statements',
  reviewedAt: '2026-11-07',
  sources: [],
}
afterEach(() => vi.unstubAllGlobals())
function Form() {
  const [draft, setDraft] = useState<Record<string, Item[string]>>({
    id: 'draft',
    name: 'Manual flour',
    barcode: '036000291452',
    usedAs: 'ingredient',
    imageAssetId: 'chosen-photo',
  })
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        throw new Error('Scanner submitted form')
      }}
    >
      <input
        aria-label="Manual name"
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
      />
      <CatalogLookup
        draft={draft}
        workspace={demoData()}
        apply={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      />
      <output>{JSON.stringify(draft)}</output>
    </form>
  )
}
it('deduplicates repeated scanner Enter events and opens an account match without losing the draft', async () => {
  let finish!: (response: Response) => void
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
  )
  vi.stubGlobal('fetch', fetch)
  render(<Form />)
  const code = screen.getByLabelText('Scan or enter barcode')
  fireEvent.keyDown(code, { key: 'Enter' })
  fireEvent.keyDown(code, { key: 'Enter' })
  expect(fetch).toHaveBeenCalledTimes(1)
  finish(
    Response.json({
      version: 1,
      existing: [{ id: 'private-1', name: 'Already saved flour' }],
    }),
  )
  await screen.findByText(/Already in your account/)
  fireEvent.click(screen.getByRole('button', { name: 'Open existing item' }))
  expect(screen.getByRole('region', { name: 'Existing item' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Return to draft' }))
  expect(screen.getByLabelText('Manual name')).toHaveValue('Manual flour')
})
it('requires review for catalog results, retries failures and retains typed/manual values', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ error: 'Provider busy' }, { status: 503 }),
    )
    .mockResolvedValueOnce(Response.json({ version: 1, results: [result] }))
  vi.stubGlobal('fetch', fetch)
  render(<Form />)
  fireEvent.click(screen.getByRole('button', { name: 'Look up barcode' }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('Manual name')).toHaveValue('Manual flour')
  fireEvent.click(screen.getByRole('button', { name: 'Look up barcode' }))
  await screen.findByText('Catalog flour')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Manual name')).toHaveValue('Manual flour')
  fireEvent.click(
    screen.getByRole('button', { name: 'Review for my ingredients' }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected values' }))
  expect(screen.getByLabelText('Manual name')).toHaveValue('Manual flour')
  expect(screen.getByRole('status')).toHaveTextContent('Mill brand')
  expect(screen.getByRole('status')).toHaveTextContent('chosen-photo')
})
it('retains a selected unsupported-page URL without treating the search candidate as ingredient evidence', async () => {
  const apply = vi.fn(),
    source = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ version: 1, results: [] }))
      .mockResolvedValueOnce(
        Response.json({
          version: 1,
          candidates: [
            {
              title: 'Possible package',
              domain: 'example.org',
              url: 'https://example.org/item',
              confirmed: false,
            },
          ],
        }),
      ),
  )
  render(
    <CatalogLookup
      draft={{ name: 'Manual', barcode: '036000291452' }}
      workspace={demoData()}
      apply={apply}
      onSourceUrl={source}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Look up barcode' }))
  await screen.findByText(/No confirmed/)
  fireEvent.click(screen.getByRole('button', { name: 'Search the internet' }))
  await screen.findByText('Possible package')
  fireEvent.click(screen.getByRole('button', { name: 'Use this product page' }))
  expect(apply).toHaveBeenCalledWith({
    productSourceUrl: 'https://example.org/item',
  })
  expect(source).toHaveBeenCalledWith('https://example.org/item')
})
it('offers selective updates without automatically changing the draft or saving', async () => {
  const apply = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        version: 1,
        updates: [{ ...result, ingredientId: 'saved' }],
      }),
    ),
  )
  render(
    <CatalogUpdates
      draft={{
        id: 'saved',
        name: 'My override',
        catalogSource: { itemId: result.id, revisionId: 'old' },
      }}
      apply={apply}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Check catalog updates' }))
  await screen.findByText(/Catalog update available/)
  expect(apply).not.toHaveBeenCalled()
  expect(screen.getByRole('checkbox', { name: /Name:/ })).not.toBeChecked()
})
it('previews only allowed contribution fields and requires explicit sharing consent', async () => {
  const fetch = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
    async () => Response.json({ version: 1, submitted: true }),
  )
  vi.stubGlobal('fetch', fetch)
  render(
    <CatalogContribution
      draft={{
        name: 'Flour',
        brand: 'Mill',
        usedAs: 'ingredient',
        notes: 'Private note',
        vendor: 'Private vendor',
        price: 50,
        imageAssetId: 'private-photo',
      }}
    />,
  )
  fireEvent.click(screen.getByText('Suggest a catalog product or correction'))
  fireEvent.click(screen.getByRole('button', { name: 'Preview shared fields' }))
  expect(screen.queryByText('Private note')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Submit for review' }),
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(
    JSON.parse(String(fetch.mock.calls[0]?.[1]?.body || '{}')).snapshot.fields,
  ).toEqual({ name: 'Flour', brand: 'Mill' })
})
