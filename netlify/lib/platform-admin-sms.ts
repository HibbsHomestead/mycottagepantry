import { serverEnvironment as env } from './runtime-environment'
import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { AdminError, audit, type AdminClient } from './platform-admin-core'
import { openSecret, sealSecret, totpConfigured } from './platform-admin-totp'
import type { AdminMetadata } from '../../src/lib/platform-admin-types'

/**
 * Password + SMS sign-in through Twilio Verify. Twilio generates, delivers,
 * expires and limits the codes; this module binds each verification to one
 * pending admin session and identity. Nothing here logs codes, numbers or
 * provider credentials. Sending stays OFF until the owner sets
 * ADMIN_SMS_ENABLED=true together with server-only Twilio credentials.
 */
export const SMS_COOLDOWN_SECONDS = 30
export const SMS_LOGIN_SENDS = 3
export const SMS_ENROLL_SENDS = 3
export const SMS_ATTEMPTS = 5
const AAD = 'admin-sms'

export function smsConfigured() {
  return (
    env('ADMIN_SMS_ENABLED') === 'true' &&
    /^SK[0-9a-f]{32}$/i.test(env('TWILIO_API_KEY_SID')) &&
    env('TWILIO_API_KEY_SECRET').length >= 16 &&
    /^VA[0-9a-f]{32}$/i.test(env('TWILIO_VERIFY_SERVICE_SID')) &&
    totpConfigured()
  )
}
function requireConfigured() {
  if (!smsConfigured())
    throw new AdminError(
      503,
      'SMS_UNAVAILABLE',
      'Text-message verification is not switched on yet. No text was sent. Use your passkey or authenticator code.',
    )
}

/** US/Canada (+1 NANP) only, approved by the owner to limit SMS pumping. */
export function normalizeNanp(input: string) {
  const digits = input.replace(/[\s().-]/g, '')
  const value = /^\d{10}$/.test(digits)
    ? '+1' + digits
    : /^1\d{10}$/.test(digits)
      ? '+' + digits
      : digits
  return /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(value) ? value : null
}
export function maskPhone(e164: string) {
  return `+1 •••-•••-${e164.slice(-4)}`
}
function destinationKey(e164: string) {
  // Keyed hash: rate-limit rows never contain a reversible phone number.
  return createHmac(
    'sha256',
    Buffer.from(env('ADMIN_MFA_ENCRYPTION_KEY'), 'hex'),
  )
    .update('sms-destination:' + e164)
    .digest('hex')
}

type TwilioResult = {
  status: number
  body: { status?: string; sid?: string; code?: number; valid?: boolean }
}
async function twilio(path: string, form: Record<string, string>) {
  const service = env('TWILIO_VERIFY_SERVICE_SID')
  let response: Response
  try {
    response = await fetch(
      `https://verify.twilio.com/v2/Services/${service}/${path}`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization:
            'Basic ' +
            Buffer.from(
              env('TWILIO_API_KEY_SID') + ':' + env('TWILIO_API_KEY_SECRET'),
            ).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(form),
      },
    )
  } catch {
    throw new AdminError(
      502,
      'SMS_PROVIDER_UNREACHABLE',
      'The text-message service could not be reached. No code was confirmed. Wait a moment and try again, or use your passkey.',
    )
  }
  let body: TwilioResult['body'] = {}
  try {
    body = await response.json()
  } catch {
    /* Provider bodies are never echoed. */
  }
  return { status: response.status, body } satisfies TwilioResult
}

/** Maps Twilio Verify send errors to fixed, actionable messages. */
export function sendFailure(result: TwilioResult) {
  const code = result.body.code
  if (code === 60200 || code === 21211)
    return new AdminError(
      400,
      'SMS_NUMBER_INVALID',
      'The provider rejected this phone number. Check the number and try again.',
    )
  if (code === 60205)
    return new AdminError(
      400,
      'SMS_NOT_SUPPORTED',
      'This number cannot receive texts (for example, a landline). Use a mobile number.',
    )
  if (code === 60203 || code === 20429 || result.status === 429)
    return new AdminError(
      429,
      'SMS_PROVIDER_LIMIT',
      'The text-message provider paused sends to this number. Wait 10 minutes, or use your passkey.',
    )
  if (code === 60410 || code === 60605 || code === 21408 || code === 60220)
    return new AdminError(
      403,
      'SMS_DESTINATION_BLOCKED',
      'The provider blocked texts to this destination (fraud or geographic protection). Use your passkey, or contact the platform owner.',
    )
  if (
    result.status === 401 ||
    result.status === 403 ||
    code === 20003 ||
    code === 20404
  )
    return new AdminError(
      503,
      'SMS_PROVIDER_CONFIGURATION',
      'Text-message verification is misconfigured on the server. No text was sent. Use your passkey; the owner must check the Twilio settings.',
    )
  return new AdminError(
    502,
    'SMS_DELIVERY_FAILED',
    'The text could not be sent. No code was issued. Try again shortly, or use your passkey.',
  )
}

