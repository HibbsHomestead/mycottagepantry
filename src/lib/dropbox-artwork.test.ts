import { afterEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import {
  dropboxSelection,
  dropboxThumbnailUrl,
  prepareDropboxPreview,
  validateDropboxCopy,
  dropboxAssetIdentity,
} from '../../netlify/lib/dropbox-artwork'
import { authorizeMockupProduct } from '../../netlify/lib/mockup-handler'
const thumbnail = 'https://www.dropbox.com/temp_thumb/token?size=large'
afterEach(() => vi.unstubAllGlobals())
describe('Dropbox bounded copy boundary (synthetic provider fixtures)', () => {
  it('retains provenance without temporary links', () => {
    expect(
      dropboxSelection({
        id: 'id:abc',
        name: 'white.png',
        bytes: 100123456,
        thumbnailLink: thumbnail,
      }),
    ).toEqual({ id: 'id:abc', name: 'white.png', bytes: 100123456 })
    for (const v of [
      { id: 'x', name: 'a.png', bytes: 1 },
      { id: 'id:a', name: 'a.pdf', bytes: 1 },
      { id: 'id:a', name: 'a.png', bytes: -1 },
    ])
      expect(() => dropboxSelection(v)).toThrow()
  })
  it('only accepts provider thumbnail paths, including every redirect', async () => {
    for (const url of [
      'https://evil.test/temp_thumb/a',
      'http://www.dropbox.com/temp_thumb/a',
      'https://www.dropbox.com/s/a.png',
      'https://www.dropbox.com:444/temp_thumb/a',
      'https://user@www.dropbox.com/temp_thumb/a',
    ])
      expect(() => dropboxThumbnailUrl(url)).toThrow()
    const url = dropboxThumbnailUrl(thumbnail, true)
    expect(url.searchParams.get('mode')).toBe('fit')
    expect(url.searchParams.get('bounding_box')).toBe('2048')
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://evil.test/private' },
      }),
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(prepareDropboxPreview(thumbnail)).rejects.toThrow(
      'Preview unavailable',
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('preserves supplied white artwork alpha and aspect ratio', async () => {
    const png = await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(png)))
    const p = await prepareDropboxPreview(thumbnail)
    expect(p).toMatchObject({
      width: 320,
      height: 180,
      hasAlpha: true,
      format: 'image/png',
    })
    const raw = await sharp(Buffer.from(p.data, 'base64')).raw().toBuffer()
    expect([...raw.subarray(0, 4)]).toEqual([255, 255, 255, 128])
  })
  it.each(['jpeg', 'webp'] as const)(
    'normalizes bounded %s previews to PNG',
    async (format) => {
      const image = await sharp({
        create: { width: 50, height: 80, channels: 3, background: '#7e825e' },
      })
        .toFormat(format)
        .toBuffer()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(image)))
      expect(await prepareDropboxPreview(thumbnail)).toMatchObject({
        width: 50,
        height: 80,
        format: 'image/png',
      })
    },
  )
  it('rejects unavailable, over-byte and over-dimension previews', async () => {
    for (const response of [
      new Response(null, { status: 403 }),
      new Response('bad image'),
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
      await expect(prepareDropboxPreview(thumbnail)).rejects.toThrow(
        'Preview unavailable',
      )
    }
    const png = await sharp({
      create: { width: 2049, height: 1, channels: 4, background: '#fff' },
    })
      .png()
      .toBuffer()
    await expect(validateDropboxCopy(png)).rejects.toThrow('2048')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(png)))
    await expect(prepareDropboxPreview(thumbnail)).rejects.toThrow(
      'processing limits',
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new Uint8Array(4_000_001))),
    )
    await expect(prepareDropboxPreview(thumbnail)).rejects.toThrow(
      'processing limits',
    )
  })
  it('makes retries stable while isolating businesses and changed copies', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const a = dropboxAssetIdentity('a', 'p', 'id:x', bytes)
    expect(dropboxAssetIdentity('a', 'p', 'id:x', bytes)).toEqual(a)
    expect(dropboxAssetIdentity('b', 'p', 'id:x', bytes).id).not.toBe(a.id)
    expect(
      dropboxAssetIdentity('a', 'p', 'id:x', new Uint8Array([4])).id,
    ).not.toBe(a.id)
  })
  it('authorizes the current business product and role', () => {
    const state = { products: [{ id: 'mine', name: 'Tote' }] }
    const url = new URL('https://example.test/api/workspace')
    expect(() =>
      authorizeMockupProduct('other-business', state, 'Owner', url),
    ).toThrow('this business')
    expect(() => authorizeMockupProduct('mine', state, 'Member', url)).toThrow(
      'Owner or Manager',
    )
    expect(authorizeMockupProduct('mine', state, 'Owner', url).id).toBe('mine')
  })
})

it('reports safe failure stages and numeric retrieval evidence', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('denied', { status: 403 })),
  )
  await expect(prepareDropboxPreview(thumbnail)).rejects.toMatchObject({
    diagnostics: { stage: 'preview retrieval', httpStatus: 403 },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('not an image')),
  )
  await expect(prepareDropboxPreview(thumbnail)).rejects.toMatchObject({
    diagnostics: {
      stage: 'response format',
      httpStatus: 200,
      retrievedBytes: 12,
    },
  })
  await expect(
    prepareDropboxPreview(undefined as unknown as string),
  ).rejects.toMatchObject({
    diagnostics: { stage: 'preview selection' },
  })
})

it('reports exact prepared size and bounded decoded dimensions', async () => {
  const image = await sharp({
    create: { width: 200, height: 100, channels: 4, background: '#ffffff80' },
  })
    .png()
    .toBuffer()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(image)))
  const preview = await prepareDropboxPreview(thumbnail)
  expect(preview.diagnostics).toMatchObject({
    stage: 'ready for visual review',
    httpStatus: 200,
    retrievedBytes: image.length,
    width: 200,
    height: 100,
    preparedBytes: Buffer.from(preview.data, 'base64').length,
  })
  expect(preview.diagnostics.preparationMs).toBeGreaterThanOrEqual(0)
})

it('distinguishes URL, redirect, byte, pixel and decode failures without retaining source links', async () => {
  const failure = async (url = thumbnail) => {
    try {
      await prepareDropboxPreview(url)
    } catch (e) {
      return e as Error & {
        diagnostics: { stage: string; retrievedBytes?: number }
      }
    }
    throw new Error('Expected preview rejection')
  }
  expect(
    (await failure('https://untrusted.test/private')).diagnostics.stage,
  ).toBe('URL validation')
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: 'https://untrusted.test/private' },
        }),
      ),
  )
  const redirect = await failure()
  expect(redirect.diagnostics.stage).toBe('redirect validation')
  expect(JSON.stringify(redirect)).not.toMatch(/https:|private|token/)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(new Uint8Array(4_000_001))),
  )
  expect((await failure()).diagnostics).toMatchObject({
    stage: 'retrieved preview byte limit',
    retrievedBytes: 4_000_001,
  })
  const png = await sharp({
    create: { width: 2049, height: 1, channels: 4, background: '#fff' },
  })
    .png()
    .toBuffer()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(png)))
  expect((await failure()).diagnostics.stage).toBe(
    'decoded preview pixel limit',
  )
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(png.subarray(0, 33))),
  )
  // Use a bounded IHDR from a valid image so full decoding is the failing stage.
  const bounded = await sharp({
    create: { width: 10, height: 10, channels: 4, background: '#fff' },
  })
    .png()
    .toBuffer()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(bounded.subarray(0, 33))),
  )
  expect((await failure()).diagnostics.stage).toBe('image decode')
})
