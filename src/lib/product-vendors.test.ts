import { expect, it } from 'vitest'
import { ingredientVendor, matchProductVendors } from './product-vendors'

const vendors = [
  { id: 'sams', name: 'Sam’s Club' },
  { id: 'brand', name: 'Member’s Mark' },
  {
    id: 'other',
    name: 'Local Mill',
    website: 'https://www.mill.example/shop',
    aliases: ['The Mill'],
  },
]
it('matches normalized domains, retailer aliases and vendor names without treating brand as retailer', () => {
  expect(
    matchProductVendors(
      vendors,
      'Samsclub.com',
      'https://www.samsclub.com/ip/flour',
    ).map((v) => v.id),
  ).toEqual(['sams'])
  expect(matchProductVendors(vendors, "Sam's Club").map((v) => v.id)).toEqual([
    'sams',
  ])
  expect(
    matchProductVendors(vendors, 'Mill', 'https://mill.example/flour').map(
      (v) => v.id,
    ),
  ).toEqual(['other'])
  expect(matchProductVendors(vendors, 'The Mill').map((v) => v.id)).toEqual([
    'other',
  ])
  expect(matchProductVendors(vendors, 'Missing vendor')).toEqual([])
})
it('returns all ambiguous matches and resolves a selection by ID only within the oven', () => {
  const list = [
    ...vendors,
    { id: 'sams-2', name: "Sam's Club", website: 'https://samsclub.com' },
  ]
  expect(matchProductVendors(list, 'samsclub.com')).toHaveLength(2)
  expect(
    ingredientVendor({ vendorId: 'sams-2', vendor: 'Samsclub.com' }, list),
  ).toEqual({ vendorId: 'sams-2', vendor: "Sam's Club" })
  expect(() => ingredientVendor({ vendorId: 'foreign' }, list)).toThrow(
    'in this oven',
  )
  expect(
    ingredientVendor({}, list, {
      id: 'i',
      name: 'Flour',
      vendorId: 'sams',
      vendor: 'Sam’s Club',
    }),
  ).toEqual({ vendorId: 'sams', vendor: 'Sam’s Club' })
})
