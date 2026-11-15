import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { businessProfile } from '../../src/lib/registration'
import { selectedWorkspace } from './verified-session'
import { effectiveAccess, latestManualGrant } from './manual-access'
import { enforceProviderBilledWrite } from './billing-entitlements'
import {
  SupportError,
  type SupportActor,
  type SupportClient,
} from './support-core'

export const timezoneInput = z
  .object({ timezone: businessProfile.shape.timezone })
  .strict()
export const correctionConsequences =
  'Changes future business-local date defaults and date-based views for everyone in this oven. Existing saved transaction dates, stock, accounting, subscriptions and permissions are unchanged. Undo restores the prior timezone only; it cannot reverse records created in the meantime.'

// Reuse current access resolution and the same settings write gate as the workspace API.
async function authorized(
  c: SupportClient,
  actor: SupportActor,
  req: Request,
  business: string,
) {
  if (actor.portal)
    throw new SupportError(
      403,
      'Use your business owner session for corrections.',
    )
  if (selectedWorkspace(req) && selectedWorkspace(req) !== business)
    throw new SupportError(403, 'Select the proposal’s oven first.')
  await c.query("SELECT set_config('app.business_id',$1,true)", [business])
  const member = (
    await c.query(
      'SELECT role FROM users WHERE business_id=$1 AND identity_id=$2 AND active=true FOR SHARE',
      [business, actor.id],
    )
  ).rows[0]
  if (member?.role !== 'Owner')
    throw new SupportError(
      403,
      'Only the active business Owner can correct timezone.',
    )
  const owner = (
    await c.query(
      'SELECT identity_owner FROM businesses WHERE id=$1 FOR UPDATE',
      [business],
    )
  ).rows[0]
  if (!owner) throw new SupportError(404, 'Business unavailable.')
  await c.query("SELECT set_config('app.billing_worker','true',true)")
  const billing = (
    await c.query(
      'SELECT plan_id,status,source,paid_through,environment,entitlement_policy FROM workspace_billing WHERE business_id=$1',
      [business],
    )
  ).rows[0]
  const access = effectiveAccess(
    billing,
    await latestManualGrant(c, business),
    owner.identity_owner,
  )
  await c.query("SELECT set_config('app.billing_worker','false',true)")
  if (access.suspended)
    throw new SupportError(403, 'Account access is suspended. Contact support.')
  if (access.access)
    await enforceProviderBilledWrite({
      client: c,
      org: business,
      row: billing || {
        plan_id: null,
        status: 'unassigned',
        source: 'unassigned',
      },
      access: access.access,
      method: 'POST',
      url: new URL('/api/workspace', req.url),
      body: { action: 'save', table: 'settings' },
    })
}
export async function correctionList(
  c: SupportClient,
  actor: SupportActor,
  conversation: string,
) {
  return (
    await c.query(
      'SELECT * FROM support_corrections WHERE actor_id=$1 AND conversation_id=$2 ORDER BY created_at DESC LIMIT 20',
      [actor.id, conversation],
    )
  ).rows
}
export async function proposeTimezone(
  c: SupportClient,
  actor: SupportActor,
  req: Request,
  conversation: string,
  business: string,
  input: unknown,
) {
  const { timezone } = timezoneInput.parse(input)
  await authorized(c, actor, req, business)
  const row = (
    await c.query(
      'SELECT id,data FROM settings WHERE business_id=$1 ORDER BY created_at,id LIMIT 1 FOR UPDATE',
      [business],
    )
  ).rows[0]
  if (!row) throw new SupportError(404, 'Business settings unavailable.')
  const before = { timezone: row.data.timezone || null }
  if (before.timezone === timezone)
    return {
      stage: 'Fix verified',
      timezone,
      message: 'Saved timezone already matches. No change proposed.',
    }
  const id = randomUUID()
  await c.query(
    "INSERT INTO support_corrections(id,conversation_id,actor_id,business_id,target_id,before,after,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '15 minutes')",
    [
      id,
      conversation,
      actor.id,
      business,
      row.id,
      JSON.stringify(before),
      JSON.stringify({ timezone }),
    ],
  )
  return {
    stage: 'Change proposed',
    actionId: id,
    target: { businessId: business, settingsId: row.id },
    before,
    after: { timezone },
    consequences: correctionConsequences,
    message:
      'Nothing changed. Review the server proposal and choose Approve exact change.',
  }
}
export async function confirmTimezone(
  c: SupportClient,
  actor: SupportActor,
  req: Request,
  input: unknown,
) {
  const { actionId, confirmation, timezone } = z
    .object({
      actionId: z.uuid(),
      confirmation: z.literal('APPLY_TIMEZONE'),
      timezone: businessProfile.shape.timezone,
    })
    .strict()
    .parse(input)
  const proposal = (
    await c.query(
      'SELECT * FROM support_corrections WHERE id=$1 AND actor_id=$2 FOR UPDATE',
      [actionId, actor.id],
    )
  ).rows[0]
  if (!proposal)
    throw new SupportError(404, 'Correction not found or permission changed.')
  await authorized(c, actor, req, proposal.business_id)
  if (proposal.after.timezone !== timezone || confirmation !== 'APPLY_TIMEZONE')
    throw new SupportError(409, 'Approval does not match the exact proposal.')
  // A retry returns the recorded result without executing again.
  if (proposal.status === 'verified')
    return {
      stage: 'Change approved and applied',
      action: proposal,
      message:
        'Already applied. No duplicate execution. Review the verification timestamp.',
    }
  if (proposal.status !== 'proposed')
    throw new SupportError(
      409,
      'Request a new proposal; this one is no longer applicable.',
    )
  const chat = (
    await c.query(
      "SELECT id FROM support_ai_conversations WHERE id=$1 AND requester_id=$2 AND business_id=$3 AND audience='customer' AND expires_at>now()",
      [proposal.conversation_id, actor.id, proposal.business_id],
    )
  ).rows[0]
  if (!chat || Date.parse(proposal.expires_at) <= Date.now()) {
    await c.query(
      "UPDATE support_corrections SET status='expired' WHERE id=$1",
      [actionId],
    )
    return {
      stage: 'Escalation required',
      message: 'Proposal expired. Request a fresh inspection.',
    }
  }
  const row = (
    await c.query(
      'SELECT data FROM settings WHERE business_id=$1 AND id=$2 FOR UPDATE',
      [proposal.business_id, proposal.target_id],
    )
  ).rows[0]
  if (!row || (row.data.timezone || null) !== proposal.before.timezone) {
    await c.query("UPDATE support_corrections SET status='stale' WHERE id=$1", [
      actionId,
    ])
    return {
      stage: 'Escalation required',
      message:
        'Settings changed since the proposal. Nothing applied; inspect again.',
    }
  }
  await c.query(
    "UPDATE settings SET data=jsonb_set(data,'{timezone}',to_jsonb($3::text)),updated_at=now() WHERE business_id=$1 AND id=$2",
    [proposal.business_id, proposal.target_id, timezone],
  )
  const saved = (
    await c.query(
      "SELECT data->>'timezone' AS timezone FROM settings WHERE business_id=$1 AND id=$2",
      [proposal.business_id, proposal.target_id],
    )
  ).rows[0]
  if (saved?.timezone !== timezone)
    throw new SupportError(
      409,
      'Saved-state verification failed; correction rolled back.',
    )
  const action = (
    await c.query(
      "UPDATE support_corrections SET status='verified',approved_at=now(),verified_at=now() WHERE id=$1 RETURNING *",
      [actionId],
    )
  ).rows[0]
  return {
    stage: 'Fix verified',
    action,
    saved: { timezone: saved.timezone },
    message:
      'Change approved and applied. Read back the saved timezone and verified the exact value. Refresh your oven to load it. This verifies the setting; confirm the original symptom separately.',
  }
}
