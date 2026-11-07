import { z } from 'zod'
import { emailAddress } from '../../src/lib/support'
import {
  SupportError,
  requireSupportAdmin,
  supportAudit,
  type SupportActor,
  type SupportClient,
} from './support-core'
export function supportEmailReadiness(settings: any) {
  const env = globalThis.Netlify?.env
  if (env?.get('SUPPORT_EMAIL_ENABLED') !== 'true')
    return 'Outbound support email is OFF pending owner approval.'
  if (env.get('CONTEXT') !== 'production')
    return 'Outbound support email is blocked outside production.'
  if (env.get('SUPPORT_EMAIL_ORIGIN') !== 'https://mycottagepantry.com')
    return 'The production link domain has not been approved.'
  if (!settings?.enabled)
    return 'Email notifications are paused in platform settings.'
  if (
    !settings.recipient ||
    !settings.recipient_verified_at ||
    settings.pending_recipient
  )
    return 'Confirm the notification recipient using its verified Identity account.'
  if (
    !settings.from_address ||
    settings.from_address !== env.get('SUPPORT_VERIFIED_FROM')
  )
    return 'The sending address must match the server-approved, provider-verified sender.'
  if (!env.get('SUPPORT_POSTMARK_SERVER_TOKEN'))
    return 'The optional Postmark transport is not configured.'
  if ((env.get('SUPPORT_EMAIL_WEBHOOK_SECRET') || '').length < 32)
    return 'An authenticated delivery webhook is required.'
  return null
}
export async function supportSettingsView(
  c: SupportClient,
  actor: SupportActor,
) {
  requireSupportAdmin(actor)
  const { rows } = await c.query(
    "SELECT * FROM support_settings WHERE id='platform'",
  )
  const s = rows[0]
  return {
    recipient: s.recipient || '',
    pendingRecipient: s.pending_recipient || '',
    recipientVerified: !!s.recipient_verified_at,
    fromAddress: s.from_address || '',
    replyTo: s.reply_to || '',
    enabled: s.enabled,
    version: s.version,
    verifiedIdentityEmail: actor.email,
    deliveryBlock: supportEmailReadiness(s),
    senderApproved:
      !!s.from_address &&
      s.from_address === globalThis.Netlify?.env.get('SUPPORT_VERIFIED_FROM'),
  }
}
export async function saveSupportSettings(
  c: SupportClient,
  actor: SupportActor,
  data: any,
) {
  requireSupportAdmin(actor)
  data = z
    .object({
      recipient: z.string().max(254),
      fromAddress: z.string().max(254),
      replyTo: z.string().max(254),
      enabled: z.boolean(),
      version: z.number().int().positive(),
    })
    .strict()
    .parse(data)
  const from = data.fromAddress ? emailAddress.parse(data.fromAddress) : null
  const replyTo = data.replyTo ? emailAddress.parse(data.replyTo) : null
  const candidate = data.recipient ? emailAddress.parse(data.recipient) : null
  const { rows } = await c.query(
    "SELECT * FROM support_settings WHERE id='platform' FOR UPDATE",
  )
  const s = rows[0]
  if (data.version !== s.version)
    throw new SupportError(409, 'Settings changed. Reload before saving.')
  // Every recipient change pauses sending and invalidates prior confirmation.
  const changed = candidate !== (s.pending_recipient || s.recipient || null)
  const pending = changed ? candidate : s.pending_recipient
  const recipient = changed ? null : s.recipient
  const verified = changed ? null : s.recipient_verified_at
  const next = {
    ...s,
    from_address: from,
    reply_to: replyTo,
    pending_recipient: pending,
    recipient,
    recipient_verified_at: verified,
    enabled: changed || from !== s.from_address ? false : !!data.enabled,
  }
  if (next.enabled && supportEmailReadiness(next))
    throw new SupportError(
      409,
      'Keep notifications paused until server approval, sender setup and recipient confirmation are complete.',
    )
  await c.query(
    "UPDATE support_settings SET from_address=$1,reply_to=$2,pending_recipient=$3,recipient=$4,recipient_verified_at=$5,enabled=$6,version=version+1,updated_at=NOW() WHERE id='platform'",
    [from, replyTo, pending, recipient, verified, next.enabled],
  )
  await supportAudit(c, actor, 'notification_settings_changed')
  return supportSettingsView(c, actor)
}
export async function confirmSupportRecipient(
  c: SupportClient,
  actor: SupportActor,
  version: number,
  confirmation: string,
) {
  requireSupportAdmin(actor)
  const { rows } = await c.query(
    "SELECT * FROM support_settings WHERE id='platform' FOR UPDATE",
  )
  const s = rows[0]
  if (version !== s.version)
    throw new SupportError(409, 'Settings changed. Reload before confirming.')
  if (
    !s.pending_recipient ||
    s.pending_recipient !== actor.email ||
    emailAddress.parse(confirmation) !== actor.email
  )
    throw new SupportError(
      403,
      'Sign in with the verified platform-admin identity for the pending recipient, then type that email to confirm. Other mailboxes need a future email-verification flow.',
    )
  await c.query(
    "UPDATE support_settings SET recipient=pending_recipient,pending_recipient=NULL,recipient_verified_at=NOW(),enabled=false,version=version+1,updated_at=NOW() WHERE id='platform'",
  )
  await supportAudit(c, actor, 'notification_recipient_confirmed')
  return supportSettingsView(c, actor)
}
