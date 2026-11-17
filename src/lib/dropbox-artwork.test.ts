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
