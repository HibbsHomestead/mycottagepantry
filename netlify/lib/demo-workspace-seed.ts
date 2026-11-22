import { demoData, rollup } from '../../src/lib/demo'
import {
  productCosting,
  units,
  type Item,
  type Workspace,
} from '../../src/lib/domain'
import { blankLabel, newElement } from '../../src/lib/label-studio'

/** Server-only fixture. Never mixed into an Identity-owned business. */
export function demoWorkspaceSeed(): Workspace {
  const seed = demoData()
  const today = new Date().toISOString().slice(0, 10)
  seed.settings = [
    {
      ...seed.settings[0],
      name: 'Cottage Pantry Demo Bakery',
      owner: 'Demo Baker (fictional)',
      email: 'baker@example.invalid',
      address: '100 Sample Lane · Fictional demo address',
      jurisdiction: 'Demo — review local rules',
      currency: 'USD',
      timezone: 'UTC',
      productCategories: [
        {
          id: 'demo-bread',
          name: 'Bread',
          classification: 'food',
          active: true,
        },
        {
          id: 'demo-cookies',
          name: 'Cookies',
          classification: 'food',
          active: true,
        },
        {
          id: 'demo-pastries',
          name: 'Pastries & muffins',
          classification: 'food',
          active: true,
        },
        {
          id: 'demo-handmade',
          name: 'Handmade gifts',
          classification: 'non_food',
          active: true,
        },
        {
          id: 'demo-resale',
          name: 'Pantry gifts',
          classification: 'food',
          active: true,
        },
        {
          id: 'demo-kits',
          name: 'Gift kits',
          classification: 'food',
          active: true,
        },
      ],
    },
  ]
  seed.units = Object.entries(units).map(([id, unit]) => ({
    id,
    name: id,
    ...unit,
  }))
  seed.vendors = [
    {
      id: 'demo-mill',
      name: 'Sample Mill (fictional)',
      email: 'mill@example.invalid',
    },
    {
      id: 'demo-packaging',
      name: 'Sample Packaging (fictional)',
      email: 'boxes@example.invalid',
    },
  ]
  for (const item of seed.ingredients) {
    item.vendor =
      item.usedAs === 'packaging'
        ? 'Sample Packaging (fictional)'
        : 'Sample Mill (fictional)'
    delete item.expires
    item.purchaseUnit ||= item.storageUnit || item.unit
    item.purchaseQuantity ||= item.unit === 'each' ? 100 : 1
    item.minimumOrderQuantity = item.unit === 'each' ? 100 : 1
    item.minimumOrderUnit = item.purchaseUnit
  }
  seed.ingredients.push(
    {
      id: 'blueberries',
      name: 'Blueberries',
      usedAs: 'ingredient',
      unit: 'g',
      recipeUnit: 'g',
      storageUnit: 'kg',
      quantity: 0,
      cost: 0.009,
      threshold: 500,
      purchaseUnit: 'kg',
      purchaseQuantity: 1,
      minimumOrderQuantity: 1,
      minimumOrderUnit: 'kg',
      category: 'Fruit',
      reviewed: true,
      allergens: [],
    },
    {
      id: 'cookie-bags',
      name: 'Cookie bags',
      usedAs: 'packaging',
      unit: 'each',
      quantity: 140,
      cost: 0.06,
      threshold: 30,
      purchaseUnit: 'pack',
      purchaseQuantity: 1,
      itemsPerPurchaseUnit: 100,
      minimumOrderQuantity: 2,
      minimumOrderUnit: 'pack',
      conversions: [
        {
          from: 'pack',
          to: 'each',
          amountFrom: 1,
          amountTo: 100,
          verified: true,
          source: 'user-entered',
        },
      ],
    },
    {
      id: 'pans',
      name: 'Paper baking pans',
      usedAs: 'packaging',
      unit: 'each',
      quantity: 5,
      cost: 0.45,
      threshold: 10,
      purchaseUnit: 'each',
      purchaseQuantity: 25,
      minimumOrderQuantity: 25,
      minimumOrderUnit: 'each',
    },
    {
      id: 'fabric-demo',
      name: 'Sample cotton fabric',
      usedAs: 'material',
      unit: 'm',
      recipeUnit: 'm',
      quantity: 12,
      cost: 4,
      threshold: 2,
      purchaseUnit: 'm',
      purchaseQuantity: 5,
      category: 'Craft materials',
    },
  )
  seed.recipes.push(
    {
      id: 'muffins',
      name: 'Blueberry Muffins',
      category: 'Muffins',
      yield: 12,
      yieldUnit: 'muffins',
      laborMinutes: 20,
      laborRate: 18,
      overhead: 1,
      lines: [
        { ingredientId: 'apflour', quantity: 300, unit: 'g' },
        { ingredientId: 'sugar', quantity: 180, unit: 'g' },
        { ingredientId: 'eggs', quantity: 2, unit: 'each' },
        { ingredientId: 'milk', quantity: 200, unit: 'ml' },
        { ingredientId: 'blueberries', quantity: 200, unit: 'g' },
      ],
      instructions: 'Fictional test recipe. Mix, portion, and bake until done.',
    },
    {
      id: 'bread-double',
      name: 'White bread · double batch',
      baseRecipeId: 'bread',
      baseMultiplier: 2,
      yield: 8,
      yieldUnit: 'loaves',
      laborMinutes: 40,
      laborRate: 18,
      overhead: 2.4,
      lines: [],
    },
    {
      id: 'napkin-design',
      name: 'Cotton napkins · sewing design',
      workflow: 'handmade',
      yield: 2,
      yieldUnit: 'each',
      laborMinutes: 20,
      laborRate: 18,
      overhead: 0.5,
      lines: [{ ingredientId: 'fabric-demo', quantity: 0.5, unit: 'm' }],
    },
  )
  for (const product of seed.products) {
    product.workflow = 'food'
    product.productCategoryId =
      product.id === 'loaf'
        ? 'demo-bread'
        : product.id === 'cookiepack'
          ? 'demo-cookies'
          : 'demo-pastries'
    product.category =
      product.id === 'loaf'
        ? 'Bread'
        : product.id === 'cookiepack'
          ? 'Cookies'
          : 'Pastries & muffins'
    product.quantity = 0
    const bag =
      product.id === 'cookiepack'
        ? 'cookie-bags'
        : product.id === 'loaf'
          ? 'bags'
          : 'boxes'
    product.packagingLines = [
      { ingredientId: bag, quantity: 1, unit: 'each', required: true },
      { ingredientId: 'labels', quantity: 1, unit: 'each', required: true },
    ]
    product.packagingId = bag
    product.netWeightStatus = 'unknown'
  }
  Object.assign(
    seed.products.find((p) => p.id === 'cookiepack')!,
    {
      name: 'Chocolate chip cookies · 3-pack',
      unitsPerPackage: 3,
      price: 7,
      wholesale: 5,
    },
  )
  seed.products.push(
    {
      id: 'muffinpack',
      name: 'Blueberry muffins · 2-pack',
      workflow: 'food',
      recipeId: 'muffins',
      unitsPerPackage: 2,
      price: 7,
      targetMargin: 65,
      productCategoryId: 'demo-pastries',
      quantity: 0,
      packagingLines: [
        { ingredientId: 'boxes', quantity: 1, unit: 'each', required: true },
        { ingredientId: 'labels', quantity: 1, unit: 'each', required: true },
      ],
    },
    {
      id: 'napkins',
      name: 'Cotton napkin pair',
      workflow: 'handmade',
      recipeId: 'napkin-design',
      unitsPerPackage: 2,
      quantity: 0,
      price: 18,
      targetMargin: 60,
      productCategoryId: 'demo-handmade',
    },
    {
      id: 'jam',
      name: 'Sample orchard jam',
      workflow: 'resale',
      quantity: 0,
      price: 8,
      threshold: 4,
      targetMargin: 45,
      productCategoryId: 'demo-resale',
      vendor: 'Sample Mill (fictional)',
    },
    {
      id: 'breakfast-kit',
      name: 'Weekend breakfast gift kit',
      workflow: 'kit',
      status: 'draft',
      quantity: 0,
      price: 32,
      targetMargin: 60,
      productCategoryId: 'demo-kits',
      assemblyMinutes: 4,
      assemblyRate: 18,
      kitComponents: [
        { productId: 'loaf', quantity: 1, basis: 'package' },
        { productId: 'cookiepack', quantity: 2, basis: 'package' },
      ],
      packagingLines: [
        { ingredientId: 'boxes', quantity: 1, unit: 'each' },
        { ingredientId: 'labels', quantity: 1, unit: 'each' },
      ],
    },
  )
  rollup(seed)
  seed.batches = [
    {
      id: 'demo-bread-plan',
      name: 'Market bread · planned',
      recipeId: 'bread',
      productId: 'loaf',
      count: 2,
      yield: 8,
      date: today,
      status: 'scheduled',
      note: 'Sample plan — no stock consumed yet.',
    },
    {
      id: 'demo-cookie-plan',
      name: 'Cookie preparation · planned',
      recipeId: 'cookies',
      productId: 'cookiepack',
      count: 1,
      yield: 36,
      date: today,
      status: 'scheduled',
    },
  ]
  seed.sales = seed.products
    .filter((p) => p.workflow === 'food')
    .map((p, index) => {
      const quantity = index + 2
      return {
        id: `demo-sale-${p.id}`,
        name: 'Fictional sample market sale',
        productId: p.id,
        date: today,
        quantity,
        amount: quantity * p.price,
        tax: 0,
        fees: 0,
        channel: 'Demo market',
        historicalCogs: productCosting(p, seed).perPackage * quantity,
      }
    })
  // Opening balances represent the stock AFTER the sample historical sales.
  // Historical sales are snapshots; they are not replayed as receipts/consumption.
  seed.ledger = seed.ingredients.map((item) => ({
    id: `demo-opening-${item.id}`,
    name: `${item.name} · opening balance`,
    ingredientId: item.id,
    quantity: item.quantity,
    unit: item.unit,
    amount: item.quantity * item.cost,
    date: today,
    type: 'opening_balance',
    reason: 'Fictional demo opening balance after historical examples',
  }))
  const flour = seed.ingredients.find((i) => i.id === 'flour')!
  const purchased = 25 * units.lb.factor
  const flourOpening = seed.ledger.find((l) => l.ingredientId === 'flour')!
  flourOpening.quantity -= purchased
  flourOpening.amount = flourOpening.quantity * flour.cost
  seed.ledger.push({
    id: 'demo-purchase-flour',
    name: 'Flour purchase · fictional supplier receipt',
    ingredientId: flour.id,
    quantity: purchased,
    unit: flour.unit,
    amount: purchased * flour.cost,
    date: today,
    type: 'purchase_receipt',
    vendor: 'Sample Mill (fictional)',
    purchaseQuantity: 25,
    purchaseUnit: 'lb',
    purchasePrice: purchased * flour.cost,
    reason: 'Sample purchase already included in the opening stock balance',
  })
  seed.orders = [
    {
      id: 'demo-order',
      name: 'DEMO-PO-001',
      vendor: 'Sample Packaging (fictional)',
      date: today,
      status: 'draft',
      amount: 100 * 0.06,
      lines: [
        {
          ingredientId: 'cookie-bags',
          quantity: 100,
          unit: 'each',
          price: 0.06,
        },
      ],
    },
  ]
  seed.expenses = [
    {
      id: 'demo-stall',
      name: 'Fictional market stall fee',
      date: today,
      amount: 35,
      category: 'Market fees',
    },
  ]
  seed.activity = [
    {
      id: 'demo-ready',
      name: 'Demo workspace ready',
      date: today,
      type: 'demo',
      detail:
        'Sample records only. Opening balances include historical examples; nothing was ordered or charged.',
    },
  ]
  seed.integrations = []
  const label = (id: string, name: string, productId?: string): Item => ({
    ...blankLabel(),
    id,
    name,
    width: 288,
    height: 144,
    workflowVersion: 1,
    recordKind: 'label',
    revision: 1,
    ...(productId
      ? { productId, source: { kind: 'product', id: productId } }
      : {}),
    elements: [
      {
        ...newElement('text', '', 'business.name'),
        id: `${id}-title`,
        width: 250,
      },
      {
        ...newElement('text', '', 'product.name'),
        id: `${id}-product`,
        y: 60,
        width: 250,
      },
    ],
  })
  const frontBack = label('demo-bread-label', 'Bread · front and back', 'loaf')
  frontBack.format = 'front-back'
  frontBack.manualTextReviewedFor = 'product:loaf:'
  frontBack.back = {
    ...blankLabel(),
    width: 288,
    height: 144,
    elements: [
      {
        ...newElement('text', 'Fictional demo label. Review before printing.'),
        id: 'demo-back-text',
        width: 250,
      },
    ],
  }
  const preserved = label('demo-preserved', 'Preserved shared sample design')
  delete preserved.workflowVersion
  delete preserved.recordKind
  seed.products.find((p) => p.id === 'rollpack')!.labelDesignId = preserved.id
  seed.products.find((p) => p.id === 'muffinpack')!.labelDesignId = preserved.id
  seed.label_templates = [
    frontBack,
    label('demo-cookies-label', 'Cookies · front only', 'cookiepack'),
    label('demo-reusable', 'Reusable market label'),
    preserved,
  ]
  return seed
}
