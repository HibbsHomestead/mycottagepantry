/* eslint-disable @typescript-eslint/no-explicit-any -- untyped Square provider JSON */
import type { AccessResult } from './billing-state'
import { planGateDecision } from './plan-feature-gates'
import {
  planBillable,
  type PlanId,
  type EntitlementPolicy,
} from '../../src/lib/launch-plans'
import { sandboxBillingPolicy } from '../../src/lib/registration'

type Row = {
  plan_id: PlanId | null
  status: string
  source: string
  paid_through?: string | Date | null
  environment?: string | null
  entitlement_policy?: EntitlementPolicy
}
export type BillingPolicyRow = Row
/** Server-side access for an oven billed through Square. Paid features apply only
 * while a verified paid period (plus Sandbox test grace) covers `now`; otherwise the
 * oven keeps Free-scope access and every record. Never derived from client input. */
export function squareBilledAccess(row: Row, now = Date.now()): AccessResult {
  const through = row.paid_through ? Date.parse(String(row.paid_through)) : NaN
  const grace =
    row.environment === 'sandbox'
      ? sandboxBillingPolicy.graceDays * 86400000
      : 0
  const covered =
    planBillable(row.plan_id) &&
    Number.isFinite(through) &&
    ((['paid_active', 'cancelled'].includes(row.status) && now < through) ||
      (row.status === 'past_due' && now < through + grace))
  return covered
    ? {
        state: row.status as AccessResult['state'],
        plan: row.plan_id,
        write: true,
        paidThrough: new Date(through).toISOString(),
        entitlementPolicy: row.entitlement_policy || 'legacy',
      }
    : {
        state: row.status as AccessResult['state'],
        plan: 'free',
        write: true,
        entitlementPolicy: row.entitlement_policy || 'legacy',
      }
}
export const isSquareBilled = (row: Row | undefined | null) =>
  !!row && ['square_sandbox', 'square_production'].includes(row.source)

const lookupTables = new Set(['ingredients', 'products', 'recipes', 'batches'])
/** Throws when a write uses a workflow outside the oven's current paid access.
 * Reads, exports, refunds, reversals and other continuations are always allowed. */
export async function enforceSquareBilledWrite(input: {
  client: { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> }
  org: string
  row: Row
  method: string
  url: URL
  body: any
  now?: number
}) {
  const access = squareBilledAccess(input.row, input.now)
  if (input.method !== 'POST') {
    const decision = planGateDecision(access, {
      method: input.method,
      url: input.url,
      body: null,
    })
    if (!decision.allowed) throw planError()
    return access
  }
  const body = input.body || {}
  const id = body.data?.id || body.data?.itemId || body.item?.id
  let existing: any
  // Classify from the server-stored record so a forged body cannot hide its workflow.
  if (id && lookupTables.has(body.table))
    existing = (
      await input.client.query(
        `SELECT data FROM ${body.table} WHERE business_id=$1 AND id=$2`,
        [input.org, String(id)],
      )
    ).rows[0]?.data
  if (
    !existing &&
    id &&
    ['receive', 'adjust', 'complete', 'fabricUpdate', 'fabricRemnant'].includes(
      body.action,
    )
  )
    for (const table of ['products', 'ingredients', 'batches']) {
      existing = (
        await input.client.query(
          `SELECT data FROM ${table} WHERE business_id=$1 AND id=$2`,
          [input.org, String(id)],
        )
      ).rows[0]?.data
      if (existing) break
    }
  const decision = planGateDecision(access, {
    method: 'POST',
    url: input.url,
    body,
    existing,
  })
  if (!decision.allowed) throw planError()
  return access
}
const planError = () =>
  new Error(
    'This workflow is not included in this oven’s current plan. Existing records, history and exports are preserved.',
  )
