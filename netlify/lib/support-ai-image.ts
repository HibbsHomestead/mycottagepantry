import sharp from 'sharp'
import { getStore } from '@netlify/blobs'
import {
  getTicket,
  SupportError,
  supportAudit,
  type SupportActor,
  type SupportClient,
} from './support-core'
export async function supportImage(
  c: SupportClient,
  actor: SupportActor,
  id: string,
  business: string | null,
  staff: boolean,
  ticketId?: string,
) {
  const a = (
    await c.query(
      "SELECT a.object_key,m.ticket_id FROM support_attachments a JOIN support_messages m ON m.id=a.message_id WHERE a.id=$1 AND m.kind<>'internal'",
      [id],
    )
  ).rows[0]
  if (!a) throw new SupportError(404, 'Public screenshot not found.')
  const ticket = await getTicket(c, actor, a.ticket_id, staff)
  if (staff ? ticket.id !== ticketId : ticket.workspace_id !== business)
    throw new SupportError(
      403,
      'Screenshot does not belong to this support context.',
    )
  if (
    !staff &&
    business &&
    !(
      await c.query(
        'SELECT identity_id FROM users WHERE business_id=$1 AND identity_id=$2 AND active=true',
        [business, actor.id],
      )
    ).rows[0]
  )
    throw new SupportError(
      403,
      'Active business membership required for screenshot review.',
    )
  const bytes = await getStore({
    name: 'support-screenshots-private',
    consistency: 'strong',
  }).get(a.object_key, { type: 'arrayBuffer' })
  if (!bytes || bytes.byteLength > 2 * 1024 * 1024)
    throw new SupportError(400, 'Screenshot unavailable or too large.')
  const image = await sharp(Buffer.from(bytes), {
    limitInputPixels: 4096 * 4096,
    animated: false,
  })
    .rotate()
    .resize({
      width: 512,
      height: 512,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer()
  if (image.byteLength > 90000)
    throw new SupportError(
      400,
      'Screenshot is too detailed for AI review. Crop it and upload again.',
    )
  await supportAudit(c, actor, 'screenshot_shared_with_ai', ticket.id)
  return `data:image/png;base64,${image.toString('base64')}`
}
