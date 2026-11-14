import type { BillingPolicyRow } from './billing-entitlements'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  AdminError,
  audit,
  hasRecentAdminVerification,
  type AdminClient,
} from './platform-admin-core'
import { limitedBody } from './support-core'
import type { AdminMetadata } from '../../src/lib/platform-admin-types'
import {
  assignableTierIssue,
  effectiveAccess,
  latestManualGrant,
} from './manual-access'
import { launchPricing, type PlanId } from '../../src/lib/launch-plans'

export async function handleAdminAccess(
  c: AdminClient,
  request: Request,
  session: AdminMetadata,
  reference: string,
) {
  if (
    !hasRecentAdminVerification(session) ||
    !['owner', 'admin'].includes(session.role)
  )
    throw new AdminError(
      403,
      'ADMIN_REQUIRED',
      'Verified platform administrator access is required.',
    )
  if (request.method !== 'POST')
    throw new AdminError(
      405,
      'POST_REQUIRED',
      'Use an access preview or confirmed change.',
    )
  const input = z
    .object({
      businessId: z.uuid(),
      operation: z.enum(['grant', 'revoke']),
      plan: z.string().max(100),
      source: z.enum([
        'owner_internal',
        'test',
        'complimentary',
        'support_override',
      ]),
      expiresAt: z.iso.datetime().nullable(),
      reason: z.string().trim().min(3).max(2000),
      confirmation: z.string().optional(),
    })
    .strict()
    .parse(JSON.parse((await limitedBody(request, 10000)).toString()))
  await c.query("SELECT set_config('app.platform_read','true',true)")
  const business = (
    await c.query(
      'SELECT id,business_name,identity_owner FROM businesses WHERE id=$1 FOR UPDATE',
      [input.businessId],
    )
  ).rows[0]
  if (!business?.identity_owner)
    throw new AdminError(
      404,
      'BUSINESS_NOT_FOUND',
      'A persisted business with an owner is required.',
    )
  const billing =
    (
      await c.query(
        'SELECT plan_id,status,source,paid_through,environment,entitlement_policy,subscription_id,updated_at FROM workspace_billing WHERE business_id=$1',
        [input.businessId],
      )
    ).rows[0] || null
  const previous = await latestManualGrant(c, input.businessId)
  if (input.operation === 'grant') {
    const issue = assignableTierIssue(input.plan)
    if (issue) throw new AdminError(409, 'TIER_CONFIGURATION', issue)
    if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now())
      throw new AdminError(
        400,
        'EXPIRY',
        'Expiration must be in the future, or choose no expiration.',
      )
  } else if (!previous || previous.operation === 'revoke')
    throw new AdminError(
      409,
      'NO_MANUAL_GRANT',
      'No manual override is available to revoke. Billing is unchanged.',
    )
  const next = {
    id: 'preview',
    plan_id:
      input.operation === 'revoke' ? previous!.plan_id : (input.plan as PlanId),
    operation: input.operation,
    grant_source: input.source,
    owner_identity: business.identity_owner,
    actor_identity: session.identity_id,
    reason: input.reason,
    created_at: new Date().toISOString(),
    expires_at: input.operation === 'revoke' ? null : input.expiresAt,
  }
  const current = effectiveAccess(
    billing as BillingPolicyRow | null,
    previous,
    business.identity_owner,
  )
  const after = effectiveAccess(
    billing as BillingPolicyRow | null,
    next,
    business.identity_owner,
  )
  const members = (
    await c.query(
      'SELECT count(DISTINCT identity_id)::int AS count FROM users WHERE business_id=$1 AND active=true',
      [input.businessId],
    )
  ).rows[0].count
  const plan = launchPricing.plans.find((p) => p.id === after.plan)
  const preview = {
    business,
    current,
    after,
    source: input.source,
    expiresAt: next.expires_at,
    reason: input.reason,
    billingContinues:
      !!billing?.subscription_id && billing.status !== 'cancelled',
    billingStatus: billing?.status || 'No billing subscription',
    billingNotice: billing?.subscription_id
      ? billing.status === 'cancelled'
        ? 'The recorded provider subscription is cancelled. This action does not restart it or change remaining paid-through coverage.'
        : 'The existing billed subscription remains in place and keeps charging according to its provider status. This action does not change or cancel it.'
      : 'Manual/internal access — no billing subscription. This action creates no payment, invoice or charge.',
    activeMembers: members,
    memberLimit: plan?.users ?? null,
    overLimit:
      typeof plan?.users === 'number' && Math.max(members, 1) > plan.users,
  }
  const confirmation = createHash('sha256')
    .update(
      JSON.stringify({
        input: { ...input, confirmation: undefined },
        business,
        billing,
        previous,
        current,
        after,
      }),
    )
    .digest('hex')
  if (!input.confirmation) return { preview, confirmation }
  if (input.confirmation !== confirmation)
    throw new AdminError(
      409,
      'ACCESS_CHANGED',
      'Access changed since preview. Review a fresh preview.',
    )
  const inserted = await c.query(
    'INSERT INTO complimentary_grants(business_id,owner_identity,actor_identity,plan_id,reason,grant_source,operation,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,plan_id,operation,grant_source,owner_identity,actor_identity,reason,created_at,expires_at',
    [
      business.id,
      business.identity_owner,
      session.identity_id,
      input.operation === 'revoke' ? previous!.plan_id : input.plan,
      input.reason,
      input.source,
      input.operation,
      input.operation === 'revoke' ? null : input.expiresAt,
    ],
  )
  await audit(
    c,
    session.identity_id,
    'access:' + input.operation,
    business.id,
    'success',
    reference,
    input.reason,
    { grant: previous, effective: current },
    { grant: inserted.rows[0], effective: after },
  )
  return { applied: true, preview }
}
