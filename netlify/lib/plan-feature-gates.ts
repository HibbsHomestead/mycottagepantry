import {
  launchPricing,
  type FeatureId,
  type EntitlementPolicy,
} from '../../src/lib/launch-plans'
import type { Item, Workspace } from '../../src/lib/domain'
import { planWriteAllowed, type AccessResult } from './billing-state'

/**
 * Enforced only for ovens billed through Square (see billing-entitlements.ts);
 * legacy, complimentary and app-managed Free ovens keep unrestricted access while
 * `launchPricing.restrictionsEnabled` is false. Maps workspace API requests to stable feature keys so a
 * future plan gate cannot be bypassed through Add Item, receipts, barcode/URL
 * imports, production, sales, bulk import or label/export paths.
 *
 * Classification uses the server-stored record (`existing`) whenever one exists;
 * a client-supplied `workflow`/`usedAs` is only trusted for new records, and any
 * specialized hint in the body is gated even if the stored record is basic.
 * Admin permissions are never consulted here: subscription access is separate.
 */
type Body = Partial<Item> | null | undefined
type Stored = Partial<Item> | null | undefined
const isMaterial = (r: Stored) =>
  !!r &&
  (r.usedAs === 'material' ||
    ['fabric', 'yarn', 'other'].includes(r.materialType))
const isFabric = (r: Stored) => !!r && r.materialType === 'fabric'
const workflowOf = (r: Stored) =>
  r && ['handmade', 'resale'].includes(r.workflow) ? r.workflow : null

/** Continuing legitimate committed work is allowed after a downgrade. */
const continuationActions = new Set([
  'refund',
  'returnFinishedSale',
  'consignmentRefund',
  'consignmentPayout',
  'receiptCancel',
  'receiptDismissExtraction',
  'financeReverse',
  'inventoryCountCancel',
])

export type GateRequest = {
  method: string
  url: URL
  body: Body
  /** Stored row for body.id / body.itemId, loaded server-side under tenant RLS. */
  existing?: Stored
  policy?: EntitlementPolicy
}
export function requestFeatures({
  method,
  url,
  body,
  existing,
  policy,
}: GateRequest): FeatureId[] {
  const out = new Set<FeatureId>()
  const keys = [...url.searchParams.keys()]
  if (method !== 'POST') {
    if (keys.some((k) => /^(productImport|productVendors)$/.test(k)))
      out.add('craftResaleEntryAssist')
    if (keys.some((k) => /^recipeImport/.test(k))) out.add('recipeImport')
    if (keys.some((k) => /^(receiptUpload|receiptFile)$/.test(k)))
      out.add('crossTypeReceiptMatching')
    if (keys.some((k) => /^(labelPdf|printer|fontUpload)/.test(k)))
      out.add('labels')
    return [...out]
  }
  const action = String(body?.action || '')
  if (continuationActions.has(action)) return []
  const record = { ...(body?.item || body?.data || body || {}) }
  const target = existing || record
  const specialized =
    isMaterial(existing) ||
    isMaterial(record) ||
    workflowOf(existing) ||
    workflowOf(record)
  const wf = workflowOf(existing) || workflowOf(record)
  if (policy === 'kitchen-two-v1') {
    if (wf === 'resale') out.add('resaleModule')
    if (/^consign/.test(action) || /^consign/.test(String(body?.table || '')))
      out.add('consignment')
  }
  switch (action) {
    case 'save':
    case 'import': {
      const rows: Stored[] =
        action === 'import' && Array.isArray(body?.rows) ? body!.rows : [record]
      for (const row of rows) {
        const prior = action === 'save' ? existing : null
        if (isMaterial(prior) || isMaterial(row)) out.add('fabricInventory')
        const w = workflowOf(prior) || workflowOf(row)
        if (w === 'resale') out.add('resaleMerchandise')
        if (w === 'handmade')
          out.add(
            body?.table === 'recipes' ? 'handmadeDesigns' : 'handmadeCosting',
          )
        if (row?.stockChoice === 'existing' && w === 'resale')
          out.add('resaleOpeningStock')
        if (row?.barcode && specialized) out.add('craftResaleEntryAssist')
      }
      if (['sales', 'expenses'].includes(body?.table)) out.add('finance')
      break
    }
    case 'fabricUpdate':
      out.add('fabricInventory')
      break
    case 'fabricRemnant':
      out.add('materialRemnants')
      break
    case 'receive':
    case 'adjust':
      if (wf === 'resale')
        out.add(
          action === 'receive' ? 'resalePackReceiving' : 'resaleMovements',
        )
      else if (wf === 'handmade') out.add('basicProductWorkflows')
      else if (isFabric(target) || isMaterial(target))
        out.add('fabricInventory')
      else out.add('inventory')
      break
    case 'complete':
      out.add(wf === 'handmade' ? 'handmadeProduction' : 'production')
      break
    case 'ingredientBarcode':
      out.add(specialized ? 'craftResaleEntryAssist' : 'inventory')
      break
    case 'simpleSale':
    case 'consignmentSale':
      out.add('finance')
      break
    case 'consignorSave':
    case 'consignmentReceive':
      out.add('resaleMovements')
      break
    default:
      if (/^receipt/.test(action) || action === 'receivedDateCorrection')
        out.add(specialized ? 'crossTypeReceiptMatching' : 'inventory')
      else if (/^label/.test(action)) out.add('labels')
      else if (/^finance|^postJournal$/.test(action)) out.add('finance')
  }
  return [...out]
}

