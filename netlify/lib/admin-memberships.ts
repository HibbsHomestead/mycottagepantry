import type { BillingPolicyRow } from './billing-entitlements'
import { effectiveAccess, latestManualGrant } from './manual-access'
import { launchPricing } from '../../src/lib/launch-plans'
import { z } from 'zod'
import { admin } from '@netlify/identity'
import { AdminError, audit, type AdminClient } from './platform-admin-core'
import type { AdminMetadata } from '../../src/lib/platform-admin-types'
import { limitedBody } from './support-core'
export async function adminMembership(
  c: AdminClient,
  request: Request,
  session: AdminMetadata,
  reference: string,
) {
  if (!session.mfa_at || !['owner', 'admin'].includes(session.role))
    throw new AdminError(
      403,
      'ADMIN_REQUIRED',
      'Verified platform administrator access is required.',
    )
  if (request.method !== 'POST')
    throw new AdminError(405, 'POST_REQUIRED', 'Use a confirmed change.')
  const input = z
    .object({
      businessId: z.uuid(),
      memberId: z.string().max(100),
      role: z.enum([
        'Owner',
        'Manager',
        'Production Staff',
        'Read-only Accountant',
      ]),
      active: z.boolean(),
      reason: z.string().trim().min(3).max(1000),
      confirm: z.literal(true),
    })
    .strict()
    .parse(JSON.parse((await limitedBody(request, 3000)).toString()))
  await c.query("SELECT set_config('app.platform_read','true',true)")
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,717))', [
    input.businessId,
  ])
  const business = (
    await c.query(
      'SELECT id,identity_owner FROM businesses WHERE id=$1 FOR UPDATE',
      [input.businessId],
    )
  ).rows[0]
  const member = (
    await c.query(
      'SELECT id,identity_id,role,active FROM users WHERE business_id=$1 AND id=$2 FOR UPDATE',
      [input.businessId, input.memberId],
    )
  ).rows[0]
  if (!business || !member)
    throw new AdminError(
      404,
      'MEMBER_NOT_FOUND',
      'No membership exists for this business and member.',
    )
  if (
    (member.identity_id === business.identity_owner ||
      member.role === 'Owner') &&
    (!input.active || input.role !== 'Owner')
  ) {
    const owners = (
      await c.query(
        "SELECT count(*)::int AS count FROM users WHERE business_id=$1 AND role='Owner' AND active=true AND id<>$2",
        [input.businessId, input.memberId],
      )
    ).rows[0].count
    if (!owners || member.identity_id === business.identity_owner)
      throw new AdminError(
        409,
        'OWNER_REQUIRED',
        'The primary or last business owner cannot be removed or demoted. Ownership transfer needs a separate reviewed workflow.',
      )
  }
  if (input.active && !member.active) {
    const billing = (
      await c.query(
        'SELECT plan_id,status,source,paid_through,environment,entitlement_policy FROM workspace_billing WHERE business_id=$1',
        [input.businessId],
      )
    ).rows[0]
    const resolved = effectiveAccess(
      billing as BillingPolicyRow | undefined,
      await latestManualGrant(c, input.businessId),
      business.identity_owner,
    )
    const tier = launchPricing.plans.find((p) => p.id === resolved.plan)
    if (resolved.suspended || (tier && tier.users === null))
      throw new AdminError(
        409,
        'MEMBERSHIP_BLOCKED',
        'Account security or the unresolved team allowance blocks activation.',
      )
    if (tier && tier.users !== null) {
      const count = (
        await c.query(
          'SELECT count(DISTINCT identity_id)::int AS count FROM users WHERE business_id=$1 AND active=true',
          [input.businessId],
        )
      ).rows[0].count
      if (count >= tier.users)
        throw new AdminError(
          409,
          'MEMBER_LIMIT',
          'The effective tier member limit is reached. Existing members are preserved.',
        )
    }
  }
  if (input.active) {
    const identity = await admin.getUser(member.identity_id)
    if (!identity.confirmedAt)
      throw new AdminError(
        409,
        'IDENTITY_UNVERIFIED',
        'The member must have a verified Identity account before activation.',
      )
  }
  // Scoped tenant setting reuses database member-limit triggers and existing RLS.
  await c.query("SELECT set_config('app.business_id',$1,true)", [
    input.businessId,
  ])
  await c.query(
    'UPDATE users SET role=$3,active=$4 WHERE business_id=$1 AND id=$2',
    [input.businessId, input.memberId, input.role, input.active],
  )
  await audit(
    c,
    session.identity_id,
    'membership:update',
    input.businessId,
    'success',
    reference,
    input.reason,
    member,
    {
      id: member.id,
      identity_id: member.identity_id,
      role: input.role,
      active: input.active,
    },
  )
  return { applied: true }
}
export async function adminIdentityStatus(c: AdminClient, identityId: string) {
  const identity = await admin.getUser(identityId)
  const memberships = (
    await c.query(
      'SELECT u.business_id,u.role,u.active,b.business_name FROM users u JOIN businesses b ON b.id=u.business_id WHERE u.identity_id=$1',
      [identityId],
    )
  ).rows
  return {
    id: identity.id,
    email: identity.email,
    confirmedAt: identity.confirmedAt || null,
    invitedAt: identity.invitedAt || null,
    memberships,
  }
}
