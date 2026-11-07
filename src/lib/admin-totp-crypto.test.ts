// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  acceptedStep,
  base32,
  openSecret,
  sealSecret,
  totpCode,
} from '../../netlify/lib/platform-admin-totp'
afterEach(() => vi.unstubAllGlobals())
it('matches RFC 6238 SHA1 test vectors', () => {
  const secret = Buffer.from('12345678901234567890') // published RFC test value
  for (const [seconds, expected] of [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ] as const)
    expect(totpCode(secret, Math.floor(seconds / 30), 8)).toBe(expected)
  expect(base32(Buffer.from('foobar'))).toBe('MZXW6YTBOI')
})
it('accepts only the bounded skew window and rejects replay and malformed input', () => {
  const secret = randomBytes(20),
    now = 1234567890000,
    step = Math.floor(now / 30000)
  for (const delta of [-1, 0, 1])
    expect(acceptedStep(secret, totpCode(secret, step + delta), -1, now)).toBe(
      step + delta,
    )
  expect(acceptedStep(secret, totpCode(secret, step - 2), -1, now)).toBeNull()
  expect(acceptedStep(secret, totpCode(secret, step), step, now)).toBeNull()
  expect(acceptedStep(secret, 'invalid', -1, now)).toBeNull()
})
it('encrypts with unique nonces, binds ciphertext to identity, detects tampering and fails without a key', () => {
  let key = randomBytes(32).toString('hex')
  vi.stubGlobal('Netlify', { env: { get: () => key } })
  const secret = randomBytes(20)
  const encrypted = sealSecret(secret, 'owner')
  expect(encrypted).not.toBe(sealSecret(secret, 'owner'))
  expect(openSecret(encrypted, 'owner')).toEqual(secret)
  expect(() => openSecret(encrypted, 'other')).toThrow()
  const parts = encrypted.split('.')
  parts[3] = Buffer.alloc(20).toString('base64url')
  expect(() => openSecret(parts.join('.'), 'owner')).toThrow()
  key = ''
  expect(() => sealSecret(secret, 'owner')).toThrow()
})