export function planGateDecision(access: AccessResult, request: GateRequest) {
  const features = requestFeatures({
    ...request,
    policy: access.entitlementPolicy,
  })
  const denied = features.filter((f) => !planWriteAllowed(access, f))
  return { features, denied, allowed: denied.length === 0 }
}

/** Final transactional write boundary: classify linked server-stored products as
 * well as request hints, covering receipts, imports, sales and production paths.
 * Legacy accounts are unchanged. Reads/exports and historical corrections stay available. */
export function assertPlanRecordWrite(
  access: AccessResult | undefined,
  table: string,
  item: Item,
  state: Workspace,
  continuation = false,
) {
  if (!access || access.entitlementPolicy !== 'kitchen-two-v1' || continuation)
    return
  const features = new Set<FeatureId>()
  if (/^consign/.test(table)) features.add('consignment')
  const visited = new Set<Item>()
  const inspect = (row: Item | undefined) => {
    if (!row || visited.has(row)) return
    visited.add(row)
    if (row.workflow === 'resale') features.add('resaleModule')
    if (row.consignorId || row.consignmentId) features.add('consignment')
    for (const [key, target] of [
      ['productId', 'products'],
      ['recipeId', 'recipes'],
      ['batchId', 'batches'],
    ] as const)
      if (row[key]) inspect(state[target]?.find((r) => r.id === row[key]))
    if (
      row.itemId &&
      ['products', 'recipes', 'ingredients'].includes(row.itemTable)
    )
      inspect(state[row.itemTable]?.find((r) => r.id === row.itemId))
    for (const line of row.lines || []) inspect(line)
    for (const line of row.kitComponents || []) inspect(line)
  }
  inspect(state[table]?.find((r) => r.id === item.id))
  inspect(item)
  for (const feature of features)
    if (!planWriteAllowed(access, feature))
      throw new Error(
        'This plan excludes the resale or consignment module. Existing records, history and exports are preserved.',
      )
}

/** No-op while commercial restrictions are disabled, so existing access is unchanged. */
export function enforcePlanFeatures(
  access: AccessResult,
  request: GateRequest,
) {
  if (!launchPricing.restrictionsEnabled) return
  const { allowed } = planGateDecision(access, request)
  if (!allowed)
    throw new Error(
      'This workflow is not included in this oven’s plan. Existing records, history and exports are preserved.',
    )
}
