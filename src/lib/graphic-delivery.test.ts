// @vitest-environment node
import { expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { deliverGraphic } from '../../netlify/lib/graphic-delivery'

it('retains originals, caches old-upload variants and revalidates without reading files', async () => {
  const original = new Uint8Array(
    await sharp({
      create: { width: 1600, height: 900, channels: 4, background: '#ad7951' },
    })
      .png()
      .toBuffer(),
  ).buffer
  const files = new Map([['oven/photo', original]])
  const store = {
    get: vi.fn(async (key: string) => files.get(key) || null),
    set: vi.fn(async (key: string, value: ArrayBuffer) => {
      files.set(key, value)
    }),
  }
  const args = {
    org: 'oven',
    asset: { id: 'photo', fileType: 'image/png' },
    store,
  }
  const request = new Request(
    'https://example.invalid/api/workspace?asset=photo&imageWidth=480',
  )
  const first = await deliverGraphic({ ...args, request })
  expect(first.headers.get('cache-control')).toBe('private, no-cache')
  expect(first.headers.get('vary')).toBe('Cookie, Authorization')
  const preview = await first.arrayBuffer()
  expect((await sharp(Buffer.from(preview)).metadata()).width).toBe(480)
  expect(store.set).toHaveBeenCalledOnce()
  store.get.mockClear()
  const cached = await deliverGraphic({ ...args, request })
  expect(await cached.arrayBuffer()).toEqual(preview)
  expect(store.get).toHaveBeenCalledTimes(1)
  store.get.mockClear()
  const conditional = await deliverGraphic({
    ...args,
    request: new Request(request, {
      headers: { 'if-none-match': first.headers.get('etag')! },
    }),
  })
  expect(conditional.status).toBe(304)
  expect(store.get).not.toHaveBeenCalled()
  const replacement = await deliverGraphic({
    ...args,
    asset: { ...args.asset, updatedAt: 'new' },
    request: new Request(request, {
      headers: { 'if-none-match': first.headers.get('etag')! },
    }),
  })
  expect(replacement.status).toBe(200)
  expect(replacement.headers.get('etag')).not.toBe(first.headers.get('etag'))
  const full = await deliverGraphic({
    ...args,
    request: new Request('https://example.invalid/?asset=photo'),
  })
  expect(await full.arrayBuffer()).toEqual(original)
  expect(files.get('oven/photo')).toBe(original)
  await expect(
    deliverGraphic({ ...args, org: 'other', request }),
  ).rejects.toThrow('unavailable')
})
