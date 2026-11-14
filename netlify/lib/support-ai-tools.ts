import { admin } from '@netlify/identity'
import { selectedWorkspace } from './verified-session'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { supportArticles } from '../../src/lib/support-knowledge'
import {
  supportActor,
  supportAdminActor,
  supportTransaction,
  getTicket,
  SupportError,
  type SupportClient,
} from './support-core'

export type AssistantTools = {
  names: string[]
  run: (name: string, input: unknown) => Promise<unknown>
}
const noArgs = z.object({}).strict()
const status = (value: unknown) =>
  typeof value === 'string' && /^[a-z0-9_-]{1,60}$/i.test(value)
    ? value
    : 'unrecorded'

/** Every invocation opens a new transaction and revalidates identity, portal grant, membership and conversation audience. */
export function assistantTools(
  req: Request,
  conversationId: string,
  staff: boolean,
  contextConsent: boolean,
): AssistantTools {
  const names = [
    'search_help',
    ...(staff
      ? [
          'support_lookup',
          'account_status',
          'business_status',
          'troubleshoot',
          'propose_billing_reconciliation',
        ]
      : contextConsent
        ? ['account_status', 'business_status', 'troubleshoot']
        : []),
  ]
  return {
    names,
    run: async (name, input) => {
      const actor = staff ? await supportAdminActor(req) : await supportActor()
      if (!names.includes(name))
        throw new SupportError(403, 'This assistant cannot use that tool.')
      return supportTransaction(actor, async (c) => {
        const chat = (
          await c.query(
            'SELECT * FROM support_ai_conversations WHERE id=$1 AND requester_id=$2 AND audience=$3 AND expires_at>now()',
            [conversationId, actor.id, staff ? 'admin' : 'customer'],
          )
        ).rows[0]
        if (!chat) throw new SupportError(404, 'Conversation not found.')
        let business = chat.business_id
        let ticket
        if (staff && chat.context_ticket_id) {
          ticket = await getTicket(c, actor, chat.context_ticket_id, true)
          business = ticket.workspace_id
        }
        let role: string | null = null
        if (
          !staff &&
          business &&
          selectedWorkspace(req) &&
          selectedWorkspace(req) !== business
        )
          throw new SupportError(
            403,
            'Choose the conversation’s business before checking its status.',
          )
        if (!staff && business) {
          const member = (
            await c.query(
              'SELECT role FROM users WHERE identity_id=$1 AND business_id=$2 AND active=true',
              [actor.id, business],
            )
          ).rows[0]
          if (!member)
            throw new SupportError(
              403,
              'Your active membership is no longer available.',
            )
          role = member.role
        }
        if (business)
          await c.query("SELECT set_config('app.business_id',$1,true)", [
            business,
          ])
        if (staff)
          await c.query("SELECT set_config('app.platform_read','true',true)")
        let result: unknown
        if (name === 'search_help') {
          const { question } = z
            .object({ question: z.string().min(1).max(1000) })
            .strict()
            .parse(input)
          result = { articles: supportArticles(question) }
        } else {
          if (name !== 'support_lookup') noArgs.parse(input)
          if (staff && !ticket && name !== 'support_lookup') {
            result = {
              available: false,
              reason:
                'Select a support ticket first. No customer account was inspected.',
            }
          } else if (name === 'account_status') {
            const subject =
              staff && ticket ? await admin.getUser(ticket.requester_id) : null
            const member =
              staff && business
                ? (
                    await c.query(
                      'SELECT role FROM users WHERE business_id=$1 AND identity_id=$2 AND active=true',
                      [business, ticket.requester_id],
                    )
                  ).rows[0]
                : null
            result = {
              subject:
                staff && ticket
                  ? 'selected ticket requester'
                  : 'current signed-in person',
              emailVerified: subject
                ? !!subject.confirmedAt &&
                  Number.isFinite(Date.parse(subject.confirmedAt))
                : true,
              authenticated: subject ? undefined : true,
              activeBusinessMembership: staff ? !!member : !!business,
              role: staff ? member?.role || null : role,
              asOf: new Date().toISOString(),
              limitation:
                'Verified account and recorded membership only. No global account health field or another person’s live sign-in session is available.',
            }
          } else if (name === 'support_lookup') {
            const { query } = z
              .object({ query: z.string().trim().max(100) })
              .strict()
              .parse(input)
            result = {
              tickets: (
                await c.query(
                  "SELECT number,status,workspace_id FROM support_tickets WHERE $1='' OR number::text=$1 OR strpos(lower(subject),lower($1))>0 ORDER BY updated_at DESC LIMIT 10",
                  [query],
                )
              ).rows.map((r) => ({
                number: r.number,
                status: status(r.status),
                hasBusiness: !!r.workspace_id,
              })),
              selectedTicket: ticket
                ? { number: ticket.number, status: status(ticket.status) }
                : null,
              instruction:
                'Select a ticket in the inbox to scope account diagnostics or recovery to its business.',
            }
          } else if (!business) {
            result = {
              available: false,
              reason: staff
                ? 'Select a support ticket with an attached business first.'
                : 'No active business is selected. Open the intended oven first.',
            }
          } else if (name === 'business_status') {
            result = await businessStatus(
              c,
              business,
              staff || ['Owner', 'Manager'].includes(role || ''),
            )
          } else if (name === 'troubleshoot') {
            const receiptAllowed =
              staff ||
              ['Owner', 'Manager', 'Read-only Accountant'].includes(role || '')
            const receipts = receiptAllowed
              ? (
                  await c.query(
                    "SELECT CASE WHEN data->>'extractionStatus' IN ('queued','manual','processing','failed','needs_review','partial','not_configured') THEN data->>'extractionStatus' ELSE 'unrecorded' END AS status,count(*)::int AS count FROM receipt_extractions WHERE business_id=$1 GROUP BY 1",
                    [business],
                  )
                ).rows
              : undefined
            const recovery = (
              await c.query(
                "SELECT count(*)::int AS count FROM label_recovery_drafts WHERE business_id=$1 AND identity_id=$2 AND data->>'resolvedAt' IS NULL",
                [business, staff ? ticket.requester_id : actor.id],
              )
            ).rows[0]
            result = {
              receiptAttempts: receipts,
              receiptPermission: receiptAllowed,
              unresolvedOwnLabelCheckpoints: recovery?.count || 0,
              asOf: new Date().toISOString(),
              limitation:
                'Partial recorded evidence only; no files, item contents or raw errors. Product URL request history is unavailable. No changes made.',
            }
          } else if (name === 'propose_billing_reconciliation') {
            if (!staff || !actor.admin)
              throw new SupportError(403, 'Administrator permission required.')
            const existing = (
              await c.query(
                "SELECT id FROM support_ai_actions WHERE conversation_id=$1 AND actor_id=$2 AND tool='reconcile_billing' AND status='proposed'",
                [chat.id, actor.id],
              )
            ).rows[0]
            const id = existing?.id || randomUUID()
            if (!existing)
              await c.query(
                "INSERT INTO support_ai_actions(id,conversation_id,actor_id,tool,business_id,status) VALUES($1,$2,$3,'reconcile_billing',$4,'proposed')",
                [id, chat.id, actor.id, business],
              )
            result = {
              confirmationRequired: true,
              actionId: id,
              action: 'Reconcile verified billing',
              explanation:
                'Refresh recorded billing from the linked provider. This can update effective access. No charge, subscription creation, cancellation or suspension override. Review and confirm in the private assistant; fresh administrator MFA is required. Nothing has changed yet.',
            }
          }
        }
        await c.query(
          "INSERT INTO support_ai_actions(id,conversation_id,actor_id,tool,business_id,status) VALUES($1,$2,$3,$4,$5,'verified_read')",
          [randomUUID(), chat.id, actor.id, name, business],
        )
        return result
      }).catch(async (error) => {
        // Preserve a content-free outcome when a permitted tool fails or loses authorization.
        await supportTransaction(actor, async (c) => {
          await c.query(
            "INSERT INTO support_ai_actions(id,conversation_id,actor_id,tool,status) SELECT $1,id,$2,$3,'failed_or_denied' FROM support_ai_conversations WHERE id=$4 AND requester_id=$2 AND audience=$5 AND expires_at>now()",
            [
              randomUUID(),
              actor.id,
              name,
              conversationId,
              staff ? 'admin' : 'customer',
            ],
          )
        }).catch(() => {})
        throw error
      })
    },
  }
}

