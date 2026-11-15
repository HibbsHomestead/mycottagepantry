import { randomUUID } from 'node:crypto'
import {
  supportAiPolicySchema,
  supportAiDefaults,
  supportRates,
} from '../../src/lib/support-ai'
import {
  supportTransaction,
  SupportError,
  type SupportActor,
} from './support-core'

export type MeterResponse = {
  model?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    prompt_tokens_details?: { cached_tokens?: number | null } | null
    cost?: number
  } | null
}
export type SupportMeter = (
  inputBound: number,
  maxOutput: number,
) => Promise<(response: MeterResponse) => Promise<void>>
export function tokenCostNano(input: number, cached: number, output: number) {
  return Math.ceil(
    ((input - cached) * supportRates.input +
      cached * supportRates.cachedInput +
      output * supportRates.output) *
      1000,
  )
}
export function supportMeter(
  actor: SupportActor,
  business: string | null,
  requestId: string,
  model: string,
): SupportMeter {
  return async (inputBound, maxOutput) => {
    if (
      !Number.isSafeInteger(inputBound) ||
      inputBound < 1 ||
      inputBound > 250000 ||
      !Number.isSafeInteger(maxOutput) ||
      maxOutput < 1 ||
      maxOutput > 1000
    )
      throw new SupportError(400, 'Invalid provider budget.')
    const id = randomUUID()
    const reserved = tokenCostNano(inputBound, 0, maxOutput)
    await supportTransaction(actor, async (c) => {
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtext('support-ai-spending'))",
      )
      await c.query("SELECT set_config('app.support_ai_counter','true',true)")
      const p = supportAiPolicySchema.parse(
        (
          await c.query(
            "SELECT data FROM support_ai_policy WHERE id='platform'",
          )
        ).rows[0]?.data || supportAiDefaults,
      )
      if (!p.enabled || p.model !== model)
        throw new SupportError(
          503,
          'AI configuration changed. Contact support remains available.',
        )
      const totals = (
        await c.query(
          `SELECT coalesce(sum(greatest(coalesce(cost_nano_usd,reserved_nano_usd),coalesce(provider_cost_usd*1000000000,0))),0)::text AS lifetime,
        coalesce(sum(greatest(coalesce(cost_nano_usd,reserved_nano_usd),coalesce(provider_cost_usd*1000000000,0))) FILTER (WHERE created_at>now()-interval '24 hours'),0)::text AS day,
        coalesce(sum(greatest(coalesce(cost_nano_usd,reserved_nano_usd),coalesce(provider_cost_usd*1000000000,0))) FILTER (WHERE created_at>now()-interval '24 hours' AND business_id=$1),0)::text AS business
        FROM support_ai_meter`,
          [business],
        )
      ).rows[0]
      if (
        Number(totals.lifetime) + reserved > p.lifetimeUsd * 1e9 ||
        Number(totals.day) + reserved > p.globalDailyUsd * 1e9 ||
        (business &&
          Number(totals.business) + reserved > p.businessDailyUsd * 1e9)
      )
        throw new SupportError(
          429,
          'AI spending cutoff reached. Help guides and human support remain available.',
        )
      await c.query(
        'INSERT INTO support_ai_meter(id,request_id,actor_id,business_id,model,reserved_nano_usd) VALUES($1,$2,$3,$4,$5,$6)',
        [id, requestId, actor.id, business, model, reserved],
      )
    })
    // A timeout, interrupted process, or missing usage leaves the reservation charged to the cutoff.
    return async (response) => {
      const u = response.usage
      const cached = u?.prompt_tokens_details?.cached_tokens || 0
      const valid =
        u &&
        [u.prompt_tokens, u.completion_tokens, cached].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ) &&
        cached <= u.prompt_tokens
      await supportTransaction(actor, async (c) => {
        await c.query(
          `UPDATE support_ai_meter SET returned_model=$1,status=$2,input_tokens=$3,cached_tokens=$4,output_tokens=$5,cost_nano_usd=$6,provider_cost_usd=$7 WHERE id=$8 AND actor_id=$9 AND status='reserved'`,
          [
            response.model || null,
            valid ? 'metered' : 'unknown',
            valid ? u.prompt_tokens : null,
            valid ? cached : null,
            valid ? u.completion_tokens : null,
            valid
              ? tokenCostNano(u.prompt_tokens, cached, u.completion_tokens)
              : null,
            typeof u?.cost === 'number' &&
            Number.isFinite(u.cost) &&
            u.cost >= 0
              ? String(u.cost)
              : null,
            id,
            actor.id,
          ],
        )
      })
    }
  }
}
