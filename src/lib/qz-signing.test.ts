// @vitest-environment node
import { it, expect, vi, afterEach } from 'vitest'
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto'
import { signQzCall } from '../../netlify/lib/qz-print'
afterEach(() => vi.unstubAllEnvs())
it('fails explicitly without configured credentials', () => {
  vi.stubEnv('QZ_CERTIFICATE', '')
  vi.stubEnv('QZ_PRIVATE_KEY', '')
  expect(() => signQzCall('printers.find', { query: null })).toThrow(
    /not configured/,
  )
})
it('signs exactly the constructed QZ request with SHA256 and SHA512', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  })
  vi.stubEnv('QZ_CERTIFICATE', 'test public certificate')
  vi.stubEnv(
    'QZ_PRIVATE_KEY',
    privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  )
  const result = signQzCall('printers.find', { query: null })
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        call: 'printers.find',
        params: result.params,
        timestamp: result.timestamp,
      }),
    )
    .digest('hex')
  expect(
    createVerify('SHA512')
      .update(digest)
      .verify(publicKey, result.signature, 'base64'),
  ).toBe(true)
  expect(
    createVerify('SHA512')
      .update(digest + 'tampered')
      .verify(publicKey, result.signature, 'base64'),
  ).toBe(false)
})
