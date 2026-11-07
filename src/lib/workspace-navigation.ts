/** Canonical hash routes retain compatibility with previously shared workspace links. */
export const sectionTabs: Record<string, string[]> = {
  Dashboard: [],
  Products: ['All Products', 'Food', 'Handmade', 'Resale', 'Categories'],
  Inventory: [
    'Overview',
    'Ingredients',
    'Craft Materials',
    'Packaging',
    'Supplies',
    'Finished Goods',
    'Movements',
  ],
  Production: [
    'Overview',
    'Recipes & Designs',
    'Production Runs',
    'Waste & Adjustments',
  ],
  Sales: ['Sales', 'Consignment'],
  Purchasing: ['Purchases & Receipts', 'Suppliers', 'Purchase Orders'],
  Labels: [
    'Saved Labels',
    'Templates',
    'Brand Kit',
    'Graphics Library',
    'Print & Export',
    'Label Settings',
  ],
  Finance: [
    'Overview',
    'Money Activity',
    'Expenses',
    'Profit & Loss',
    'Cash Flow',
    'Tax Center',
    'Chart of Accounts',
    'Reports',
  ],
  Settings: [
    'Business Profile',
    'Appearance',
    'Taxes',
    'Integrations',
    'Units & Costing Defaults',
    'Inventory Rules',
    'Data Import & Export',
    'Team & Roles',
    'Backup / Data Management',
  ],
}
export type Destination = {
  section: string
  tab: string
  page: string
  sub: string
  filter: string
}
export function destination(name: string, section?: string): Destination {
  if (name === 'Production' && section === 'Label Studio')
    return destination('Labels', 'Templates')
  let main = name,
    tab = section || ''
  if (name === 'Products & Pricing') main = 'Products'
  if (name === 'Pantry') {
    if (section === 'Vendors' || section === 'Purchase orders') {
      main = 'Purchasing'
      tab = section === 'Vendors' ? 'Suppliers' : 'Purchase Orders'
    } else {
      main = 'Inventory'
      tab =
        section === 'Inventory ledger'
          ? 'Movements'
          : section === 'All items' || section === 'Receiving'
            ? 'Overview'
            : section === 'Craft materials'
              ? 'Craft Materials'
              : section || 'Overview'
    }
  }
  if (name === 'Recipes') {
    main = 'Production'
    tab = 'Recipes & Designs'
  }
  if (name === 'Reports') {
    main = 'Finance'
    tab = 'Reports'
  }
  if (name === 'Finances') {
    if (section === 'Sales' || section === 'Consignment') {
      main = 'Sales'
      tab = section
    } else if (section === 'Receipt inbox') {
      main = 'Purchasing'
      tab = 'Purchases & Receipts'
    } else if (section === 'Integrations') {
      main = 'Settings'
      tab = 'Integrations'
    } else {
      main = 'Finance'
      tab = section
        ? section.replace(/\b\w/g, (c) => c.toUpperCase())
        : 'Overview'
    }
  }
  if (name === 'Production')
    tab =
      (
        {
          'Batch planner': 'Overview',
          'Batch runs': 'Production Runs',
          'Waste / adjustments': 'Waste & Adjustments',
        } as Record<string, string>
      )[tab] || tab
  if (name === 'Labels') tab = tab === 'My Labels' ? 'Saved Labels' : tab
  if (!sectionTabs[main]) main = 'Dashboard'
  const specialFilter =
    main === 'Inventory' && ['Low stock', 'Expiring soon'].includes(tab)
      ? tab
      : ''
  if (!sectionTabs[main].includes(tab)) tab = sectionTabs[main][0] || ''
  let page = main,
    sub = tab,
    filter = specialFilter || 'All items'
  if (main === 'Products') page = 'Products & Pricing'
  if (main === 'Inventory') {
    page = 'Pantry'
    sub =
      tab === 'Movements'
        ? 'Inventory ledger'
        : tab === 'Finished Goods'
          ? 'Finished Goods'
          : 'All items'
    if (
      ['Ingredients', 'Craft Materials', 'Packaging', 'Supplies'].includes(tab)
    )
      filter = tab === 'Craft Materials' ? 'Craft materials' : tab
  }
  if (main === 'Production') {
    page = tab === 'Recipes & Designs' ? 'Recipes' : 'Production'
    sub =
      (
        {
          Overview: 'Batch planner',
          'Production Runs': 'Batch runs',
          'Waste & Adjustments': 'Waste / adjustments',
        } as Record<string, string>
      )[tab] || tab
  }
  if (main === 'Purchasing') {
    page = tab === 'Purchases & Receipts' ? 'Finances' : 'Pantry'
    sub =
      tab === 'Purchases & Receipts'
        ? 'Receipt inbox'
        : tab === 'Suppliers'
          ? 'Vendors'
          : 'Purchase orders'
  }
  if (main === 'Sales') {
    page = 'Finances'
    sub = tab
  }
  if (main === 'Finance') {
    page = tab === 'Reports' ? 'Reports' : 'Finances'
    sub =
      (
        {
          'Money Activity': 'Money activity',
          'Profit & Loss': 'Profit & loss',
          'Cash Flow': 'Cash flow',
          'Tax Center': 'Tax center',
          'Chart of Accounts': 'Chart of accounts',
        } as Record<string, string>
      )[tab] || tab
  }
  if (main === 'Labels') sub = tab === 'Saved Labels' ? 'My Labels' : tab
  return { section: main, tab, page, sub, filter }
}
export const destinationHash = (route: Destination) =>
  '#' +
  [route.section, route.tab].filter(Boolean).map(encodeURIComponent).join('/')
export function parseWorkspaceHash(hash: string) {
  try {
    const [path, query] = hash.replace(/^#/, '').split('?')
    const [name, tab] = path.split('/').map(decodeURIComponent)
    return {
      ...destination(name || 'Dashboard', tab),
      query: new URLSearchParams(query),
    }
  } catch {
    return { ...destination('Dashboard'), query: new URLSearchParams() }
  }
}
