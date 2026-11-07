import { admin } from '@netlify/identity'
import { timingSafeEqual } from 'node:crypto'
import {
  supportTransaction,
  limitedBody,
  digest,
  privateHeaders,
  SupportError,
} from './support-core'
import { supportEmailReadiness } from './support-settings'

/** Optional adapter only. No service, sender or live delivery is enabled by installing this code. */
export function supportMailText(kind: string, number: number, link: string) {
  const text =
    kind === 'acknowledgment'
      ? 'Your help request was saved.'
      : kind === 'reply'
        ? 'Support added a reply to your ticket.'
        : kind === 'customer_reply'
          ? 'A requester replied to a support ticket.'
          : 'A new support ticket was saved.'
  return `${text}\n\nTicket #${number}\nOpen securely: ${link}\n\nReply in Cottage Pantry. Replying to this notification does not update the ticket.\nDo not email passwords, API keys or payment-card details.`
}
async function verifiedRecipient(identity: string) {
  try {
    const user = await admin.getUser(identity)
    return user?.confirmedAt && user.email ? user : null
  } catch {
    return null
  }
}
export async function dispatchSupportMail() {
  // Even scheduled calls cannot send without explicit server approval and production context.
  const ready = await supportTransaction(null, async (c) => {
    const settings = (
      await c.query("SELECT * FROM support_settings WHERE id='platform'")
    ).rows[0]
    const reason = supportEmailReadiness(settings)
    if (reason)
      await c.query(
        "UPDATE support_outbox SET status='blocked_setup',error_code='email_inactive',updated_at=NOW() WHERE status IN ('pending','blocked_setup')",
      )
    return !reason
  })
  if (!ready) return { processed: 0 }
  let processed = 0
  for (let index = 0; index < 3; index++) {
    const claimed = await supportTransaction(null, async (c) => {
      await c.query(
        "UPDATE support_outbox SET status='unknown',error_code='interrupted_send',updated_at=NOW() WHERE status='sending' AND updated_at<NOW()-INTERVAL '10 minutes'",
      )
      const settings = (
        await c.query("SELECT * FROM support_settings WHERE id='platform'")
      ).rows[0]
      if (supportEmailReadiness(settings)) return null
      const row = (
        await c.query(
          "SELECT o.*,t.number FROM support_outbox o JOIN support_tickets t ON t.id=o.ticket_id JOIN support_messages m ON m.id=o.message_id WHERE m.kind<>'internal' AND o.attempts<3 AND o.retry_at<=NOW() AND (o.status IN ('pending','blocked_setup') OR (o.status='failed' AND o.error_code='rate_limited')) ORDER BY o.created_at,o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED",
        )
      ).rows[0]
      if (!row) return null
      const suppression = await c.query(
        "SELECT 1 FROM support_outbox WHERE target_identity IS NOT DISTINCT FROM $1 AND status IN ('bounced','suppressed') AND updated_at >= $2 LIMIT 1",
        [
          row.target_identity,
          row.target_identity ? new Date(0) : settings.recipient_verified_at,
        ],
      )
      if (suppression.rows.length) {
        await c.query(
          "UPDATE support_outbox SET status='suppressed',error_code='recipient_suppressed',updated_at=NOW() WHERE id=$1",
          [row.id],
        )
        return { skip: true } as const
      }
      const confirmation = row.target_identity
        ? null
        : (
            await c.query(
              "SELECT actor_id FROM support_audit WHERE action='notification_recipient_confirmed' ORDER BY created_at DESC,id DESC LIMIT 1",
            )
          ).rows[0]?.actor_id
      await c.query(
        "UPDATE support_outbox SET status='sending',attempts=attempts+1,error_code=NULL,updated_at=NOW() WHERE id=$1",
        [row.id],
      )
      return { row, settings, confirmation, skip: false } as const
    })
    if (!claimed) break
    if (claimed.skip) continue
    const { row, settings } = claimed
    const identity = await verifiedRecipient(
      row.target_identity || claimed.confirmation || '',
    )
    if (
      !identity ||
      (!row.target_identity &&
        (identity.email?.toLowerCase() !== settings.recipient ||
          !identity.roles?.includes('platform_admin')))
    ) {
      await supportTransaction(null, (c) =>
        c.query(
          "UPDATE support_outbox SET status='cancelled',error_code='recipient_verification_required',updated_at=NOW() WHERE id=$1 AND status='sending'",
          [row.id],
        ),
      )
      continue
    }
    const link = `https://mycottagepantry.com/${row.target_identity ? 'support' : 'platform-support'}#ticket=${row.ticket_id}`
    let status = 'unknown',
      errorCode: string | null = 'send_outcome_unknown',
      providerId: string | null = null
    try {
      const response = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
        headers: {
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': globalThis.Netlify.env.get(
            'SUPPORT_POSTMARK_SERVER_TOKEN',
          )!,
        },
        body: JSON.stringify({
          From: settings.from_address,
          To: identity.email,
          ...(settings.reply_to ? { ReplyTo: settings.reply_to } : {}),
          Subject: `Cottage Pantry support · Ticket #${row.number}`,
          TextBody: supportMailText(row.kind, row.number, link),
          MessageStream: 'outbound',
          Metadata: { supportNotificationId: row.id },
        }),
      })
      if (response.status === 429) {
        status = 'failed'
        errorCode = 'rate_limited'
      } else if (response.status >= 400 && response.status < 500) {
        status = 'failed'
        errorCode = 'provider_rejected'
      } else if (response.ok) {
        const data = await response.json().catch(() => null)
        if (
          data?.ErrorCode === 0 &&
          typeof data.MessageID === 'string' &&
          data.MessageID.length < 100
        ) {
          status = 'accepted'
          errorCode = null
          providerId = data.MessageID
        }
      }
    } catch {
      /* An uncertain send is never automatically retried. */
    }
    await supportTransaction(null, (c) =>
      c.query(
        "UPDATE support_outbox SET status=$1,error_code=$2,provider_message_id=COALESCE(provider_message_id,$3),retry_at=NOW()+INTERVAL '5 minutes',updated_at=NOW() WHERE id=$4 AND status='sending'",
        [status, errorCode, providerId, row.id],
      ),
    )
    processed++
  }
  return { processed }
}
export async function supportDeliveryWebhook(req: Request) {
  const headers = privateHeaders()
  try {
    const env = globalThis.Netlify?.env,
      secret = env?.get('SUPPORT_EMAIL_WEBHOOK_SECRET') || ''
    if (req.method !== 'POST')
      throw new SupportError(405, 'Method not allowed.')
    if (
      env?.get('SUPPORT_EMAIL_ENABLED') !== 'true' ||
      env.get('CONTEXT') !== 'production' ||
      secret.length < 32
    )
      throw new SupportError(404, 'Unavailable.')
    const supplied = digest(req.headers.get('authorization') || ''),
      expected = digest(
        'Basic ' + Buffer.from('support:' + secret).toString('base64'),
      )
    if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)))
      throw new SupportError(401, 'Unauthorized.')
    let data: any
    try {
      data = JSON.parse((await limitedBody(req, 65536)).toString('utf8'))
    } catch {
      throw new SupportError(400, 'Invalid event.')
    }
    if (
      !['Delivery', 'Bounce', 'SpamComplaint'].includes(data.RecordType) ||
      typeof data.MessageID !== 'string'
    )
      return Response.json({ ignored: true }, { headers })
    const notification =
      typeof data.Metadata?.supportNotificationId === 'string' &&
      /^[a-f0-9-]{36}$/i.test(data.Metadata.supportNotificationId)
        ? data.Metadata.supportNotificationId
        : null
    await supportTransaction(null, async (c) => {
      const row = (
        await c.query(
          "SELECT * FROM support_outbox WHERE provider_message_id=$1 OR (id=$2 AND provider_message_id IS NULL AND status IN ('sending','unknown')) FOR UPDATE",
          [data.MessageID, notification],
        )
      ).rows[0]
      if (!row) return
      const id = digest(
        [
          data.RecordType,
          data.MessageID,
          String(data.ID || ''),
          String(data.DeliveredAt || data.BouncedAt || ''),
        ].join(':'),
      )
      const inserted = await c.query(
        'INSERT INTO support_delivery_events(id,notification_id,kind) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id',
        [id, row.id, data.RecordType],
      )
      if (!inserted.rows.length) return
      const status =
        data.RecordType === 'Delivery'
          ? 'delivered'
          : data.RecordType === 'Bounce'
            ? 'bounced'
            : 'suppressed'
      await c.query(
        "UPDATE support_outbox SET status=CASE WHEN status IN ('bounced','suppressed') AND $1='delivered' THEN status ELSE $1 END,provider_message_id=$2,error_code=CASE WHEN $1='delivered' THEN NULL ELSE 'delivery_failed' END,updated_at=NOW() WHERE id=$3",
        [status, data.MessageID, row.id],
      )
    })
    return Response.json({ received: true }, { headers })
  } catch (e) {
    return Response.json(
      { error: e instanceof SupportError ? e.message : 'Event unavailable.' },
      { status: e instanceof SupportError ? e.status : 503, headers },
    )
  }
}
