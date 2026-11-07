import type { IncomingMessage } from 'node:http'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib'

export const RECIPE_PAGE_BYTES = 1024 * 1024
export const PRODUCT_PAGE_BYTES = 4 * 1024 * 1024

/** Cap both the encoded download and the decompressed body. Never return a prefix. */
export async function readPageResponse(res: IncomingMessage, cap: number) {
  const tooLarge = () =>
    new Error(
      `Recipe page exceeds the ${cap / (1024 * 1024)} MiB safety limit. Paste its recipe text instead.`,
    )
  const length = res.headers['content-length']
  if (length && /^\d+$/.test(length) && Number(length) > cap) {
    res.destroy()
    throw tooLarge()
  }
  const encoding = String(res.headers['content-encoding'] || 'identity')
    .trim()
    .toLowerCase()
  const decoder =
    encoding === 'gzip'
      ? createGunzip()
      : encoding === 'deflate'
        ? createInflate()
        : encoding === 'br'
          ? createBrotliDecompress()
          : encoding === 'identity'
            ? null
            : undefined
  if (decoder === undefined) {
    res.destroy()
    throw new Error(
      'Unsupported page compression. Paste product text or enter details manually.',
    )
  }
  let downloaded = 0
  const limiter = (wire = false) => {
    let size = 0
    return new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        if (wire) downloaded = size
        callback(size > cap ? tooLarge() : null, size > cap ? undefined : chunk)
      },
    })
  }
  const chunks: Buffer[] = []
  const collect = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk)
      callback()
    },
  })
  const stages = decoder
    ? [res, limiter(true), decoder, limiter(), collect]
    : [res, limiter(true), collect]
  try {
    await pipeline(stages)
  } catch (error) {
    if (error instanceof Error && /safety limit/.test(error.message))
      throw error
    throw new Error(
      'The page response was incomplete or malformed. Retry or paste product text instead.',
      { cause: error },
    )
  }
  if (length && /^\d+$/.test(length) && downloaded !== Number(length))
    throw new Error(
      'The page response was incomplete or malformed. Retry or paste product text instead.',
    )
  return Buffer.concat(chunks)
}