export async function businessStatus(
  c: SupportClient,
  business: string,
  billingAllowed: boolean,
) {
  const integrations = billingAllowed
    ? (
        await c.query(
          "SELECT CASE WHEN lower(data->>'name') IN ('square','stripe','quickbooks','etsy','shopify') THEN lower(data->>'name') ELSE 'integration' END AS provider, CASE WHEN data->>'status' IN ('connected','disconnected','not_connected','error','unavailable','Not connected') THEN data->>'status' ELSE 'unrecorded' END AS status,updated_at FROM integrations WHERE business_id=$1 ORDER BY id LIMIT 20",
          [business],
        )
      ).rows
    : undefined
  const billing = billingAllowed
    ? (
        await c.query(
          'SELECT plan_id,status,source,environment,updated_at,last_reconciled_at FROM workspace_billing WHERE business_id=$1',
          [business],
        )
      ).rows[0]
    : undefined
  return {
    activeBusiness: true,
    billing: billing
      ? {
          plan: status(billing.plan_id),
          status: status(billing.status),
          source: status(billing.source),
          environment: status(billing.environment),
          recordedAt: billing.updated_at,
          lastReconciledAt: billing.last_reconciled_at,
        }
      : null,
    integrations,
    billingPermission: billingAllowed,
    asOf: new Date().toISOString(),
    limitation:
      'Recorded metadata only, not proof of payment or live connectivity. Manual grants and suspensions are enforced by existing access controls. No stock, payment details or credentials are read.',
  }
}
