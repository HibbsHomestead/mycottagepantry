import { serverEnvironment } from './runtime-environment'
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { z } from 'zod'
import {
  AdminError,
  hasRecentAdminVerification,
  audit,
  hash,
  type AdminClient,
} from './platform-admin-core'
import type { AdminMetadata } from '../../src/lib/platform-admin-types'

function encryptionKey() {
  const value = serverEnvironment('ADMIN_MFA_ENCRYPTION_KEY')
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new AdminError(
      503,
      'MFA_SETUP_UNAVAILABLE',
      'Authenticator setup is unavailable. Password confirmation remains available for accounts without an enrolled authenticator.',
    )
  return Buffer.from(value, 'hex')
}
export function totpConfigured() {
  return /^[a-f0-9]{64}$/i.test(serverEnvironment('ADMIN_MFA_ENCRYPTION_KEY'))
}
export function sealSecret(
  secret: Buffer,
  identity: string,
  purpose = 'admin-totp',
) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  cipher.setAAD(Buffer.from(purpose + ':v1:' + identity))
  const encrypted = Buffer.concat([cipher.update(secret), cipher.final()])
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.')
}
export function openSecret(
  value: string,
  identity: string,
  purpose = 'admin-totp',
) {
  const [version, iv, tag, data] = value.split('.')
  if (version !== 'v1') throw new Error('Unsupported encrypted MFA record')
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(iv, 'base64url'),
  )
  decipher.setAAD(Buffer.from(purpose + ':v1:' + identity))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ])
}
export function base32(secret: Buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0,
    value = 0,
    result = ''
  for (const byte of secret) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      result += alphabet[(value >>> bits) & 31]
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31]
  return result
}
export function totpCode(secret: Buffer, step: number, digits = 6) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const mac = createHmac('sha1', secret).update(counter).digest()
  const offset = mac[mac.length - 1] & 15
  return String(
    (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits,
  ).padStart(digits, '0')
}
export function acceptedStep(
  secret: Buffer,
  code: string,
  lastStep: number,
  now = Date.now(),
) {
  if (!/^\d{6}$/.test(code)) return null
  const current = Math.floor(now / 30000)
  // Highest matching step is recorded atomically to reject replay, including skew.
  for (const step of [current + 1, current, current - 1]) {
    if (
      step > lastStep &&
      timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code))
    )
      return step
  }
  return null
}
async function recoveryCodes(c: AdminClient, identity: string) {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(16).toString('hex').match(/.{4}/g)!.join('-'),
  )
  await c.query('DELETE FROM platform_recovery_codes WHERE identity_id=$1', [
    identity,
  ])
  for (const code of codes)
    await c.query(
      'INSERT INTO platform_recovery_codes(identity_id,code_hash) VALUES($1,$2)',
      [identity, hash(identity + ':' + code.replaceAll('-', ''))],
    )
  return codes
}
/** Requires recent server-verified administrator authentication. */
export async function afterTotpVerification(
  c: AdminClient,
  session: AdminMetadata,
  purpose: string,
  reference: string,
) {
  const identity = session.identity_id
  if (!hasRecentAdminVerification(session))
    throw new AdminError(
      403,
      'MFA_REQUIRED',
      'Verify your administrator authentication before changing security settings.',
    )
  const row = (
    await c.query(
      'SELECT * FROM platform_totp WHERE identity_id=$1 FOR UPDATE',
      [identity],
    )
  ).rows[0]
  if (purpose === 'totp-enroll') {
    if (row?.enabled_at)
      throw new AdminError(
        409,
        'ALREADY_ENROLLED',
        'Authenticator codes are already enabled. Verify your enrolled authenticator or recovery code before removing them.',
      )
    const secret = randomBytes(20)
    await c.query(
      `INSERT INTO platform_totp(identity_id,pending_ciphertext,pending_session,pending_until) VALUES($1,$2,$3,NOW()+INTERVAL '5 minutes')
      ON CONFLICT(identity_id) DO UPDATE SET pending_ciphertext=EXCLUDED.pending_ciphertext,pending_session=EXCLUDED.pending_session,pending_until=EXCLUDED.pending_until`,
      [identity, sealSecret(secret, identity), session.token_hash],
    )
    await audit(
      c,
      identity,
      'totp_enrollment_started',
      identity,
      'success',
      reference,
    )
    const encoded = base32(secret)
    return {
      stage: 'totp_setup',
      secret: encoded,
      uri: `otpauth://totp/${encodeURIComponent('Cottage Pantry Admin:' + session.identity_email)}?secret=${encoded}&issuer=Cottage%20Pantry%20Admin&algorithm=SHA1&digits=6&period=30`,
    }
  }
  if (!row?.enabled_at)
    throw new AdminError(
      409,
      'NOT_ENROLLED',
      'Authenticator codes are not enabled.',
    )
  if (purpose === 'totp-remove') {
    await c.query('DELETE FROM platform_totp WHERE identity_id=$1', [identity])
    // Revoke other sessions without invalidating this freshly verified session.
    await c.query(
      'DELETE FROM platform_sessions WHERE identity_id=$1 AND token_hash<>$2',
      [identity, session.token_hash],
    )
    await audit(c, identity, 'totp_removed', identity, 'success', reference)
    return { stage: 'totp_removed' }
  }
  const codes = await recoveryCodes(c, identity)
  await audit(
    c,
    identity,
    'totp_recovery_regenerated',
    identity,
    'success',
    reference,
  )
  return { stage: 'recovery_codes', recoveryCodes: codes }
}
export async function totpAction(
  c: AdminClient,
  session: AdminMetadata,
  action: string,
  input: unknown,
  reference: string,
) {
  const identity = session.identity_id
  if (action === 'totp-cancel') {
    if (!hasRecentAdminVerification(session))
      throw new AdminError(
        403,
        'MFA_REQUIRED',
        'An authenticated session is required.',
      )
    await c.query(
      'UPDATE platform_totp SET pending_ciphertext=NULL,pending_session=NULL,pending_until=NULL WHERE identity_id=$1 AND pending_session=$2',
      [identity, session.token_hash],
    )
    await audit(
      c,
      identity,
      'totp_enrollment_canceled',
      identity,
      'success',
      reference,
    )
    return { stage: 'totp_canceled' }
  }
  const { code } = z
    .object({ code: z.string().min(1).max(80) })
    .strict()
    .parse(input)
  const row = (
    await c.query(
      'SELECT * FROM platform_totp WHERE identity_id=$1 FOR UPDATE',
      [identity],
    )
  ).rows[0]
  let valid = false
  if (action === 'totp-confirm') {
    if (
      !hasRecentAdminVerification(session) ||
      !row?.pending_ciphertext ||
      row.pending_session !== session.token_hash ||
      Date.parse(row.pending_until) <= Date.now()
    )
      throw new AdminError(
        403,
        'SETUP_EXPIRED',
        'Authenticator setup expired or belongs to another session. Confirm your administrator authentication to start again.',
      )
    const step = acceptedStep(
      openSecret(row.pending_ciphertext, identity),
      code,
      -1,
    )
    if (step !== null && !row.enabled_at) {
      await c.query(
        'UPDATE platform_totp SET secret_ciphertext=pending_ciphertext,enabled_at=NOW(),last_step=$2,pending_ciphertext=NULL,pending_session=NULL,pending_until=NULL WHERE identity_id=$1',
        [identity, step],
      )
      await c.query(
        'DELETE FROM platform_sessions WHERE identity_id=$1 AND token_hash<>$2',
        [identity, session.token_hash],
      )
      const codes = await recoveryCodes(c, identity)
      await audit(c, identity, 'totp_enrolled', identity, 'success', reference)
      return { stage: 'recovery_codes', recoveryCodes: codes }
    }
  } else if (action === 'totp-verify' && row?.enabled_at) {
    const step = acceptedStep(
      openSecret(row.secret_ciphertext, identity),
      code,
      Number(row.last_step),
    )
    if (step !== null) {
      await c.query(
        'UPDATE platform_totp SET last_step=$2 WHERE identity_id=$1',
        [identity, step],
      )
      valid = true
    }
  } else if (
    action === 'totp-recover' &&
    row?.enabled_at &&
    /^[a-fA-F0-9-]{32,39}$/.test(code)
  ) {
    const used = await c.query(
      'UPDATE platform_recovery_codes SET used_at=NOW() WHERE identity_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash',
      [identity, hash(identity + ':' + code.replaceAll('-', '').toLowerCase())],
    )
    valid = used.rows.length === 1
  }
  await audit(
    c,
    identity,
    action === 'totp-recover'
      ? 'totp_recovery_used'
      : action === 'totp-confirm'
        ? 'totp_enrollment_confirmation'
        : 'totp_verification',
    identity,
    valid ? 'success' : 'denied',
    reference,
  )
  return valid
    ? { stage: 'authenticated' }
    : {
        stage: 'verification_failed',
        error: 'The code is invalid, expired, or already used. Try a new code.',
      }
}
