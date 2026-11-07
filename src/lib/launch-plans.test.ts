// @vitest-environment node
import { expect, it } from 'vitest'
import {
  launchFeatures,
  launchPricing,
  planIncludes,
  proposedRecordLimits,
  featureScopeLabel,
} from './launch-plans'
import {
  entitlementDecision,
  requireEntitlement,
} from '../../netlify/lib/entitlements'
import { billingFeatureAllowed } from '../../netlify/lib/billing-state'
import {
  requestFeatures,
  planGateDecision,
  enforcePlanFeatures,
} from '../../netlify/lib/plan-feature-gates'
import { selectedPlan } from './registration'

it('keeps approved paid prices, proposed Free, total seats and closed commercial controls centralized', () => {
  expect(
    launchPricing.plans.map((p) => [p.name, p.monthlyUsd, p.users]),
  ).toEqual([
    ['Free', 0, 1],
    ['Mixing Bowl', 10, 1],
    ['Baker’s Bench', 20, 1],
    ['Cottage Kitchen', 30, 2],
    ['Cottage Mercantile', 40, null],
  ])
  expect(
    launchPricing.plans.map((p) => [p.id, p.assignable, p.publication]),
  ).toEqual([
    ['free', true, 'draft'],
    ['mixing-bowl', true, 'draft'],
    ['bakers-bench', true, 'draft'],
    ['cottage-kitchen', true, 'draft'],
    ['cottage-mercantile', false, 'unpublished_draft'],
  ])
  expect(launchPricing.plans.some((p) => 'annualUsd' in p)).toBe(false)
  expect(launchPricing.checkoutEnabled).toBe(false)
  expect(launchPricing.signupEnabled).toBe(true)
  expect(launchPricing.restrictionsEnabled).toBe(false)
  expect(launchPricing.trialEnabled).toBe(false)
  expect(
    launchFeatures.some((f) => /^(ai|assistant|shopping|reminder)/i.test(f.id)),
  ).toBe(false)
})
it('keeps the entire verified solo-business core in every paid proposal without small record counts', () => {
  for (const plan of [
    'mixing-bowl',
    'bakers-bench',
    'cottage-kitchen',
    'cottage-mercantile',
  ] as const) {
    expect(Object.values(proposedRecordLimits[plan])).toEqual([
      null,
      null,
      null,
    ])
    for (const feature of [
      'costRecords',
      'recipeCosting',
      'costInputs',
      'productPricing',
      'recipeImport',
      'inventory',
      'reorder',
      'production',
      'standardLabels',
      'labels',
      'finance',
      'taxReports',
      'dataExport',
    ] as const) {
      expect(planIncludes(plan, feature)).toBe(true)
      expect(
        entitlementDecision({ plan, status: 'active' }, feature, 'write'),
      ).toBe(plan !== 'cottage-mercantile')
    }
  }
})
it('defines Free separately from paid scope and never counts cost-only records as stock-tracked items', () => {
  expect(proposedRecordLimits.free).toEqual({
    activeRecipes: 5,
    activeProducts: 5,
    activeStockTrackedItems: 10,
  })
  expect(proposedRecordLimits.free).not.toHaveProperty('costRecords')
  for (const feature of [
    'costRecords',
    'recipeCosting',
    'costInputs',
    'productPricing',
    'inventory',
    'reorder',
    'production',
    'standardLabels',
    'dataExport',
  ] as const)
    expect(planIncludes('free', feature)).toBe(true)
  for (const feature of [
    'finance',
    'taxReports',
    'labels',
    'recipeImport',
  ] as const)
    expect(planIncludes('free', feature)).toBe(false)
  expect(
    entitlementDecision(
      { plan: 'free', status: 'active' },
      'production',
      'write',
    ),
  ).toBe(false)
  expect(featureScopeLabel('free', 'production')).toMatch(
    /safe coverage needs refinement/,
  )
})
it('keeps unfinished upgrade capabilities unavailable independently of the paid plan', () => {
  for (const plan of launchPricing.plans) {
    for (const feature of [
      'multiBatchPlanning',
      'consolidatedRequirements',
      'periodComparisons',
      'invitations',
      'sharedAccess',
    ] as const)
      expect(
        entitlementDecision(
          { plan: plan.id, status: 'active' },
          feature,
          'write',
        ),
      ).toBe(false)
    expect(planIncludes(plan.id, 'dataExport')).toBe(true)
    expect(planIncludes(plan.id, 'accountEmail')).toBe(true)
    expect(planIncludes(plan.id, 'security')).toBe(true)
    expect(planIncludes(plan.id, 'support')).toBe(true)
  }
  expect(planIncludes('mixing-bowl', 'multiBatchPlanning')).toBe(false)
  expect(planIncludes('bakers-bench', 'multiBatchPlanning')).toBe(true)
  expect(planIncludes('cottage-kitchen', 'invitations')).toBe(true)
})
it('retains historical access and export while denying unassigned writes and expired legacy trials', () => {
  for (const trialEndsAt of [undefined, 'invalid', '2020-01-01'])
    expect(
      entitlementDecision(
        { plan: 'cottage-kitchen', status: 'trial', trialEndsAt },
        'production',
        'write',
      ),
    ).toBe(false)
  expect(() =>
    requireEntitlement(
      { plan: null, status: 'unassigned' },
      'recipeCosting',
      'write',
    ),
  ).toThrow()
  expect(
    entitlementDecision(
      { plan: 'free', status: 'read_only' },
      'finance',
      'read',
    ),
  ).toBe(true)
  expect(
    entitlementDecision(
      { plan: 'mixing-bowl', status: 'read_only' },
      'finance',
      'write',
    ),
  ).toBe(false)
  expect(
    entitlementDecision(
      { plan: null, status: 'read_only' },
      'dataExport',
      'export',
    ),
  ).toBe(true)
})
it('makes Cottage Mercantile inherit every lower-tier capability and keep its own scope exclusive', () => {
  const ids = launchPricing.plans.map((p) => p.id)
  for (const feature of launchFeatures)
    for (let i = 1; i < ids.length; i++)
      if (planIncludes(ids[i - 1], feature.id) && ids[i - 1] !== 'free')
        expect(planIncludes(ids[i], feature.id)).toBe(true)
  for (const feature of [
    'resaleMerchandise',
    'resalePackReceiving',
    'resaleModule',
    'consignment',
  ] as const) {
    expect(planIncludes('cottage-mercantile', feature)).toBe(true)
    expect(planIncludes('cottage-kitchen', feature)).toBe(false)
  }
  for (const feature of [
    'fabricInventory',
    'materialRemnants',
    'handmadeDesigns',
    'handmadeProduction',
    'crossTypeReceiptMatching',
    'activityReports',
  ] as const)
    expect(planIncludes('cottage-kitchen', feature)).toBe(true)
  expect(planIncludes('mixing-bowl', 'basicProductWorkflows')).toBe(true)
  expect(planIncludes('free', 'basicProductWorkflows')).toBe(false)
  for (const f of launchFeatures.filter((f) =>
    (f.plans as readonly string[]).every((p) => p === 'cottage-mercantile'),
  ))
    expect('testing' in f && f.testing).toBeTruthy()
})
it('keeps Cottage Mercantile out of public signup but billable at its approved price once paid', () => {
  expect(selectedPlan('cottage-mercantile')).toBe('free')
  expect(selectedPlan('cottage-kitchen')).toBe('cottage-kitchen')
  // Legacy subscription status labels never grant the unpublished tier.
  expect(
    entitlementDecision(
      { plan: 'cottage-mercantile', status: 'active' },
      'fabricInventory',
      'write',
    ),
  ).toBe(false)
  // Verified paid access (server-derived) includes its implemented workflows.
  expect(
    billingFeatureAllowed(
      { state: 'paid_active', plan: 'cottage-mercantile', write: true },
      'fabricInventory',
      'write',
    ),
  ).toBe(true)
  expect(
    billingFeatureAllowed(
      { state: 'paid_active', plan: 'cottage-kitchen', write: true },
      'fabricInventory',
      'write',
    ),
  ).toBe(true)
  expect(
    entitlementDecision(
      { plan: 'cottage-mercantile', status: 'read_only' },
      'dataExport',
      'export',
    ),
  ).toBe(true)
})
it('classifies indirect craft/resale paths from stored records and keeps restrictions disabled', () => {
  const url = new URL('https://example.test/api/workspace')
  const post = (body: any, existing?: any) =>
    requestFeatures({ method: 'POST', url, body, existing })
  expect(
    post({
      action: 'save',
      table: 'ingredients',
      item: { usedAs: 'material', inventoryCreation: true },
    }),
  ).toContain('fabricInventory')
  // A forged basic body cannot hide a stored resale product.
  expect(
    post(
      { action: 'receive', item: { id: 'p1' } },
      { id: 'p1', workflow: 'resale' },
    ),
  ).toContain('resalePackReceiving')
  expect(
    post(
      { action: 'save', table: 'products', item: { id: 'p1', workflow: '' } },
      { workflow: 'resale' },
    ),
  ).toContain('resaleMerchandise')
  expect(post({ action: 'fabricRemnant' })).toContain('materialRemnants')
  expect(post({ action: 'complete' }, { workflow: 'handmade' })).toContain(
    'handmadeProduction',
  )
  expect(
    post({
      action: 'import',
      table: 'products',
      rows: [{ workflow: 'handmade' }],
    }),
  ).toContain('handmadeCosting')
  expect(
    post({ action: 'receiptCreateItem', item: { usedAs: 'material' } }),
  ).toContain('crossTypeReceiptMatching')
  expect(
    requestFeatures({
      method: 'GET',
      url: new URL('https://example.test/api/workspace?productImport=x'),
      body: null,
    }),
  ).toContain('craftResaleEntryAssist')
  // Downgrade continuation: refunds and cancellations stay possible.
  expect(post({ action: 'refund' }, { workflow: 'resale' })).toEqual([])
  const kitchen = {
    state: 'complimentary',
    plan: 'cottage-kitchen',
    write: true,
  } as const
  expect(
    planGateDecision(kitchen, {
      method: 'POST',
      url,
      body: { action: 'fabricRemnant' },
    }).allowed,
  ).toBe(false)
  expect(launchPricing.restrictionsEnabled).toBe(false)
  expect(() =>
    enforcePlanFeatures(kitchen, {
      method: 'POST',
      url,
      body: { action: 'fabricRemnant' },
    }),
  ).not.toThrow()
})
