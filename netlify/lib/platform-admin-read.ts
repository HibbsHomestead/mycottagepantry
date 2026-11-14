import type { BillingPolicyRow } from './billing-entitlements'
import {
  effectiveAccess,
  latestManualGrant,
  assignableTierIssue,
} from './manual-access'
import { z } from 'zod'
import { launchPricing, launchFeatures } from '../../src/lib/launch-plans'
import { AdminError, type AdminClient } from './platform-admin-core'

export const adminSections = [
  'overview',
  'customers',
  'plans',
  'billing',
  'operations',
  'content',
  'audit',
] as const
const queryInput = z.object({
  section: z.enum(adminSections).default('overview'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  q: z.string().trim().max(120).default(''),
  kind: z.enum(['ovens', 'accounts']).default('ovens'),
  id: z.uuid().optional(),
})
const pageSize = 25
const customerWhere = `b.identity_owner IS NOT NULL`
const accountsCTE = `WITH account_memberships AS (
  SELECT u.identity_id,u.business_id,u.active,u.created_at FROM users u JOIN businesses b ON b.id=u.business_id WHERE ${customerWhere}
  UNION ALL SELECT b.identity_owner,b.id,true,b.created_at FROM businesses b WHERE ${customerWhere}
    AND NOT EXISTS(SELECT 1 FROM users u WHERE u.business_id=b.id AND u.identity_id=b.identity_owner)
), customer_accounts AS (SELECT identity_id,MIN(created_at) AS first_recorded_at,COUNT(DISTINCT business_id)::int AS oven_count,
  COUNT(*) FILTER(WHERE active=true)::int AS active_memberships,COUNT(*) FILTER(WHERE active=false)::int AS inactive_memberships
  FROM account_memberships GROUP BY identity_id)`
const billingProjection = `w.business_id,w.plan_id,w.source,w.status,w.paid_from,w.paid_through,w.updated_at,w.environment,w.entitlement_policy,w.last_reconciled_at,
  CASE WHEN w.subscription_id IS NOT NULL THEN '••••' || RIGHT(w.subscription_id,4) ELSE NULL END AS subscription_reference`
const billingNotice =
  'Billing provider identity remains explicit. Reconciliation uses verified provider state; timestamps alone do not prove successful payment. Existing Square billing remains release-gated and Stripe checkout controls are independent.'
export const diagnosticCoverage = [
  {
    area: 'Receipt PDF extraction',
    availability: 'recorded_metadata',
    detail:
      'Stored attempt statuses and references only. Receipt files, extracted text, line items and provider payloads are excluded.',
  },
  {
    area: 'Product URL imports',
    availability: 'unavailable',
    detail:
      'No persistent request history exists. Absence of records does not indicate health.',
  },
  {
    area: 'Label saves',
    availability: 'partial',
    detail:
      'Unresolved recovery draft references are available. They are recovery evidence, not a complete failure log.',
  },
  {
    area: 'Square subscriptions',
    availability: 'recorded_metadata',
    detail:
      'Environment-specific webhook references and successful synchronization records are available; absent evidence is not a healthy status.',
  },
  {
    area: 'Background processing',
    availability: 'partial',
    detail:
      'Support notification queue metadata is available. No general job monitor exists.',
  },
]

/** Explicit projections only. Never return a customer JSON record or a file key. */
export async function readAdministration(
  c: AdminClient,
  params: URLSearchParams,
) {
  const input = queryInput.parse(Object.fromEntries(params))
  await c.query("SELECT set_config('app.platform_read','true',true)")
  const offset = (input.page - 1) * pageSize
  if (input.section === 'overview') {
    const totals = (
      await c.query(`${accountsCTE} SELECT
      (SELECT count(*)::int FROM customer_accounts) AS customer_accounts,
      (SELECT count(*)::int FROM businesses b WHERE ${customerWhere}) AS ovens,
      (SELECT count(*)::int FROM customer_accounts WHERE first_recorded_at>=NOW()-INTERVAL '30 days') AS recent_accounts`)
    ).rows[0]
    const subscriptions = (
      await c.query(
        `SELECT w.plan_id,w.status,w.source,count(*)::int AS count FROM workspace_billing w JOIN businesses b ON b.id=w.business_id WHERE ${customerWhere} GROUP BY w.plan_id,w.status,w.source ORDER BY w.plan_id,w.status`,
      )
    ).rows
    const recent = (
      await c.query(
        `${accountsCTE} SELECT identity_id,first_recorded_at,oven_count FROM customer_accounts ORDER BY first_recorded_at DESC,identity_id LIMIT 8`,
      )
    ).rows
    const activity = (
      await c.query(
        'SELECT id,actor_id,action,target,outcome,created_at FROM platform_audit ORDER BY created_at DESC,id DESC LIMIT 8',
      )
    ).rows
    return {
      totals,
      subscriptions,
      recent,
      activity,
      asOf: new Date().toISOString(),
      definitions: {
        customer_accounts:
          'Distinct persisted owner/member Identity IDs attached to an owned Oven, including persisted test businesses. Anonymous demos and Identity accounts without an Oven are excluded.',
        ovens:
          'Current Ovens with an Identity owner, including persisted test businesses and excluding anonymous demos.',
        recent_accounts:
          'Accounts first recorded in Oven ownership/membership during the last 30 days; this is not the Identity signup timestamp.',
        subscriptions:
          'Current recorded plan, source and status counts. Subscription value is not collected revenue.',
        failed_jobs: 'Unavailable: there is no complete platform job registry.',
      },
    }
  }
  if (input.section === 'customers') {
    if (input.id) {
      const oven = (
        await c.query(
          `SELECT b.id,b.business_name,b.identity_owner,b.created_at FROM businesses b WHERE b.id=$1 AND ${customerWhere}`,
          [input.id],
        )
      ).rows[0]
      if (!oven)
        throw new AdminError(
          404,
          'OVEN_NOT_FOUND',
          'Oven not found in the customer directory.',
        )
      const memberships = (
        await c.query(
          'SELECT id,identity_id,role,active,created_at FROM users WHERE business_id=$1 ORDER BY created_at,id',
          [input.id],
        )
      ).rows
      const billing =
        (
          await c.query(
            `SELECT ${billingProjection} FROM workspace_billing w WHERE w.business_id=$1`,
            [input.id],
          )
        ).rows[0] || null
      const grants = (
        await c.query(
          'SELECT id,owner_identity,actor_identity,plan_id,created_at FROM complimentary_grants WHERE business_id=$1 ORDER BY created_at DESC',
          [input.id],
        )
      ).rows.map((r) => ({
        ...r,
        reason:
          'Recorded reason restricted to the existing billing audit; free text is excluded from this metadata view.',
        expiresAt: null,
      }))
      const manualGrant = await latestManualGrant(c, input.id)
      const effective = effectiveAccess(
        billing as BillingPolicyRow | null,
        manualGrant,
        oven.identity_owner,
      )
      const manualHistory = (
        await c.query(
          'SELECT id,plan_id,grant_source,operation,actor_identity,owner_identity,reason,expires_at,created_at FROM complimentary_grants WHERE business_id=$1 AND grant_source IS NOT NULL ORDER BY created_at DESC,id DESC',
          [input.id],
        )
      ).rows
      const integrations = (
        await c.query(
          `SELECT id,CASE WHEN data->>'status' IN ('connected','disconnected','not_connected','error','unavailable','Not connected') THEN data->>'status' ELSE 'unrecorded' END AS recorded_status,updated_at FROM integrations WHERE business_id=$1 ORDER BY id`,
          [input.id],
        )
      ).rows
      const activity = (
        await c.query(
          'SELECT id,actor_id,action,target,outcome,created_at FROM platform_audit WHERE target=$1 ORDER BY created_at DESC,id DESC LIMIT 30',
          [input.id],
        )
      ).rows
      const accessAudit = (
        await c.query(
          "SELECT actor_id,action,reason,before,after,created_at FROM platform_audit WHERE target=$1 AND action IN ('access:grant','access:revoke') ORDER BY created_at DESC,id DESC LIMIT 100",
          [input.id],
        )
      ).rows
      const operations = await operationalRecords(c, input.id)
      return {
        oven,
        effective,
        manualGrant,
        manualHistory,
        accessAudit,
        tierCatalog: launchPricing.plans.map((p) => ({
          ...p,
          issue: assignableTierIssue(p.id),
        })),
        memberships,
        billing,
        grants,
        integrations,
        activity,
        operations,
        accountStatus:
          'No global account-status field is recorded. Membership activity is shown separately.',
        access: {
          policy:
            'Security and active membership checks come first, then a valid explicit manual override, then billing-derived access. Unassigned legacy ovens retain existing registration access. Manual access never modifies provider billing.',
          commercialRestrictionsEnabled: launchPricing.restrictionsEnabled,
          temporaryOverrides:
            'Expired or revoked overrides return to billing-derived or existing unassigned access.',
        },
        notes:
          'Unavailable: a dedicated administrative notes store is not implemented.',
        billingNotice,
      }
    }
    const search = '%' + input.q.replace(/[\\%_]/g, '\\$&') + '%'
    if (input.kind === 'accounts') {
      const total = (
        await c.query(
          `${accountsCTE} SELECT count(*)::int AS count FROM customer_accounts WHERE identity_id ILIKE $1`,
          [search],
        )
      ).rows[0].count
      const rows = (
        await c.query(
          `${accountsCTE} SELECT * FROM customer_accounts WHERE identity_id ILIKE $1 ORDER BY first_recorded_at DESC,identity_id LIMIT $2 OFFSET $3`,
          [search, pageSize, offset],
        )
      ).rows
      return {
        rows,
        total,
        page: input.page,
        pageSize,
        kind: input.kind,
        note: 'This list includes accounts attached to completed customer businesses. Registrations awaiting business setup are excluded; absence here does not mean authentication signup failed. Search by stable Identity ID. Provider names and emails are not synchronized.',
      }
    }
    const where = `${customerWhere} AND (b.business_name ILIKE $1 OR b.id::text ILIKE $1 OR b.identity_owner ILIKE $1 OR EXISTS (SELECT 1 FROM workspace_billing filter_billing WHERE filter_billing.business_id=b.id AND (filter_billing.plan_id ILIKE $1 OR filter_billing.source ILIKE $1 OR filter_billing.status ILIKE $1)))`
    const total = (
      await c.query(
        `SELECT count(*)::int AS count FROM businesses b WHERE ${where}`,
        [search],
      )
    ).rows[0].count
    const rows = (
      await c.query(
        `SELECT b.id,b.business_name,b.identity_owner,b.created_at,w.plan_id,w.status AS billing_status,w.source,
      (SELECT count(*)::int FROM users u WHERE u.business_id=b.id AND u.active=true) AS active_members FROM businesses b
      LEFT JOIN workspace_billing w ON w.business_id=b.id WHERE ${where} ORDER BY b.created_at DESC,b.id LIMIT $2 OFFSET $3`,
        [search, pageSize, offset],
      )
    ).rows
    const resolvedRows = []
    for (const row of rows) {
      const grant = await latestManualGrant(c, row.id)
      const billing = (
        await c.query(
          'SELECT plan_id,status,source,paid_through,environment,entitlement_policy FROM workspace_billing WHERE business_id=$1',
          [row.id],
        )
      ).rows[0]
      resolvedRows.push({
        ...row,
        effective: effectiveAccess(
          billing as BillingPolicyRow | null,
          grant,
          row.identity_owner,
        ),
        manualGrant: grant,
      })
    }
    return {
      rows: resolvedRows,
      total,
      page: input.page,
      pageSize,
      kind: input.kind,
    }
  }
  if (input.section === 'plans') {
    const assignments = (
      await c.query(
        `SELECT w.plan_id,w.source,w.status,count(*)::int AS count FROM workspace_billing w JOIN businesses b ON b.id=w.business_id WHERE ${customerWhere} GROUP BY w.plan_id,w.source,w.status`,
      )
    ).rows
    return {
      pricing: launchPricing,
      features: launchFeatures,
      assignments,
      note: 'Five approved presentation tiers; paid activation remains gated. Kitchen includes two total users and excludes resale/consignment. Mercantile includes five users plus the owner (six total). Public comparison, plan selection and internal assignment are approved. All paid tiers are approved for Stripe test checkout, subject to validated provider setup and Price mappings. Mercantile live purchase approval is still required; visibility does not enable live charges.',
    }
  }
  if (input.section === 'billing') {
    const rows = (
      await c.query(
        `SELECT ${billingProjection},b.business_name FROM workspace_billing w JOIN businesses b ON b.id=w.business_id WHERE ${customerWhere} ORDER BY w.updated_at DESC,w.business_id LIMIT $1 OFFSET $2`,
        [pageSize, offset],
      )
    ).rows
    const total = (
      await c.query(
        `SELECT count(*)::int AS count FROM workspace_billing w JOIN businesses b ON b.id=w.business_id WHERE ${customerWhere}`,
      )
    ).rows[0].count
    const events = await billingEvents(c)
    const { billingConfiguration, PRODUCTION_BILLING_RELEASE_APPROVED } =
      await import('./square-billing')
    // Names of missing settings only; values are never read into this response.
    const connection = (['sandbox', 'production'] as const).map(
      (environment) => {
        const config = billingConfiguration(environment)
        return {
          environment,
          missing: config.missing,
          deploymentAllowed: config.contextAllowed,
          releaseApproved:
            environment === 'sandbox' || PRODUCTION_BILLING_RELEASE_APPROVED,
        }
      },
    )
    const checks = (
      await c.query(
        'SELECT DISTINCT ON (environment) environment,checked_at,ok,merchant_id,location_id,location_name,currency,country,missing,error_code FROM billing_connection_checks ORDER BY environment,checked_at DESC',
      )
    ).rows
    const mappings = (
      await c.query(
        'SELECT environment,plan_id,variation_id,amount_cents,cadence,verified_at FROM billing_plan_mappings ORDER BY environment,amount_cents',
      )
    ).rows
    const syncRuns = (
      await c.query(
        'SELECT DISTINCT ON (environment) environment,completed_at,checked,swept,failures FROM billing_sync_runs WHERE failures=0 AND (checked>0 OR swept>0) ORDER BY environment,completed_at DESC',
      )
    ).rows
    const webhookEvidence = (
      await c.query(
        'SELECT environment,merchant_id,max(received_at) AS verified_at FROM billing_events GROUP BY environment,merchant_id',
      )
    ).rows
    return {
      rows,
      total,
      page: input.page,
      pageSize,
      events,
      syncRuns,
      webhookEvidence,
      connection,
      checks,
      mappings,
      notice: billingNotice,
      lastSuccessfulProductionSync:
        syncRuns.find((r) => r.environment === 'production')?.completed_at ||
        null,
      managementUrl: 'https://squareup.com/dashboard/subscriptions',
      managementNote:
        'Square platform merchant dashboard; sign in to the platform billing merchant account. Customer-connected seller accounts are separate.',
    }
  }
  if (input.section === 'operations')
    return {
      coverage: diagnosticCoverage,
      records: await operationalRecords(c),
      events: await billingEvents(c),
      note: 'No retry actions are enabled. Deployment versions were not stored with these historical jobs.',
    }
  if (input.section === 'content')
    return {
      mode: 'source_catalogue',
      note: 'Stock templates are source-controlled. Draft persistence, versioned publishing and retirement require a new platform template registry. Customer copies and Oven-specific removals are preserved; this view never writes templates.',
    }
  const total = (
    await c.query('SELECT count(*)::int AS count FROM platform_audit')
  ).rows[0].count
  const rows = (
    await c.query(
      'SELECT id,actor_id,action,target,outcome,request_id,reason,before,after,created_at FROM platform_audit ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2',
      [pageSize, offset],
    )
  ).rows
  return {
    rows,
    total,
    page: input.page,
    pageSize,
    policy:
      'Append-only platform access and authentication history. No customer hard-delete, impersonation, restrictions, exports or bulk tools are available.',
  }
}
async function billingEvents(c: AdminClient) {
  return (
    await c.query(`SELECT id,environment,kind,CASE WHEN status IN ('pending','retry','failed','needs_review','processed') THEN status ELSE 'unrecorded' END AS status,attempts,
    CASE WHEN error_code IN ('CORRELATION_AND_PERIOD_PROOF_REQUIRED','SANDBOX_LOOKUP_FAILED') THEN error_code WHEN error_code IS NOT NULL THEN 'BILLING_PROCESSING_ERROR' ELSE NULL END AS error_code,
    received_at,processed_at FROM billing_events ORDER BY received_at DESC,id LIMIT 30`)
  ).rows
}
async function operationalRecords(c: AdminClient, oven?: string) {
  return (
    await c.query(
      `SELECT id,business_id,'receipt_extraction' AS area,
      CASE WHEN data->>'extractionStatus' IN ('queued','manual','processing','failed','needs_review','partial','not_configured') THEN data->>'extractionStatus' ELSE 'unrecorded' END AS status,
      CASE WHEN data->'extractionError'->>'code' IN ('provider_credentials_missing','provider_authentication','provider_rate_limited','provider_unavailable','provider_timeout','provider_request_failed','source_missing','source_changed') THEN data->'extractionError'->>'code'
        WHEN data->'extractionError' IS NOT NULL THEN 'EXTRACTION_ERROR' ELSE NULL END AS error_code,
      created_at,updated_at,NULL::text AS deployment_version FROM receipt_extractions WHERE ($1::uuid IS NULL OR business_id=$1)
      AND data->>'extractionStatus' IS NOT NULL
    UNION ALL SELECT id,business_id,'label_recovery', 'unresolved_recovery',NULL::text,created_at,updated_at,NULL::text FROM label_recovery_drafts
      WHERE ($1::uuid IS NULL OR business_id=$1) AND data->>'resolvedAt' IS NULL
    UNION ALL SELECT o.id::text,t.workspace_id,'support_notification',
      CASE WHEN o.status IN ('pending','processing','sent','failed','retry','suppressed','blocked','delivered') THEN o.status ELSE 'unrecorded' END,
      CASE WHEN o.error_code IS NULL THEN NULL ELSE 'NOTIFICATION_DELIVERY_ERROR' END,
      o.created_at,o.updated_at,NULL::text FROM support_outbox o JOIN support_tickets t ON t.id=o.ticket_id WHERE ($1::uuid IS NULL OR t.workspace_id=$1)
    ORDER BY updated_at DESC,id LIMIT 50`,
      [oven || null],
    )
  ).rows
}
