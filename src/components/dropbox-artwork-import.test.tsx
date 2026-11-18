import { afterEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DropboxArtworkImport } from './dropbox-artwork-import'

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.Dropbox
})
it('requires explicit review on both backgrounds, exposes safe measurements and keeps original size informational', async () => {
  const user = userEvent.setup()
  window.Dropbox = {
    isBrowserSupported: () => true,
    choose: (options) =>
      options.success([
        {
          id: 'id:test',
          name: 'Large.png',
          bytes: 30_950_000,
          thumbnailLink: 'https://www.dropbox.com/temp_thumb/private',
        },
      ]),
  }
  const fetcher = vi.fn(async () =>
    Response.json({
      data: 'eA==',
      width: 200,
      height: 100,
      bytes: 12345,
      hasAlpha: true,
      diagnostics: {
        stage: 'ready for visual review',
        httpStatus: 200,
        retrievedBytes: 15000,
        preparedBytes: 12345,
        width: 200,
        height: 100,
        preparationMs: 22,
      },
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  render(
    <DropboxArtworkImport
      productId="p"
      disabled={false}
      updated={false}
      onBusy={vi.fn()}
      onImported={vi.fn()}
    />,
  )
  const choose = await screen.findByRole('button', {
    name: 'Choose from Dropbox',
  })
  await user.click(choose)
  await screen.findByRole('heading', { name: 'Review artwork' })
  expect(screen.getByText(/30.95 MB/)).toBeVisible()
  expect(screen.getByText(/Prepared-copy bytes: 12345/)).toBeVisible()
  expect(screen.getByText(/not guaranteed to expire/)).toBeVisible()
  expect(document.body.textContent).not.toContain('https://www.dropbox.com')
  const save = screen.getByRole('button', { name: 'Save mockup copy' })
  const approve = screen.getByRole('checkbox', {
    name: 'I approve this copy for mockups.',
  })
  expect(save).toBeDisabled()
  expect(approve).toBeDisabled()
  await user.click(
    screen.getByRole('checkbox', { name: /I reviewed.*dark background/ }),
  )
  expect(approve).toBeDisabled()
  await user.click(
    screen.getByRole('button', { name: 'Use light review background' }),
  )
  await user.click(
    screen.getByRole('checkbox', { name: /I reviewed.*light background/ }),
  )
  await user.click(approve)
  expect(save).toBeEnabled()
  expect(fetcher).toHaveBeenCalledTimes(1)
  const request = fetcher.mock.calls[0] as unknown as [string, RequestInit]
  expect(JSON.parse(String(request[1].body)).selection).toEqual({
    id: 'id:test',
    name: 'Large.png',
    bytes: 30_950_000,
  })
})
