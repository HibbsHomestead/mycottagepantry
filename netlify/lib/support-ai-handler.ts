import { supportMeter } from './support-ai-meter'
import { supportImage } from './support-ai-image'
import {
  correctionList,
  confirmTimezone,
  proposeTimezone,
} from './support-corrections'
import { assistantTools } from './support-ai-tools'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { selectedWorkspace } from './verified-session'
import { supportAnswer } from './support-ai-provider'
import {
  supportAiDefaults,
  supportAiPolicySchema,
  redactSupportText,
  sanitizeSupportDiagnostics,
  type SupportAiMessage,
} from '../../src/lib/support-ai'
import {
  supportTransaction,
  SupportError,
  getTicket,
  privateHeaders,
  limitedBody,
  requireSupportAdmin,
  supportAudit,
  type SupportActor,
  type SupportClient,
} from './support-core'

async function businessScope(
  c: SupportClient,
  actor: SupportActor,
  req: Request,
) {
  const rows = (
    await c.query(
      'SELECT business_id FROM users WHERE identity_id=$1 AND active=true',
      [actor.id],
    )
  ).rows
  const selected = selectedWorkspace(req)
  const match =
    rows.find((r) => r.business_id === selected) ||
    (rows.length === 1 ? rows[0] : null)
  if (rows.length > 1 && !match)
    throw new SupportError(
      409,
      'Choose an oven before opening its support conversation.',
    )
  return match?.business_id || null
}
type ChatRow = {
  id: string
  messages: SupportAiMessage[]
  diagnostics: ReturnType<typeof sanitizeSupportDiagnostics>
  ticket_id: string | null
  expires_at: string
}
const view = (r: ChatRow) => ({
  id: r.id,
  messages: r.messages,
  diagnostics: r.diagnostics,
  ticketId: r.ticket_id,
  expiresAt: r.expires_at,
  contextTicketId: (r as ChatRow & { context_ticket_id?: string })
    .context_ticket_id,
})
async function policy(c: SupportClient) {
  return supportAiPolicySchema.parse(
    (await c.query("SELECT data FROM support_ai_policy WHERE id='platform'"))
      .rows[0]?.data || supportAiDefaults,
  )
}
async function ownConversation(
  c: SupportClient,
  actor: SupportActor,
  id: string,
  business: string | null,
  staff = false,
) {
  const r = (
    await c.query(
      'SELECT * FROM support_ai_conversations WHERE id=$1 AND requester_id=$2 AND business_id IS NOT DISTINCT FROM $3::uuid AND audience=$4 AND expires_at>now() FOR UPDATE',
      [id, actor.id, business, staff ? 'admin' : 'customer'],
    )
  ).rows[0]
  if (!r) throw new SupportError(404, 'Conversation not found in this oven.')
  return r
}
async function reserve(
  c: SupportClient,
  actor: SupportActor,
  business: string | null,
  id: string,
  staff = false,
) {
  const p = await policy(c)
  if (!staff && (!business || !p.evaluationBusinessIds.includes(business)))
    throw new SupportError(
      503,
      'AI support is in private evaluation. Help guides and Contact support remain available.',
    )
  if (!p.enabled)
    throw new SupportError(
      503,
      'The AI helper is paused. Help guides and Contact support remain available.',
    )
  await c.query("SELECT pg_advisory_xact_lock(hashtext('support-ai-usage'))")
  await c.query("SELECT set_config('app.support_ai_counter','true',true)")
  const rows = (
    await c.query(
      "SELECT requester_id,business_id,created_at FROM support_ai_usage WHERE created_at>now()-interval '24 hours'",
    )
  ).rows
  const own = rows.filter((r) => r.requester_id === actor.id)
  if (
    own.length >= p.userDaily ||
    rows.length >= p.globalDaily ||
    (business &&
      rows.filter((r) => r.business_id === business).length >=
        p.businessDaily) ||
    own.some(
      (r) => Date.now() - Date.parse(r.created_at) < p.cooldownSeconds * 1000,
    )
  )
    throw new SupportError(
      429,
      'AI usage limit reached. Wait before retrying; guides and Contact support remain available.',
    )
  await c.query(
    'INSERT INTO support_ai_usage(id,requester_id,business_id) VALUES($1,$2,$3)',
    [id, actor.id, business],
  )
  return p
}
export async function handleSupportAi(
  req: Request,
  actor: SupportActor,
  staff: boolean,
  createTicket: (
    c: SupportClient,
    a: SupportActor,
    input: unknown,
  ) => Promise<{ ticket: { id: string } }>,
) {
  const response = (data: unknown) =>
    Response.json(data, { headers: privateHeaders() })
  if (req.method === 'GET')
    return response(
      await supportTransaction(actor, async (c) => {
        const p = await policy(c)
        if (staff) {
          const usage = (
            await c.query(
              "SELECT date_trunc('day',created_at) AS day,count(*)::int AS requests,count(*) FILTER (WHERE status='failed')::int AS failures,sum(input_tokens)::int AS input_tokens,sum(output_tokens)::int AS output_tokens FROM support_ai_usage WHERE created_at>now()-interval '30 days' GROUP BY 1 ORDER BY 1 DESC",
            )
          ).rows
          const conversations = (
            await c.query(
              "SELECT * FROM support_ai_conversations WHERE requester_id=$1 AND audience='admin' AND expires_at>now() ORDER BY updated_at DESC LIMIT 20",
              [actor.id],
            )
          ).rows
          return {
            policy: p,
            usage,
            conversations: conversations.map(view),
            actions: [],
            metering: (
              await c.query(
                'SELECT model,count(*)::int AS calls,sum(input_tokens)::text AS input_tokens,sum(cached_tokens)::text AS cached_tokens,sum(output_tokens)::text AS output_tokens,sum(cost_nano_usd)::text AS cost_nano_usd,sum(provider_cost_usd)::text AS provider_cost_usd,sum(CASE WHEN cost_nano_usd IS NULL THEN reserved_nano_usd ELSE 0 END)::text AS uncertain_nano_usd,count(*) FILTER (WHERE cost_nano_usd IS NULL)::int AS uncertain_calls FROM support_ai_meter GROUP BY model',
              )
            ).rows,
          }
        }
        const business = staff ? null : await businessScope(c, actor, req)
        await c.query(
          'DELETE FROM support_ai_conversations WHERE requester_id=$1 AND expires_at<=now()',
          [actor.id],
        )
        const rows = (
          await c.query(
            "SELECT * FROM support_ai_conversations WHERE requester_id=$1 AND audience='customer' AND business_id IS NOT DISTINCT FROM $2::uuid AND expires_at>now() ORDER BY updated_at DESC LIMIT 20",
            [actor.id, business],
          )
        ).rows
        return {
          policy: {
            ...p,
            evaluationBusinessIds: [],
            enabled:
              p.enabled &&
              !!business &&
              p.evaluationBusinessIds.includes(business),
          },
          conversations: await Promise.all(
            rows.map(async (r) => ({
              ...view(r),
              corrections: await correctionList(c, actor, r.id),
            })),
          ),
        }
      }),
    )
  if (req.method !== 'POST')
    throw new SupportError(405, 'Use GET or POST for support.')
  const input = z
    .object({
      action: z.enum([
        'chat',
        'delete',
        'escalate',
        'summarize',
        'policy',
        'confirm',
        'undo',
      ]),
      conversationId: z.uuid().optional(),
      requestId: z.uuid().optional(),
      message: z.string().trim().min(1).max(2000).optional(),
      summary: z.string().trim().min(3).max(1500).optional(),
      consent: z.literal(true).optional(),
      diagnostics: z.unknown().optional(),
      contextConsent: z.boolean().optional(),
      screenshotAttachmentId: z.uuid().optional(),
      screenshotConsent: z.literal(true).optional(),
      actionId: z.uuid().optional(),
      confirmation: z.enum(['APPLY_TIMEZONE', 'RECONCILE']).optional(),
      timezone: z.string().max(80).optional(),
      ticketId: z.uuid().optional(),
      assistance: z
        .enum(['summary', 'category', 'draft', 'rewrite'])
        .optional(),
      draft: z.string().trim().max(6000).optional(),
      policy: supportAiPolicySchema.optional(),
    })
    .strict()
    .parse(JSON.parse((await limitedBody(req, 30000)).toString()))
  if (input.screenshotAttachmentId && !input.screenshotConsent)
    throw new SupportError(
      400,
      'Review and explicitly approve sharing this screenshot with the AI provider.',
    )
  if (input.action === 'confirm' || input.action === 'undo') {
    if (staff || input.confirmation === 'RECONCILE')
      throw new SupportError(
        403,
        'Use the business Owner session for corrections.',
      )
    return response(
      await supportTransaction(actor, async (c) => {
        if (!(await policy(c)).enabled)
          throw new SupportError(
            503,
            'AI corrections are paused; use Settings or Contact support.',
          )
        const scope = await businessScope(c, actor, req)
        if (!scope || !(await policy(c)).evaluationBusinessIds.includes(scope))
          throw new SupportError(
            503,
            'AI corrections are in private evaluation. Use Settings or Contact support.',
          )
        if (input.action === 'confirm')
          return confirmTimezone(c, actor, req, {
            actionId: input.actionId,
            confirmation: input.confirmation,
            timezone: input.timezone,
          })
        if (!input.actionId)
          throw new SupportError(400, 'Choose a verified correction.')
        const original = (
          await c.query(
            "SELECT * FROM support_corrections WHERE id=$1 AND actor_id=$2 AND status='verified'",
            [input.actionId, actor.id],
          )
        ).rows[0]
        if (!original)
          throw new SupportError(404, 'Verified correction not found.')
        const business = await businessScope(c, actor, req)
        if (business !== original.business_id)
          throw new SupportError(403, 'Select the original oven.')
        await ownConversation(c, actor, original.conversation_id, business)
        await c.query("SELECT set_config('app.business_id',$1,true)", [
          business,
        ])
        const current = (
          await c.query(
            "SELECT data->>'timezone' AS timezone FROM settings WHERE business_id=$1 AND id=$2",
            [business, original.target_id],
          )
        ).rows[0]
        if (current?.timezone !== original.after.timezone)
          throw new SupportError(
            409,
            'Timezone changed again. Request a fresh inspection instead of undo.',
          )
        return proposeTimezone(
          c,
          actor,
          req,
          original.conversation_id,
          business!,
          { timezone: original.before.timezone || 'America/Chicago' },
        )
      }).catch(async (error) => {
        await supportTransaction(actor, async (c) =>
          supportAudit(
            c,
            actor,
            `timezone_correction_${input.action}_failed_or_denied:${input.actionId || 'missing'}`,
          ),
        ).catch(() => {})
        throw error
      }),
    )
  }
  if (input.action === 'policy') {
    if (!staff)
      throw new SupportError(
        403,
        'Open the verified admin support inbox to change AI settings.',
      )
    requireSupportAdmin(actor)
    if (!input.consent)
      throw new SupportError(400, 'Confirm the reviewed usage policy.')
    if (!input.policy) throw new SupportError(400, 'Review the usage policy.')
    return response(
      await supportTransaction(actor, async (c) => {
        await c.query(
          "UPDATE support_ai_policy SET data=$1 WHERE id='platform'",
          [JSON.stringify(input.policy)],
        )
        await supportAudit(c, actor, 'support_ai_policy_updated')
        return { policy: input.policy }
      }),
    )
  }
  if (input.action === 'delete')
    return response(
      await supportTransaction(actor, async (c) => {
        if (!input.conversationId)
          throw new SupportError(400, 'Choose a conversation.')
        const business = staff ? null : await businessScope(c, actor, req)
        await ownConversation(c, actor, input.conversationId, business, staff)
        await c.query(
          'DELETE FROM support_ai_conversations WHERE id=$1 AND requester_id=$2',
          [input.conversationId, actor.id],
        )
        return { deleted: true }
      }),
    )
  if (input.action === 'escalate' && staff)
    throw new SupportError(
      403,
      'Private administrator conversations cannot be attached to customer tickets.',
    )
  if (input.action === 'escalate')
    return response(
      await supportTransaction(actor, async (c) => {
        if (!input.conversationId || !input.summary)
          throw new SupportError(400, 'Review an issue summary first.')
        const business = staff ? null : await businessScope(c, actor, req)
        const chat = await ownConversation(
          c,
          actor,
          input.conversationId,
          business,
        )
        if (chat.ticket_id) return { ticketId: chat.ticket_id }
        if (input.diagnostics !== undefined)
          await c.query(
            'UPDATE support_ai_conversations SET diagnostics=$1 WHERE id=$2 AND requester_id=$3',
            [
              JSON.stringify(sanitizeSupportDiagnostics(input.diagnostics)),
              chat.id,
              actor.id,
            ],
          )
        const evidence = (
          await c.query(
            'SELECT tool,status,created_at FROM support_ai_actions WHERE conversation_id=$1 AND actor_id=$2 ORDER BY created_at DESC LIMIT 20',
            [chat.id, actor.id],
          )
        ).rows
        const corrections = await correctionList(c, actor, chat.id)
        const ticket = await createTicket(c, actor, {
          subject: 'AI help: ' + redactSupportText(input.summary).slice(0, 130),
          category: 'Question',
          message:
            redactSupportText(input.summary) +
            '\n\nServer diagnostic outcomes: ' +
            JSON.stringify(evidence) +
            '\nTimezone correction audit: ' +
            JSON.stringify(
              corrections.map((r) => ({
                id: r.id,
                target: r.target_id,
                before: r.before,
                after: r.after,
                status: r.status,
                approvedAt: r.approved_at,
                verifiedAt: r.verified_at,
              })),
            ),
          submissionKey: chat.id,
          route: '/oven',
          aiReviewConsent: true,
        })
        // Existing ticket creation resolves membership itself; pin the verified conversation business for multi-oven accounts.
        await c.query(
          'UPDATE support_tickets SET workspace_id=$1 WHERE id=$2',
          [business, ticket.ticket.id],
        )
        await c.query(
          'UPDATE support_ai_conversations SET ticket_id=$1 WHERE id=$2 AND requester_id=$3',
          [ticket.ticket.id, chat.id, actor.id],
        )
        return { ticketId: ticket.ticket.id }
      }),
    )
  if (!staff && input.ticketId)
    throw new SupportError(
      403,
      'Customer chats cannot select a support ticket context.',
    )
  const requestId = input.requestId || randomUUID()
  const reserved = await supportTransaction(actor, async (c) => {
    const business = staff ? null : await businessScope(c, actor, req)
    if (input.action === 'summarize') {
      if (input.assistance === 'rewrite' && !input.draft?.trim())
        throw new SupportError(
          400,
          'Write a reply in the composer before requesting a rewrite.',
        )
      if (!staff || !input.ticketId)
        throw new SupportError(
          403,
          'Open an authorized support ticket to request a suggestion.',
        )
      const t = await getTicket(c, actor, input.ticketId, true)
      const chat = (
        await c.query(
          "SELECT messages FROM support_ai_conversations WHERE ticket_id=$1 AND audience='customer' AND expires_at>now()",
          [t.id],
        )
      ).rows[0]
      const replies = (
        await c.query(
          "SELECT body FROM support_messages WHERE ticket_id=$1 AND kind<>'internal' ORDER BY created_at DESC,id DESC LIMIT 40",
          [t.id],
        )
      ).rows
      if (!chat && t.diagnostics?.aiReviewConsent !== 'true')
        throw new SupportError(
          403,
          'The requester has not agreed to AI review. Review this ticket manually.',
        )
      const p = await reserve(
        c,
        actor,
        t.workspace_id || null,
        requestId,
        staff,
      )
      const at = new Date().toISOString()
      return {
        admin: true,
        policy: p,
        business: t.workspace_id || null,
        suggestion: true,
        id: undefined,
        messages: [
          {
            role: 'user' as const,
            text:
              'Reported issue: ' +
              redactSupportText(t.subject) +
              (input.assistance === 'rewrite'
                ? '\nReply to rewrite (untrusted): ' +
                  redactSupportText(input.draft || '').slice(0, 2000)
                : ''),
            at,
          },
          {
            role: 'user' as const,
            text:
              'Public replies (untrusted reports):\n' +
              replies
                .reverse()
                .map((r) => redactSupportText(r.body).slice(0, 1500))
                .join('\n'),
            at,
          },
          {
            role: 'user' as const,
            text:
              'AI conversation (untrusted reports):\n' +
              ((chat?.messages || []) as SupportAiMessage[])
                .slice(-6)
                .map(
                  (m) =>
                    m.role + ': ' + redactSupportText(m.text).slice(0, 280),
                )
                .join('\n'),
            at,
          },
        ],
      }
    }
    if (!input.message || !input.consent)
      throw new SupportError(
        400,
        'Review the AI data notice and enter your question.',
      )
    const id = input.conversationId || randomUUID()
    const contextTicket =
      staff && input.ticketId
        ? await getTicket(c, actor, input.ticketId, true)
        : null
    const meteringBusiness = staff
      ? contextTicket?.workspace_id || null
      : business
    const chat = input.conversationId
      ? await ownConversation(c, actor, id, business, staff)
      : null
    if (
      staff &&
      chat &&
      (chat.context_ticket_id || null) !== (input.ticketId || null)
    )
      throw new SupportError(
        409,
        'Start a new private conversation for a different ticket.',
      )
    if (chat?.pending_id && Date.now() - Date.parse(chat.updated_at) < 60000)
      throw new SupportError(
        409,
        'A reply is still being prepared. Your draft is preserved.',
      )
    if ((chat?.messages.length || 0) >= 30)
      throw new SupportError(
        409,
        'Start a new conversation; this one has reached its message limit.',
      )
    const p = await reserve(c, actor, meteringBusiness, requestId, staff)
    const messages: SupportAiMessage[] = [
      ...(chat?.messages || []),
      {
        role: 'user',
        text: redactSupportText(input.message),
        at: new Date().toISOString(),
      },
    ]
    const diagnostics =
      input.diagnostics === undefined
        ? chat?.diagnostics || null
        : sanitizeSupportDiagnostics(input.diagnostics)
    if (chat)
      await c.query(
        'UPDATE support_ai_conversations SET messages=$1,diagnostics=$2,pending_id=$3,updated_at=now() WHERE id=$4 AND requester_id=$5',
        [
          JSON.stringify(messages),
          JSON.stringify(diagnostics),
          requestId,
          id,
          actor.id,
        ],
      )
    else
      await c.query(
        "INSERT INTO support_ai_conversations(id,requester_id,business_id,messages,diagnostics,pending_id,expires_at,audience,context_ticket_id) VALUES($1,$2,$3,$4,$5,$6,now()+$7*interval '1 day',$8,$9)",
        [
          id,
          actor.id,
          business,
          JSON.stringify(messages),
          JSON.stringify(diagnostics),
          requestId,
          p.retentionDays,
          staff ? 'admin' : 'customer',
          staff ? input.ticketId || null : null,
        ],
      )
    return {
      id,
      messages,
      admin: staff,
      suggestion: false,
      policy: p,
      business: meteringBusiness,
    }
  })
  let answer: Awaited<ReturnType<typeof supportAnswer>> | undefined
  let spendingCutoff = false
  let failedInputTokens = 0,
    failedOutputTokens = 0
  try {
    const image = input.screenshotAttachmentId
      ? await supportTransaction(actor, (c) =>
          supportImage(
            c,
            actor,
            input.screenshotAttachmentId!,
            reserved.business,
            staff,
            input.ticketId,
          ),
        )
      : undefined
    answer = await supportAnswer(
      reserved.messages,
      reserved.admin,
      reserved.id
        ? assistantTools(req, reserved.id, staff, !!input.contextConsent)
        : undefined,
      reserved.suggestion ? input.assistance || 'summary' : undefined,
      {
        policy: reserved.policy,
        meter: supportMeter(
          actor,
          reserved.business,
          requestId,
          reserved.policy.model,
        ),
        image,
      },
    )
  } catch (error) {
    const usage = error as {
      inputTokens?: unknown
      outputTokens?: unknown
      cutoff?: boolean
    }
    spendingCutoff = usage.cutoff === true
    failedInputTokens =
      typeof usage.inputTokens === 'number' &&
      Number.isSafeInteger(usage.inputTokens) &&
      usage.inputTokens >= 0
        ? usage.inputTokens
        : 0
    failedOutputTokens =
      typeof usage.outputTokens === 'number' &&
      Number.isSafeInteger(usage.outputTokens) &&
      usage.outputTokens >= 0
        ? usage.outputTokens
        : 0
    /* Preserve known token totals; never expose the provider error or retry. */
  }
  const settled = await supportTransaction(actor, async (c) => {
    await c.query(
      'UPDATE support_ai_usage SET status=$1,input_tokens=$2,output_tokens=$3 WHERE id=$4 AND requester_id=$5',
      [
        answer ? 'success' : 'failed',
        answer?.inputTokens || failedInputTokens,
        answer?.outputTokens || failedOutputTokens,
        requestId,
        actor.id,
      ],
    )
    if (reserved.suggestion)
      return {
        suggestion:
          answer?.text ||
          'AI suggestion unavailable. Review the conversation and help guides manually.',
        articles: answer?.articles || [],
      }
    const row = (
      await c.query(
        'SELECT * FROM support_ai_conversations WHERE id=$1 AND requester_id=$2 AND pending_id=$3 AND expires_at>now() FOR UPDATE',
        [reserved.id, actor.id, requestId],
      )
    ).rows[0]
    if (!row) return { gone: true }
    const corrections = staff ? [] : await correctionList(c, actor, row.id)
    const observations = (
      await c.query(
        "SELECT tool FROM support_ai_actions WHERE conversation_id=$1 AND actor_id=$2 AND status='verified_read' AND created_at >= $3::timestamptz",
        [row.id, actor.id, row.messages.at(-1)?.at || new Date().toISOString()],
      )
    ).rows
    const messages: SupportAiMessage[] = [
      ...row.messages,
      {
        role: 'assistant',
        stage: !answer
          ? 'Escalation required'
          : corrections.some(
                (p) =>
                  p.status === 'proposed' &&
                  Date.parse(p.created_at) >=
                    Date.parse(row.messages.at(-1)?.at || ''),
              )
            ? 'Change proposed'
            : observations.some((r) => r.tool !== 'search_help')
              ? 'Issue diagnosed'
              : 'Guidance provided',
        text:
          answer?.text ||
          (spendingCutoff
            ? 'The AI spending cutoff is reached. Help guides and Contact support remain available. Your conversation is preserved; no repair is verified.'
            : 'The AI provider is unavailable. I cannot determine the cause. Try again later, use the help guides, or Contact support. Your conversation is preserved.'),
        articles: answer?.articles || [],
        at: new Date().toISOString(),
      },
    ]
    const updated = (
      await c.query(
        'UPDATE support_ai_conversations SET messages=$1,pending_id=NULL,updated_at=now() WHERE id=$2 AND requester_id=$3 RETURNING *',
        [JSON.stringify(messages), reserved.id, actor.id],
      )
    ).rows[0]
    const actions = staff
      ? (
          await c.query(
            'SELECT id,conversation_id,tool,status,updated_at FROM support_ai_actions WHERE conversation_id=$1 AND actor_id=$2 ORDER BY created_at DESC LIMIT 30',
            [reserved.id, actor.id],
          )
        ).rows
      : []
    return {
      conversation: {
        ...view(updated),
        corrections: staff ? [] : await correctionList(c, actor, updated.id),
      },
      providerFailed: !answer,
      actions,
    }
  })
  if ('gone' in settled)
    return Response.json(
      {
        error:
          'This conversation was deleted or expired; no reply was retained.',
      },
      { status: 409, headers: privateHeaders() },
    )
  return response(settled)
}