export class SmsProviderError extends AdminError {
  constructor(
    failure: AdminError,
    public providerCode: number | null,
    public smsAction: string,
    public identity: string,
  ) {
    super(failure.status, failure.code, failure.message)
  }
}
async function startVerification(
  e164: string,
  identity: string,
  action: string,
) {
  const result = await twilio('Verifications', { To: e164, Channel: 'sms' })
  if (result.status === 201 || result.status === 200) {
    if (
      result.body.status === 'pending' &&
      /^VE[0-9a-f]{32}$/i.test(result.body.sid || '')
    )
      return result.body.sid!
  }
  // The caller's transaction rolls back; the gateway audits this separately.
  const failure = sendFailure(result)
  throw new SmsProviderError(
    failure,
    typeof result.body.code === 'number' ? result.body.code : null,
    action,
    identity,
  )
}

type CheckOutcome = 'approved' | 'incorrect' | 'expired' | 'exhausted'
async function checkVerification(sid: string, code: string) {
  const result = await twilio('VerificationCheck', {
    VerificationSid: sid,
    Code: code,
  })
  if (result.status === 200)
    return (
      result.body.status === 'approved' && result.body.valid !== false
        ? 'approved'
        : result.body.status === 'pending'
          ? 'incorrect'
          : 'expired'
    ) as CheckOutcome
  // 20404: approved, canceled, expired or unknown verification (single use).
  if (result.status === 404 || result.body.code === 20404) return 'expired'
  if (result.body.code === 60202 || result.status === 429) return 'exhausted'
  throw new AdminError(
    502,
    'SMS_CHECK_UNAVAILABLE',
    'The code could not be checked right now. It was not accepted. Try again shortly, or use your passkey.',
  )
}
const codeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{4,10}$/),
  })
  .strict()
function cooldownCheck(sentAt: string | null | undefined) {
  if (!sentAt) return
  const wait = Date.parse(sentAt) + SMS_COOLDOWN_SECONDS * 1000 - Date.now()
  if (wait > 0)
    throw new AdminError(
      429,
      'SMS_COOLDOWN',
      `Please wait ${Math.ceil(wait / 1000)} seconds before requesting another text.`,
    )
}
const failureMessage: Record<Exclude<CheckOutcome, 'approved'>, string> = {
  incorrect: 'That code is incorrect. Check the latest text and try again.',
  expired:
    'That code expired, was already used, or was replaced by a newer text. Request a new code.',
  exhausted:
    'Too many incorrect codes. Request a new text, or use your passkey.',
}

/**
 * Keyed destination for rate limiting, resolved before the main transaction
 * so the counter commits even when sending fails.
 */
export async function smsDestinationKey(
  c: AdminClient,
  identity: string,
  action: string,
  input: unknown,
) {
  if (!smsConfigured()) return null
  if (action === 'sms-enroll-send') {
    const phone = (input as { phone?: unknown })?.phone
    const e164 = typeof phone === 'string' ? normalizeNanp(phone) : null
    return e164 ? destinationKey(e164) : null
  }
  const row = (
    await c.query(
      'SELECT phone_ciphertext FROM platform_sms WHERE identity_id=$1 AND verified_at IS NOT NULL',
      [identity],
    )
  ).rows[0]
  return row
    ? destinationKey(openSecret(row.phone_ciphertext, identity, AAD).toString())
    : null
}
async function smsRow(c: AdminClient, identity: string) {
  return (
    await c.query(
      'SELECT * FROM platform_sms WHERE identity_id=$1 FOR UPDATE',
      [identity],
    )
  ).rows[0]
}

