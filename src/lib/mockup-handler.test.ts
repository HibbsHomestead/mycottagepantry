import { describe, it, expect } from 'vitest'
import { prepareMockup } from '../../netlify/lib/mockup-handler'
import type { Workspace } from './domain'
const state: Workspace = {
  products: [
    { id: 'tote', name: 'Tote', workflow: 'handmade', stock: 30, price: 15 },
  ],
  graphic_assets: [
    { id: 'base', name: 'Blank' },
    { id: 'art', name: 'Artwork' },
  ],
}
const input = {
  productId: 'tote',
  name: 'Natural tote — front',
  composition: {
    version: 1,
    baseId: 'base',
    artworkId: 'art',
    placement: { x: 100, y: 200, width: 300, rotation: 0 },
    area: { x: 0, y: 0, width: 1000, height: 1000 },
    panelWidth: 0,
    panelHeight: 0,
    calibrated: false,
  },
}
const url = new URL('https://example.test/api/workspace?upload=1')
describe('mockup save boundary', () => {
  it('requires owner or manager permissions', () => {
    for (const role of ['Production Staff', 'Read-only Accountant', 'Member'])
      expect(() => prepareMockup(input, state, role, url)).toThrow(
        'Owner or Manager',
      )
    expect(prepareMockup(input, state, 'Manager', url).product.id).toBe('tote')
  })
  it('rejects cross-business products, sources, and revision references', () => {
    expect(() =>
      prepareMockup({ ...input, productId: 'foreign' }, state, 'Owner', url),
    ).toThrow('this business')
    expect(() =>
      prepareMockup(
        {
          ...input,
          composition: { ...input.composition, artworkId: 'foreign' },
        },
        state,
        'Owner',
        url,
      ),
    ).toThrow('this business')
    expect(() =>
      prepareMockup({ ...input, originalId: 'foreign' }, state, 'Owner', url),
    ).toThrow('this business')
  })
  it('uses existing handmade product entitlement without changing plans', () => {
    expect(() =>
      prepareMockup(input, state, 'Owner', url, {
        state: 'paid_active',
        plan: 'free',
        write: true,
        entitlementPolicy: 'legacy',
      }),
    ).toThrow('current plan')
  })
  it('keeps gallery opt-in and requires a separate primary confirmation', () => {
    const before = JSON.stringify(state),
      result = prepareMockup(input, state, 'Owner', url)
    expect(result.gallery).toBe(false)
    expect(result.primary).toBe(false)
    expect(JSON.stringify(state)).toBe(before)
    expect(() =>
      prepareMockup(
        { ...input, gallery: true, primary: true },
        state,
        'Owner',
        url,
      ),
    ).toThrow('Confirm')
    expect(
      prepareMockup(
        { ...input, gallery: true, primary: true, confirmPrimary: true },
        state,
        'Owner',
        url,
      ).primary,
    ).toBe(true)
  })
  it('saves a reusable blank without retaining the previous artwork', () => {
    const result = prepareMockup(
      { ...input, template: true },
      state,
      'Owner',
      url,
    )
    expect(result.metadata.mockup.artworkId).toBe('')
    expect(result.metadata.category).toBe('mockup-template')
  })
})
