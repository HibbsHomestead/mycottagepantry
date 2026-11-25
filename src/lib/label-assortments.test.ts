import { expect, it } from 'vitest'
import { assortmentFixture } from '../test/fixtures/label-assortments'
import { assortmentReview, normalizeAssortment } from './label-assortments'

const outer = { group: 0, component: -1 }

it.each([1, 2, 3])(
  'preserves %i separate flavor statements and packaging relationships',
  (flavors) => {
    const { workspace, plan } = assortmentFixture()
    plan.groups[0].lines = plan.groups[0].lines.slice(0, flavors)
    const before = JSON.stringify(workspace)
    const review = assortmentReview(workspace, plan, outer)
    expect(review.copies).toBe(2)
    expect(review.warnings).toEqual([])
    const body = review.document.elements[1].text
    expect(body.match(/Ingredients:/g)).toHaveLength(flavors)
    expect(body).toContain('Blueberry mix (Blueberry, cane sugar)')
    expect(body).toContain(
      '1 individual item · Blueberry muffin (loose in outer container)',
    )
    if (flavors > 1) {
      expect(body).toContain(
        '2 selling packages · Chocolate muffin (individually packaged)',
      )
      expect(body).toContain('CONTAINS: MILK')
      expect(body).toContain('Reviewed supplier advisory: May contain soy')
      expect(
        assortmentReview(workspace, plan, { group: 0, component: 1 })
          .copies,
      ).toBe(4)
    }
    if (flavors > 2) {
      expect(body).toContain(
        'Reviewed advisory: Made on shared equipment with tree nuts',
      )
      const item = assortmentReview(workspace, plan, {
        group: 0,
        component: 2,
      })
      expect(item.copies).toBe(6)
      expect(item.document.elements[1].text).not.toContain('18 oz')
    }
    expect(JSON.stringify(workspace)).toBe(before)
  },
)

it('requires actual combinations and validates fixed basket selling-package counts', () => {
  const { workspace, plan } = assortmentFixture()
  const [first, second, third] = plan.groups[0].lines
  plan.mode = 'variable'
  plan.groups = [
    { name: 'Morning', count: 1, lines: [first, second] },
    { name: 'Afternoon', count: 1, lines: [second, third] },
  ]
  expect(
    assortmentReview(workspace, plan, outer).document.elements[1].text,
  ).not.toContain('Lemon')
  expect(
    assortmentReview(workspace, plan, { ...outer, group: 1 }).document
      .elements[1].text,
  ).not.toContain('Blueberry')
  plan.groups[1].count = 2
  expect(() => normalizeAssortment(workspace, plan)).toThrow(/add up/)
  plan.mode = 'fixed'
  plan.groups = [{ name: '', count: 2, lines: [second, third] }]
  workspace.products.push({
    id: 'basket',
    name: 'Gift basket',
    workflow: 'kit',
    kitComponents: [
      { productId: second.productId, quantity: 2 },
      { productId: third.productId, quantity: 3 },
    ],
    packagingId: 'outer-box',
  })
  workspace.batches.push({
    id: 'packing',
    name: 'Gift basket run',
    lines: [
      {
        id: 'basket-line',
        name: 'Gift basket',
        productId: 'basket',
        quantity: 2,
      },
    ],
  })
  plan.runId = 'packing'
  plan.runLineId = 'basket-line'
  expect(() => normalizeAssortment(workspace, plan)).toThrow(
    /fixed selling-package/,
  )
  third.unit = 'package'
  expect(assortmentReview(workspace, plan, outer).warnings).toEqual([])
})

it('blocks missing data and unreadable layouts, invalidating review without changing a prior snapshot', () => {
  const { workspace, plan } = assortmentFixture()
  const approved = assortmentReview(workspace, plan, outer)
  const originalText = approved.document.elements[1].text
  workspace.ingredients[1].subingredients = ''
  workspace.ingredients[1].reviewed = false
  const missing = assortmentReview(workspace, plan, outer)
  expect(missing.warnings.join('\n')).toMatch(
    /verify allergens[\s\S]*subingredients/,
  )
  expect(missing.reviewKey).not.toBe(approved.reviewKey)
  expect(approved.document.elements[1].text).toBe(originalText)
  workspace.label_templates[0].height = 72
  const overflow = assortmentReview(workspace, plan, outer)
  expect(overflow.overflow).toBe(true)
  expect(overflow.document.elements[1].text).toContain('Lemon mix')
  expect(overflow.document.elements[1].fontSize).toBe(10)
})
