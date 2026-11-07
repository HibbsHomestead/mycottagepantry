import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/package-photo', async (original) => ({
  ...(await original<typeof import('@/lib/package-photo')>()),
  preparePackagePhoto: vi.fn(
    async () => new Blob(['prepared jpeg'], { type: 'image/jpeg' }),
  ),
}))
import { PackagePhotoImport } from './package-photo-import'
import { preparePackagePhoto } from '@/lib/package-photo'
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
function urls() {
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:synthetic'),
      revokeObjectURL: vi.fn(),
    }),
  )
}
it('reads back alone in one request, retries without clearing the draft, and releases local previews on close', async () => {
  urls()
  const apply = vi.fn(),
    fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: 'Reader busy' }, { status: 503 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          fields: [
            {
              field: 'brand',
              value: 'Package brand',
              photoId: 'back',
              quote: 'Package brand',
              uncertain: false,
            },
          ],
          warnings: [],
          usage: { inputTokens: 4000, outputTokens: 1000 },
        }),
      )
  vi.stubGlobal('fetch', fetch)
  const { unmount } = render(
    <PackagePhotoImport
      draft={{ name: 'Manual flour', imageAssetId: 'existing' }}
      apply={apply}
    />,
  )
  fireEvent.click(screen.getByText('Read package photos (optional)'))
  fireEvent.change(screen.getByLabelText('Back / label photo'), {
    target: {
      files: [new File(['photo'], 'back.jpg', { type: 'image/jpeg' })],
    },
  })
  await screen.findByAltText('Back / label photo preview')
  fireEvent.click(screen.getByRole('button', { name: 'Extract from photos' }))
  await screen.findByText('Reader busy')
  expect(apply).not.toHaveBeenCalled()
  expect(screen.getByAltText('Back / label photo preview')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Extract from photos' }))
  await screen.findByRole('region', { name: 'Review imported fields' })
  expect(apply).not.toHaveBeenCalled()
  expect(fetch.mock.calls[1][1].body.has('back')).toBe(true)
  expect(fetch.mock.calls[1][1].body.has('front')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Apply selected values' }))
  expect(apply.mock.calls[0][0]).toEqual({ brand: 'Package brand' })
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic')
})
it('ignores a late extraction result after removal and never changes existing manual images', async () => {
  urls()
  let finish!: (res: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((resolve) => (finish = resolve))),
  )
  const apply = vi.fn()
  render(
    <PackagePhotoImport
      draft={{ name: 'Manual', imageAssetId: 'keep' }}
      apply={apply}
    />,
  )
  fireEvent.click(screen.getByText('Read package photos (optional)'))
  fireEvent.change(screen.getByLabelText('Front photo'), {
    target: {
      files: [new File(['photo'], 'front.jpg', { type: 'image/jpeg' })],
    },
  })
  await screen.findByAltText('Front photo preview')
  fireEvent.click(screen.getByRole('button', { name: 'Extract from photos' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove Front photo' }))
  finish(Response.json({ fields: [], warnings: [] }))
  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: 'Review imported fields' }),
    ).not.toBeInTheDocument(),
  )
  expect(apply).not.toHaveBeenCalled()
  expect(URL.revokeObjectURL).toHaveBeenCalled()
})
it('offers explicit rotation using the original phone photo', async () => {
  urls()
  render(<PackagePhotoImport draft={{}} apply={vi.fn()} />)
  fireEvent.click(screen.getByText('Read package photos (optional)'))
  const file = new File(['phone'], 'phone.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByLabelText('Front photo'), {
    target: { files: [file] },
  })
  await screen.findByAltText('Front photo preview')
  fireEvent.click(screen.getByRole('button', { name: 'Rotate Front photo' }))
  await waitFor(() =>
    expect(preparePackagePhoto).toHaveBeenLastCalledWith(file, 1),
  )
})