/** Masked destination only, shown after password + admin grant verification. */
export async function smsStatus(c: AdminClient, identity: string) {
  const row = (
    await c.query(
      'SELECT phone_masked,verified_at FROM platform_sms WHERE identity_id=$1',
      [identity],
    )
  ).rows[0]
  return {
    smsAvailable: smsConfigured(),
    smsEnabled: !!row?.verified_at,
    smsMasked: row?.verified_at ? (row.phone_masked as string) : null,
  }
}

export async function smsLoginSend(
  c: AdminClient,
  session: AdminMetadata,
  reference: string,
) {
  requireConfigured()
  const identity = session.identity_id
  const row = await smsRow(c, identity)
  if (!row?.verified_at)
    throw new AdminError(
      403,
      'SMS_NOT_ENROLLED',
      'No verified phone is enrolled for text-message sign-in. Use your passkey. A phone can be enrolled only from an authenticated admin session.',
    )
  cooldownCheck(session.sms_sent_at)
  if (session.sms_sends >= SMS_LOGIN_SENDS)
    throw new AdminError(
      429,
      'SMS_SEND_LIMIT',
      'The resend limit for this sign-in was reached. Choose “Use another account” to start over in a few minutes, or use your passkey.',
    )
  const phone = openSecret(row.phone_ciphertext, identity, AAD).toString()
  const sid = await startVerification(phone, identity, 'sms_login_code')
  // Older pending sign-ins for this identity can no longer use a code.
  await c.query(
    'UPDATE platform_sessions SET sms_verification_sid=NULL,sms_until=NULL WHERE identity_id=$1 AND token_hash<>$2',
    [identity, session.token_hash],
  )
  const updated = (
    await c.query(
      `UPDATE platform_sessions SET sms_verification_sid=$2,sms_sent_at=NOW(),sms_sends=sms_sends+1,sms_attempts=0,
      sms_until=LEAST(NOW()+INTERVAL '5 minutes',expires_at) WHERE token_hash=$1 RETURNING sms_until,sms_sends`,
      [session.token_hash, sid],
    )
  ).rows[0]
  await audit(
    c,
    identity,
    'sms_login_code',
    identity,
    'accepted',
    reference,
    null,
    null,
    {
      destination: row.phone_masked,
    },
  )
  return {
    stage: 'sms_sent',
    masked: row.phone_masked,
    expiresAt: updated.sms_until,
    resendAt: new Date(Date.now() + SMS_COOLDOWN_SECONDS * 1000).toISOString(),
    resendsRemaining: SMS_LOGIN_SENDS - updated.sms_sends,
  }
}

/** Returns true only after Twilio approves this session's own verification. */
export async function smsLoginVerify(
  c: AdminClient,
  session: AdminMetadata,
  input: unknown,
  reference: string,
) {
  requireConfigured()
  const { code } = codeSchema.parse(input)
  const identity = session.identity_id
  const row = await smsRow(c, identity)
  let outcome: CheckOutcome = 'expired'
  if (
    row?.verified_at &&
    session.sms_verification_sid &&
    session.sms_until &&
    Date.parse(session.sms_until) > Date.now()
  ) {
    if (session.sms_attempts >= SMS_ATTEMPTS) outcome = 'exhausted'
    else {
      await c.query(
        'UPDATE platform_sessions SET sms_attempts=sms_attempts+1 WHERE token_hash=$1',
        [session.token_hash],
      )
      outcome = await checkVerification(session.sms_verification_sid, code)
    }
  }
  if (outcome !== 'incorrect')
    await c.query(
      'UPDATE platform_sessions SET sms_verification_sid=NULL,sms_until=NULL WHERE token_hash=$1',
      [session.token_hash],
    )
  await audit(
    c,
    identity,
    'sms_verification',
    identity,
    outcome === 'approved' ? 'success' : 'denied:' + outcome,
    reference,
  )
  return outcome === 'approved'
    ? { stage: 'authenticated' as const }
    : {
        stage: 'verification_failed' as const,
        code: 'SMS_' + outcome.toUpperCase(),
        error: failureMessage[outcome],
      }
}

