import { z } from 'zod'
import {
  adminTransaction,
  requireAdmin,
  hasRecentAdminVerification,
  requireAdminOrigin,
  requireRate,
} from './platform-admin-core'
import {
  SupportError,
  supportAdminActor,
  supportTransaction,
  getTicket,
} from './support-core'
import { businessStatus } from './support-ai-tools'
import { reconcileSupportBilling } from './support-billing-recovery'

/** Human-only endpoint: the model has no execution tool or confirmation token. */
export async function confirmAssistantAction(req: Request, raw: unknown) {
  const { actionId } = z
    .object({ actionId: z.uuid(), confirmation: z.literal('RECONCILE') })
    .strict()
    .parse(raw)
  requireAdminOrigin(req)
  const actor = await supportAdminActor(req)
  // Do not consume a proposal if authentication needs refreshing.
  await adminTransaction(async (c) => {
    const session = await requireAdmin(c, req)
    if (!hasRecentAdminVerification(session))
      throw new SupportError(
        403,
        'Verify existing administrator authentication, then confirm this recovery again.',
      )
  })
  await requireRate(actor.id, 'assistant-reconciliation', 5, 60)
  const proposal = await supportTransaction(actor, async (c) => {
    const row = (
      await c.query(
        "SELECT a.*,c.context_ticket_id FROM support_ai_actions a JOIN support_ai_conversations c ON c.id=a.conversation_id WHERE a.id=$1 AND a.actor_id=$2 AND c.requester_id=$2 AND c.audience='admin' AND c.expires_at>now() FOR UPDATE OF a",
        [actionId, actor.id],
      )
    ).rows[0]
    if (!row || row.tool !== 'reconcile_billing' || !row.context_ticket_id)
      throw new SupportError(404, 'Recovery proposal not found.')
    const ticket = await getTicket(c, actor, row.context_ticket_id, true)
    if (ticket.workspace_id !== row.business_id)
      throw new SupportError(
        409,
        'The ticket business changed. Request a new proposal.',
      )
    if (row.status !== 'proposed')
      throw new SupportError(
        409,
        'This recovery was already attempted. Review its recorded outcome; it is not automatically retried.',
      )
    await c.query(
      "UPDATE support_ai_actions SET status='running',updated_at=now() WHERE id=$1",
      [actionId],
    )
    return row
  })
  let verified = false
  try {
    verified = await adminTransaction(async (c) => {
      const session = await requireAdmin(c, req)
      if (
        session.identity_id !== actor.id ||
        !hasRecentAdminVerification(session)
      )
        throw new SupportError(403, 'Administrator verification required.')
      await reconcileSupportBilling(c, proposal.business_id)
      const check = (
        await c.query(
          'SELECT last_reconciled_at FROM workspace_billing WHERE business_id=$1 AND last_reconciled_at>=transaction_timestamp()',
          [proposal.business_id],
        )
      ).rows[0]
      return !!check
    })
  } catch {
    /* Persist uncertain outcome separately. Never retry provider recovery automatically. */
  }
  return supportTransaction(actor, async (c) => {
    await c.query(
      'UPDATE support_ai_actions SET status=$1,updated_at=now() WHERE id=$2 AND actor_id=$3',
      [verified ? 'verified_success' : 'unverified', actionId, actor.id],
    )
    await c.query("SELECT set_config('app.business_id',$1,true)", [
      proposal.business_id,
    ])
    const metadata = verified
      ? await businessStatus(c, proposal.business_id, true)
      : undefined
    return {
      actionId,
      verified,
      metadata,
      message: verified
        ? 'Billing reconciliation completed and its recorded timestamp was verified. Review refreshed access in Administration; this does not establish that the reported issue is fixed.'
        : 'Recovery success could not be verified. The outcome is recorded as unverified. Review existing billing records before taking another action.',
    }
  })
}
