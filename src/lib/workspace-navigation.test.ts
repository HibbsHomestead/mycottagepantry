import { expect, it } from 'vitest'
import {
  destination,
  destinationHash,
  parseWorkspaceHash,
  sectionTabs,
} from './workspace-navigation'
it('gives every implemented tab a distinct round-trippable route', () => {
  const hashes = new Set<string>()
  for (const [section, tabs] of Object.entries(sectionTabs)) {
    for (const tab of tabs.length ? tabs : ['']) {
      const route = destination(section, tab)
      expect(route.section).toBe(section)
      expect(route.tab).toBe(tab)
      const hash = destinationHash(route)
      expect(hashes.has(hash)).toBe(false)
      hashes.add(hash)
      expect(parseWorkspaceHash(hash)).toMatchObject(route)
    }
  }
  expect(Object.keys(sectionTabs)).toHaveLength(9)
})
it('maps old shared destinations without losing existing functionality', () => {
  for (const [old, section, tab] of [
    ['#Pantry/Ingredients', 'Inventory', 'Ingredients'],
    ['#Pantry/Inventory%20ledger', 'Inventory', 'Movements'],
    ['#Pantry/Vendors', 'Purchasing', 'Suppliers'],
    ['#Pantry/Purchase%20orders', 'Purchasing', 'Purchase Orders'],
    ['#Recipes', 'Production', 'Recipes & Designs'],
    ['#Production/Batch%20runs', 'Production', 'Production Runs'],
    ['#Finances/Sales', 'Sales', 'Sales'],
    ['#Finances/Receipt%20inbox', 'Purchasing', 'Purchases & Receipts'],
    ['#Finances/Profit%20%26%20loss', 'Finance', 'Profit & Loss'],
    ['#Reports', 'Finance', 'Reports'],
    [
      '#Settings/Data%20Import%20%26%20Export',
      'Settings',
      'Data Import & Export',
    ],
    ['#Labels/My%20Labels', 'Labels', 'Saved Labels'],
  ])
    expect(parseWorkspaceHash(old)).toMatchObject({ section, tab })
  expect(
    parseWorkspaceHash(
      '#Inventory/Ingredients?search=flour&filter=Low+stock',
    ).query.get('search'),
  ).toBe('flour')
  expect(parseWorkspaceHash('#%xx')).toMatchObject({ section: 'Dashboard' })
})