/** Security-change email to the verified Identity address, when email is approved. */
export async function notifySecurityChange(email: string, change: string) {
  if (
    env('SUPPORT_EMAIL_ENABLED') !== 'true' ||
    env('CONTEXT') !== 'production' ||
    !env('SUPPORT_POSTMARK_SERVER_TOKEN') ||
    !env('SUPPORT_VERIFIED_FROM') ||
    !email
  )
    return 'unavailable'
  try {
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: {
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': env('SUPPORT_POSTMARK_SERVER_TOKEN'),
      },
      body: JSON.stringify({
        From: env('SUPPORT_VERIFIED_FROM'),
        To: email,
        Subject: 'Cottage Pantry Admin security change',
        TextBody: `${change}\n\nIf you did not make this change, sign in at https://admin.mycottagepantry.com with your passkey and review Admin sign-in security, then contact the platform owner for audited recovery.\nThis message never contains codes or full phone numbers.`,
        MessageStream: 'outbound',
      }),
    })
    return response.ok ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}

function requireAuthorized(
  row: AdminMetadata | undefined,
  session: AdminMetadata,
) {
  if (
    !session.mfa_at ||
    !row?.authorized_session ||
    row.authorized_session !== session.token_hash ||
    !row.authorized_until ||
    Date.parse(row.authorized_until) <= Date.now()
  )
    throw new AdminError(
      403,
      'FRESH_PASSKEY_REQUIRED',
      'Phone setup expired or belongs to another session. Verify your existing passkey again to continue.',
    )
}

/** Called only after a fresh existing-passkey assertion for the bound purpose. */
export async function afterSmsPasskey(
  c: AdminClient,
  session: AdminMetadata,
  purpose: string,
  reference: string,
) {
  const identity = session.identity_id
  if (!session.mfa_at)
    throw new AdminError(
      403,
      'MFA_REQUIRED',
      'An authenticated admin session is required.',
    )
  const row = await smsRow(c, identity)
  if (purpose === 'sms-enroll') {
    requireConfigured()
    await c.query(
      `INSERT INTO platform_sms(identity_id,authorized_session,authorized_until) VALUES($1,$2,NOW()+INTERVAL '10 minutes')
      ON CONFLICT(identity_id) DO UPDATE SET authorized_session=EXCLUDED.authorized_session,authorized_until=EXCLUDED.authorized_until,
      pending_ciphertext=NULL,pending_masked=NULL,pending_sid=NULL,pending_sent_at=NULL,pending_sends=0,pending_attempts=0`,
      [identity, session.token_hash],
    )
    await audit(
      c,
      identity,
      'sms_enrollment_authorized',
      identity,
      'success',
      reference,
    )
    return {
      stage: 'sms_setup',
      currentMasked: row?.verified_at ? row.phone_masked : null,
    }
  }
  if (!row?.verified_at)
    throw new AdminError(
      409,
      'NOT_ENROLLED',
      'Text-message sign-in is not enrolled.',
    )
  await c.query('DELETE FROM platform_sms WHERE identity_id=$1', [identity])
  await c.query(
    'DELETE FROM platform_sessions WHERE identity_id=$1 AND token_hash<>$2',
    [identity, session.token_hash],
  )
  const notification = await notifySecurityChange(
    session.identity_email,
    `Text-message sign-in to ${row.phone_masked} was removed from your Cottage Pantry Admin account. Your passkey is unchanged.`,
  )
  await audit(
    c,
    identity,
    'sms_removed',
    identity,
    'success',
    reference,
    null,
    { destination: row.phone_masked },
    { destination: null, notification },
  )
  return { stage: 'sms_removed', notification }
}

