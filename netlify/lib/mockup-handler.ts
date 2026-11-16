import type { Item, Workspace } from '../../src/lib/domain'
import { validateComposition } from '../../src/lib/mockup'
import type { AccessResult } from './billing-state'
import { planGateDecision } from './plan-feature-gates'

/** Operates only on rows already loaded under the authenticated business and forced RLS. */
export function prepareMockup(
  input: Record<string, unknown>,
  state: Workspace,
  role: string,
  url: URL,
  access?: AccessResult,
) {
  if (!['Owner', 'Manager'].includes(role))
    throw new Error('Only an Owner or Manager can save mockups.')
  const product = state.products.find((p) => p.id === input.productId)
  if (!product)
    throw new Error(
      'Save a product in this business before creating its mockup.',
    )
  if (
    access &&
    !planGateDecision(access, {
      method: 'POST',
      url,
      body: { action: 'save', table: 'products', data: { id: product.id } },
      existing: product,
    }).allowed
  )
    throw new Error(
      'Product editing is unavailable on this business’s current plan.',
    )
  const composition = validateComposition(
    input.composition,
    state.graphic_assets,
  )
  const template = input.template === true
  if (!template && !composition.artworkId)
    throw new Error('Choose artwork before saving a mockup.')
  if (
    input.primary === true &&
    (input.confirmPrimary !== true || input.gallery !== true || template)
  )
    throw new Error(
      'Confirm replacing the primary product image and saving it to the gallery.',
    )
  if (
    input.originalId &&
    !state.graphic_assets.some(
      (a) =>
        a.id === input.originalId && a.productId === product.id && a.mockup,
    )
  )
    throw new Error('The original mockup is unavailable in this business.')
  const metadata: Partial<Item> = {
    name: String(input.name || 'Product mockup').slice(0, 100),
    category: template ? 'mockup-template' : 'product-mockup',
    mockup: template ? { ...composition, artworkId: '' } : composition,
    inProductGallery: input.gallery === true && !template,
    productId: product.id,
    originalMockupId: String(input.originalId || '').slice(0, 100),
  }
  return {
    product,
    metadata,
    gallery: input.gallery === true && !template,
    primary: input.primary === true && input.confirmPrimary === true,
  }
}
