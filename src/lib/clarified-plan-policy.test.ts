// @vitest-environment node
import { expect, it } from 'vitest'
import {
  assertPlanRecordWrite,
  planGateDecision,
} from '../../netlify/lib/plan-feature-gates'
import { providerBilledAccess } from '../../netlify/lib/billing-entitlements'
import type { AccessResult } from '../../netlify/lib/billing-state'
import type { Workspace } from './domain'
import { planUserLimit } from './launch-plans'

const url = new URL('https://example.invalid/api/workspace')
const kitchen: AccessResult = {
  state: 'paid_active',
  plan: 'cottage-kitchen',
  write: true,
  entitlementPolicy: 'kitchen-two-v1',
}
const mercantile: AccessResult = { ...kitchen, plan: 'cottage-mercantile' }
const state: Workspace = {
  products: [
    { id: 'resale', name: 'Purchased goods', workflow: 'resale' },
    { id: 'handmade', name: 'Made goods', workflow: 'handmade' },
  ],
  recipes: [],
  batches: [],
  sales: [],
  receipt_lines: [],
}

it('allows Kitchen handmade and material operations while rejecting resale and consignment directly', () => {
  for (const item of [
    { workflow: 'handmade' },
    { usedAs: 'material', materialType: 'fabric' },
  ])
    expect(
      planGateDecision(kitchen, {
        method: 'POST',
        url,
        body: { action: 'save', table: 'products', item },
      }).allowed,
    ).toBe(true)
  for (const body of [
    { action: 'save', table: 'products', item: { workflow: 'resale' } },
    { action: 'consignorSave', data: { name: 'Maker' } },
    { action: 'consignmentReceive', data: { quantity: 1 } },
    { action: 'consignmentSale', data: { quantity: 1 } },
  ]) {
    expect(
      planGateDecision(kitchen, { method: 'POST', url, body }).allowed,
    ).toBe(false)
    expect(
      planGateDecision(mercantile, { method: 'POST', url, body }).allowed,
    ).toBe(true)
  }
})

it('blocks forged workflow hints and indirect resale writes through sales, receipts and imports at the save boundary', () => {
  for (const [table, item] of [
    ['products', { id: 'resale', name: 'Changed', workflow: 'food' }],
    ['sales', { id: 'sale', name: 'Sale', productId: 'resale' }],
    [
      'receipt_lines',
      {
        id: 'line',
        name: 'Receipt line',
        itemTable: 'products',
        itemId: 'resale',
      },
    ],
    [
      'receipts',
      {
        id: 'receipt',
        name: 'Receipt',
        lines: [{ itemTable: 'products', itemId: 'resale' }],
      },
    ],
    ['consignment_items', { id: 'consigned', name: 'Consigned item' }],
  ] as const) {
    expect(() => assertPlanRecordWrite(kitchen, table, item, state)).toThrow(
      /excludes/,
    )
    expect(() =>
      assertPlanRecordWrite(mercantile, table, item, state),
    ).not.toThrow()
  }
  expect(() =>
    assertPlanRecordWrite(
      kitchen,
      'sales',
      { id: 'sale', name: 'Sale', productId: 'handmade' },
      state,
    ),
  ).not.toThrow()
})

it('preserves legacy access, historical reads/exports and committed corrections', () => {
  const legacy = { ...kitchen, entitlementPolicy: 'legacy' as const }
  expect(
    planGateDecision(legacy, {
      method: 'POST',
      url,
      body: { action: 'consignmentSale' },
    }).allowed,
  ).toBe(true)
  expect(
    planGateDecision(legacy, {
      method: 'POST',
      url,
      body: { action: 'fabricRemnant' },
    }).allowed,
  ).toBe(false)
  expect(() =>
    assertPlanRecordWrite(
      legacy,
      'sales',
      { id: 'sale', name: 'Sale', productId: 'resale' },
      state,
    ),
  ).not.toThrow()
  expect(
    planGateDecision(kitchen, { method: 'GET', url, body: null }).allowed,
  ).toBe(true)
  for (const action of [
    'refund',
    'returnFinishedSale',
    'consignmentRefund',
    'consignmentPayout',
  ])
    expect(
      planGateDecision(kitchen, { method: 'POST', url, body: { action } })
        .allowed,
    ).toBe(true)
  expect(() =>
    assertPlanRecordWrite(
      kitchen,
      'sales',
      { id: 'sale', name: 'Sale', productId: 'resale' },
      state,
      true,
    ),
  ).not.toThrow()
})

it('uses the server billing policy across paid and lapsed states with approved total seats', () => {
  const row = {
    plan_id: 'cottage-kitchen' as const,
    status: 'paid_active',
    source: 'square_sandbox',
    environment: 'sandbox',
    paid_through: '2099-01-01',
    entitlement_policy: 'kitchen-two-v1' as const,
  }
  expect(providerBilledAccess(row)).toMatchObject({
    plan: 'cottage-kitchen',
    entitlementPolicy: 'kitchen-two-v1',
  })
  expect(
    providerBilledAccess({ ...row, paid_through: '2020-01-01' }),
  ).toMatchObject({ plan: 'free', entitlementPolicy: 'kitchen-two-v1' })
  expect(
    providerBilledAccess({ ...row, entitlement_policy: undefined }),
  ).toMatchObject({ entitlementPolicy: 'legacy' })
  expect(planUserLimit('cottage-kitchen')).toBe(2)
  expect(planUserLimit('cottage-mercantile')).toBe(6)
})