export async function smsEnrollAction(
  c: AdminClient,
  session: AdminMetadata,
  action: string,
  input: unknown,
  reference: string,
) {
  const identity = session.identity_id
  const row = await smsRow(c, identity)
  if (action === 'sms-enroll-cancel') {
    if (row?.authorized_session === session.token_hash)
      await c.query(
        `UPDATE platform_sms SET authorized_session=NULL,authorized_until=NULL,pending_ciphertext=NULL,pending_masked=NULL,
        pending_sid=NULL,pending_sent_at=NULL,pending_sends=0,pending_attempts=0 WHERE identity_id=$1`,
        [identity],
      )
    await audit(
      c,
      identity,
      'sms_enrollment_canceled',
      identity,
      'success',
      reference,
    )
    return { stage: 'sms_canceled' }
  }
  requireConfigured()
  requireAuthorized(row, session)
  if (action === 'sms-enroll-send') {
    const { phone } = z
      .object({ phone: z.string().trim().min(10).max(24) })
      .strict()
      .parse(input)
    const e164 = normalizeNanp(phone)
    if (!e164)
      throw new AdminError(
        400,
        'SMS_NUMBER_INVALID',
        'Enter a US or Canadian mobile number, for example (555) 201-4567. Other countries are not enabled.',
      )
    if (
      row.verified_at &&
      openSecret(row.phone_ciphertext, identity, AAD).toString() === e164
    )
      throw new AdminError(
        409,
        'SMS_SAME_NUMBER',
        'This number is already your verified sign-in phone.',
      )
    cooldownCheck(row.pending_sent_at)
    if (row.pending_sends >= SMS_ENROLL_SENDS)
      throw new AdminError(
        429,
        'SMS_SEND_LIMIT',
        'The text limit for this setup was reached. Verify your passkey again in a few minutes to restart setup.',
      )
    const sid = await startVerification(e164, identity, 'sms_enrollment_code')
    const masked = maskPhone(e164)
    await c.query(
      `UPDATE platform_sms SET pending_ciphertext=$2,pending_masked=$3,pending_sid=$4,pending_sent_at=NOW(),
      pending_sends=pending_sends+1,pending_attempts=0 WHERE identity_id=$1`,
      [identity, sealSecret(Buffer.from(e164), identity, AAD), masked, sid],
    )
    await audit(
      c,
      identity,
      'sms_enrollment_code',
      identity,
      'accepted',
      reference,
      null,
      null,
      {
        destination: masked,
      },
    )
    return {
      stage: 'sms_enroll_sent',
      masked,
      expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
      resendAt: new Date(
        Date.now() + SMS_COOLDOWN_SECONDS * 1000,
      ).toISOString(),
    }
  }
  // sms-enroll-confirm
  const { code } = codeSchema.parse(input)
  let outcome: CheckOutcome = 'expired'
  if (
    row.pending_sid &&
    row.pending_sent_at &&
    Date.parse(row.pending_sent_at) + 10 * 60000 > Date.now()
  ) {
    if (row.pending_attempts >= SMS_ATTEMPTS) outcome = 'exhausted'
    else {
      await c.query(
        'UPDATE platform_sms SET pending_attempts=pending_attempts+1 WHERE identity_id=$1',
        [identity],
      )
      outcome = await checkVerification(row.pending_sid, code)
    }
  }
  if (outcome !== 'approved') {
    if (outcome !== 'incorrect')
      await c.query(
        'UPDATE platform_sms SET pending_sid=NULL WHERE identity_id=$1',
        [identity],
      )
    await audit(
      c,
      identity,
      'sms_enrollment_confirmation',
      identity,
      'denied:' + outcome,
      reference,
    )
    return {
      stage: 'verification_failed',
      code: 'SMS_' + outcome.toUpperCase(),
      error: failureMessage[outcome],
    }
  }
  const before = row.verified_at ? row.phone_masked : null
  await c.query(
    `UPDATE platform_sms SET phone_ciphertext=pending_ciphertext,phone_masked=pending_masked,verified_at=NOW(),
    authorized_session=NULL,authorized_until=NULL,pending_ciphertext=NULL,pending_masked=NULL,pending_sid=NULL,
    pending_sent_at=NULL,pending_sends=0,pending_attempts=0 WHERE identity_id=$1`,
    [identity],
  )
  // Revoke other sessions without signing out this passkey-verified phone.
  await c.query(
    'DELETE FROM platform_sessions WHERE identity_id=$1 AND token_hash<>$2',
    [identity, session.token_hash],
  )
  const notification = await notifySecurityChange(
    session.identity_email,
    before
      ? `Your Cottage Pantry Admin text-message sign-in phone changed from ${before} to ${row.pending_masked}. Your passkey is unchanged.`
      : `Text-message sign-in to ${row.pending_masked} was enabled for your Cottage Pantry Admin account. Your passkey is unchanged.`,
  )
  await audit(
    c,
    identity,
    before ? 'sms_changed' : 'sms_enrolled',
    identity,
    'success',
    reference,
    'Fresh passkey verification and confirmed text to the new number',
    { destination: before },
    { destination: row.pending_masked, notification },
  )
  return { stage: 'sms_enrolled', masked: row.pending_masked, notification }
}
