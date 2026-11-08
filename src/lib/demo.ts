import {
  recipeCost,
  effectiveRecipeLines,
  productCosting,
  convert,
  baseUnit,
  type Workspace,
  type Item,
} from './domain'
const ingredient = (
  id: string,
  name: string,
  quantity: number,
  unit: string,
  cost: number,
  threshold: number,
  category: string,
  extra: Record<string, any> = {},
): Item => ({
  id,
  name,
  quantity,
  unit,
  cost,
  threshold,
  category,
  usedAs: 'ingredient',
  vendor: 'Sam’s Club',
  allergens: [],
  reviewed: true,
  statement: name,
  location: 'Dry storage',
  ...extra,
})
export function demoData(): Workspace {
  const data: Workspace = {
    ingredients: [
      ingredient(
        'flour',
        'Bread flour',
        38.5,
        'lb',
        10.95 / 25,
        10,
        'Flour & grains',
        {
          allergens: ['Wheat'],
          statement: 'Wheat Flour',
          subingredients: 'wheat flour, malted barley flour',
          priceChange: 8.2,
        },
      ),
      ingredient(
        'apflour',
        'All-purpose flour',
        22,
        'lb',
        0.46,
        8,
        'Flour & grains',
        { allergens: ['Wheat'] },
      ),
      ingredient(
        'sugar',
        'Granulated sugar',
        18.2,
        'lb',
        0.79,
        8,
        'Sugar & sweeteners',
      ),
      ingredient(
        'brown',
        'Brown sugar',
        3.2,
        'lb',
        1.12,
        5,
        'Sugar & sweeteners',
      ),
      ingredient('eggs', 'Large eggs', 42, 'each', 0.24, 24, 'Dairy & eggs', {
        allergens: ['Egg'],
        conversions: [
          {
            from: 'each',
            to: 'g',
            amountFrom: 1,
            amountTo: 50,
            verified: true,
            source: 'user-entered',
            notes: 'Demo saved shelled-egg weight; verify your eggs.',
          },
        ],
        location: 'Refrigerator',
        expires: '2026-10-30',
        vendor: 'Costco',
      }),
      ingredient(
        'butter',
        'Unsalted butter',
        2.5,
        'lb',
        3.49,
        5,
        'Dairy & eggs',
        {
          allergens: ['Milk'],
          subingredients: 'cream, natural flavoring',
          location: 'Refrigerator',
          vendor: 'Costco',
        },
      ),
      ingredient('milk', 'Whole milk', 0.75, 'l', 1.14, 2, 'Dairy & eggs', {
        allergens: ['Milk'],
        conversions: [
          {
            from: 'ml',
            to: 'g',
            amountFrom: 1,
            amountTo: 1.03,
            verified: true,
            source: 'user-entered',
            notes: 'Demo saved conversion; verify against your ingredient.',
          },
        ],
        expires: '2026-10-30',
        location: 'Refrigerator',
        vendor: 'Local grocery',
      }),
      ingredient(
        'yeast',
        'Instant yeast',
        18,
        'oz',
        0.32,
        4,
        'Baking essentials',
      ),
      ingredient(
        'vanilla',
        'Vanilla extract',
        3,
        'fl oz',
        8.99 / 4,
        4,
        'Baking essentials',
        { reviewed: false },
      ),
      ingredient(
        'cinnamon',
        'Ground cinnamon',
        12,
        'oz',
        0.44,
        4,
        'Spices & flavorings',
      ),
      ingredient(
        'salt',
        'Fine sea salt',
        28,
        'oz',
        0.08,
        6,
        'Baking essentials',
      ),
      ingredient(
        'chips',
        'Chocolate chips',
        6.5,
        'lb',
        2.98,
        3,
        'Chocolate & add-ins',
        {
          allergens: ['Milk', 'Soybeans'],
          subingredients:
            'sugar, chocolate, cocoa butter, milkfat, soy lecithin',
        },
      ),
      ingredient(
        'parchment',
        'Parchment paper',
        145,
        'each',
        0.07,
        30,
        'Supplies',
        { usedAs: 'supply', vendor: 'Online packaging supplier' },
      ),
      ingredient('boxes', 'Bakery boxes', 18, 'each', 0.22, 25, 'Packaging', {
        usedAs: 'packaging',
        vendor: 'Online packaging supplier',
      }),
      ingredient('bags', 'Bread bags', 82, 'each', 0.08, 30, 'Packaging', {
        usedAs: 'packaging',
        vendor: 'Online packaging supplier',
      }),
      ingredient(
        'prep-cream',
        'Vanilla Buttercream',
        650,
        'g',
        0.02,
        100,
        'Preps & fillings',
        { compoundRecipeId: 'cream' },
      ),
      ingredient(
        'prep-filling',
        'Cinnamon Filling',
        1104,
        'g',
        0.008,
        200,
        'Preps & fillings',
        { compoundRecipeId: 'filling', allergens: ['Milk'] },
      ),
      ingredient(
        'seals',
        'Tamper stickers',
        120,
        'each',
        0.02,
        30,
        'Packaging',
        { usedAs: 'packaging', vendor: 'Online packaging supplier' },
      ),
      ingredient(
        'labels',
        'Product labels',
        210,
        'each',
        0.04,
        50,
        'Packaging',
        { usedAs: 'packaging', vendor: 'Online packaging supplier' },
      ),
    ],
    recipes: [
      {
        id: 'bread',
        name: 'Homestyle White Bread',
        category: 'Breads',
        description: 'A soft, golden everyday loaf. A market favorite.',
        yield: 4,
        yieldUnit: 'loaves',
        laborMinutes: 25,
        laborRate: 18,
        overhead: 1.2,
        packagingCost: 0,
        lines: [
          { ingredientId: 'flour', quantity: 1200, unit: 'g' },
          { ingredientId: 'sugar', quantity: 90, unit: 'g' },
          { ingredientId: 'butter', quantity: 85, unit: 'g' },
          { ingredientId: 'milk', quantity: 300, unit: 'ml' },
          { ingredientId: 'yeast', quantity: 18, unit: 'g' },
          { ingredientId: 'salt', quantity: 22, unit: 'g' },
        ],
        instructions:
          'Mix and knead until smooth. Let rise for 60–90 minutes. Divide into four loaves, shape, and proof. Bake at 375°F for 30–35 minutes.',
      },
      {
        id: 'cookies',
        name: 'Chocolate Chip Cookies',
        category: 'Cookies',
        description: 'Crisp edges, soft centers, plenty of chocolate.',
        yield: 36,
        yieldUnit: 'cookies',
        laborMinutes: 30,
        laborRate: 18,
        overhead: 1.5,
        lines: [
          { ingredientId: 'apflour', quantity: 480, unit: 'g' },
          { ingredientId: 'butter', quantity: 225, unit: 'g' },
          { ingredientId: 'sugar', quantity: 150, unit: 'g' },
          { ingredientId: 'brown', quantity: 180, unit: 'g' },
          { ingredientId: 'eggs', quantity: 2, unit: 'each' },
          { ingredientId: 'chips', quantity: 340, unit: 'g' },
        ],
        instructions:
          'Cream butter and sugars. Add eggs. Fold in flour and chocolate. Scoop, chill, and bake at 350°F for 11 minutes.',
      },
      {
        id: 'rolls',
        name: 'Cinnamon Rolls',
        category: 'Pastries',
        description: 'Soft spirals with a generous cinnamon swirl.',
        yield: 12,
        yieldUnit: 'rolls',
        laborMinutes: 45,
        laborRate: 18,
        overhead: 1.8,
        lines: [
          { ingredientId: 'flour', quantity: 600, unit: 'g' },
          { ingredientId: 'prep-filling', quantity: 368, unit: 'g' },
          { ingredientId: 'milk', quantity: 250, unit: 'ml' },
          { ingredientId: 'yeast', quantity: 10, unit: 'g' },
        ],
        instructions:
          'Knead dough, let rise, fill with cinnamon sugar, roll and slice. Proof and bake at 350°F for 25 minutes.',
      },
      {
        id: 'cream',
        name: 'Vanilla Buttercream',
        category: 'Preps & fillings',
        compound: true,
        description: 'A small-batch frosting for cakes and cupcakes.',
        yield: 650,
        yieldUnit: 'g',
        laborMinutes: 10,
        laborRate: 18,
        overhead: 0.3,
        lines: [
          { ingredientId: 'butter', quantity: 225, unit: 'g' },
          { ingredientId: 'sugar', quantity: 400, unit: 'g' },
          { ingredientId: 'vanilla', quantity: 1, unit: 'tsp' },
        ],
        instructions:
          'Whip butter until fluffy; gradually beat in sugar and vanilla.',
      },
      {
        id: 'filling',
        name: 'Cinnamon Filling',
        category: 'Preps & fillings',
        compound: true,
        yield: 368,
        yieldUnit: 'g',
        laborMinutes: 5,
        overhead: 0,
        lines: [
          { ingredientId: 'butter', quantity: 170, unit: 'g' },
          { ingredientId: 'brown', quantity: 180, unit: 'g' },
          { ingredientId: 'cinnamon', quantity: 18, unit: 'g' },
        ],
      },
    ],
    products: [
      {
        id: 'loaf',
        name: 'Homestyle White Bread Loaf',
        recipeId: 'bread',
        unitsPerPackage: 1,
        price: 8,
        wholesale: 6,
        targetMargin: 65,
        packagingLines: [
          { ingredientId: 'bags', quantity: 1, unit: 'each', required: true },
          { ingredientId: 'labels', quantity: 1, unit: 'each', required: true },
          { ingredientId: 'seals', quantity: 1, unit: 'each', required: true },
        ],
        packagingId: 'bags',
        packagingQuantity: 1,
        netQuantity: 'Net Wt. 18 oz (510 g)',
        storage: 'Store in a cool, dry place. Enjoy within 4 days.',
      },
      {
        id: 'cookiepack',
        name: 'Half-Dozen Chocolate Chip Cookies',
        recipeId: 'cookies',
        unitsPerPackage: 6,
        price: 12,
        wholesale: 9,
        targetMargin: 65,
        packagingId: 'boxes',
        packagingQuantity: 1,
        netQuantity: 'Net Wt. 9 oz (255 g)',
      },
      {
        id: 'rollpack',
        name: 'Four-Pack Cinnamon Rolls',
        recipeId: 'rolls',
        unitsPerPackage: 4,
        price: 12,
        wholesale: 9,
        targetMargin: 65,
        packagingId: 'boxes',
        packagingQuantity: 1,
        netQuantity: 'Net Wt. 20 oz (567 g)',
      },
    ],
    batches: [
      {
        id: 'b1',
        name: 'Homestyle White Bread',
        recipeId: 'bread',
        count: 4,
        date: '2026-10-28',
        status: 'scheduled',
        yield: 16,
        note: 'Saturday farmers market',
      },
      {
        id: 'b2',
        name: 'Chocolate Chip Cookies',
        recipeId: 'cookies',
        count: 2,
        date: '2026-10-28',
        status: 'in_progress',
        yield: 72,
        note: 'Pre-orders + market',
      },
      {
        id: 'b3',
        name: 'Cinnamon Rolls',
        recipeId: 'rolls',
        count: 2,
        date: '2026-10-29',
        status: 'scheduled',
        yield: 24,
        note: 'Wholesale • The Corner Café',
      },
      {
        id: 'b4',
        name: 'Homestyle White Bread',
        recipeId: 'bread',
        count: 3,
        date: '2026-10-26',
        status: 'completed',
        yield: 12,
        historicalCost: 35.74,
        actualYield: 12,
        waste: 0,
      },
    ],
    sales: [
      {
        id: 's1',
        name: 'Saturday farmers market',
        date: '2026-10-24',
        productId: 'loaf',
        quantity: 68,
        amount: 544,
        tax: 0,
        fees: 14.14,
        channel: 'Farmers market',
      },
      {
        id: 's2',
        name: 'Cookie pre-orders',
        date: '2026-10-25',
        productId: 'cookiepack',
        quantity: 72,
        amount: 864,
        tax: 0,
        fees: 22.46,
        channel: 'Pre-order',
      },
      {
        id: 's3',
        name: 'Market bread sales',
        date: '2026-10-17',
        productId: 'loaf',
        quantity: 84,
        amount: 672,
        tax: 0,
        fees: 17.47,
        channel: 'Farmers market',
      },
      {
        id: 's4',
        name: 'Café cinnamon rolls',
        date: '2026-10-23',
        productId: 'rollpack',
        quantity: 48,
        amount: 576,
        tax: 0,
        fees: 0,
        channel: 'Wholesale',
      },
      {
        id: 's5',
        name: 'Custom cookie order',
        date: '2026-10-20',
        productId: 'cookiepack',
        quantity: 52,
        amount: 624,
        tax: 37.44,
        fees: 16.22,
        channel: 'Custom order',
      },
    ],
    expenses: [
      {
        id: 'e1',
        name: 'Bulk ingredient restock',
        date: '2026-10-20',
        amount: 246.85,
        category: 'Ingredients',
        vendor: 'Sam’s Club',
        inventory: true,
      },
      {
        id: 'e2',
        name: 'Saturday market stall',
        date: '2026-10-24',
        amount: 65,
        category: 'Market fees',
      },
      {
        id: 'e3',
        name: 'Commissary kitchen',
        date: '2026-10-01',
        amount: 280,
        category: 'Rent / commissary kitchen',
      },
      {
        id: 'e4',
        name: 'Boxes and bread bags',
        date: '2026-10-15',
        amount: 94.4,
        category: 'Packaging',
        inventory: true,
      },
      {
        id: 'e5',
        name: 'Business insurance',
        date: '2026-10-02',
        amount: 48.5,
        category: 'Insurance',
      },
      {
        id: 'e6',
        name: 'Market delivery',
        date: '2026-10-24',
        amount: 22.8,
        category: 'Delivery',
      },
    ],
    vendors: [
      'Sam’s Club',
      'Costco',
      'Restaurant Depot',
      'Local grocery',
      'Online packaging supplier',
    ].map((name, i) => ({ id: 'v' + i, name, terms: 'Due on receipt' })),
    orders: [
      {
        id: 'po1',
        name: 'PO-0024',
        vendor: 'Sam’s Club',
        amount: 186.42,
        date: '2026-10-30',
        status: 'ordered',
      },
      {
        id: 'po2',
        name: 'PO-0025',
        vendor: 'Online packaging supplier',
        amount: 94.4,
        date: '2026-11-02',
        status: 'ordered',
      },
    ],
    ledger: [
      {
        id: 'l1',
        name: 'Bread flour received',
        ingredientId: 'flour',
        quantity: 25,
        unit: 'lb',
        amount: 10.95,
        date: '2026-10-25',
        type: 'purchase_receipt',
        reason: '25 lb bag at $10.95',
      },
      {
        id: 'l2',
        name: 'Bread flour used',
        ingredientId: 'flour',
        quantity: -7.94,
        unit: 'lb',
        amount: -3.48,
        date: '2026-10-26',
        type: 'batch_consumption',
        reason: 'Batch HB-1026 • 12 loaves',
      },
    ],
    activity: [
      {
        id: 'a1',
        name: 'White bread batch completed',
        detail: '12 loaves · $35.74 batch cost',
        date: '2026-10-26',
        type: 'batch',
      },
      {
        id: 'a2',
        name: 'Bread flour received',
        detail: '25 lb from Sam’s Club · $10.95',
        date: '2026-10-25',
        type: 'inventory',
      },
      {
        id: 'a3',
        name: 'Market sales recorded',
        detail: 'Saturday farmers market · $544.00',
        date: '2026-10-24',
        type: 'sale',
      },
    ],
    settings: [
      {
        id: 'business',
        name: 'Hibbs Homestead Market',
        owner: 'Sarah Hibbs',
        email: 'sarah@hibbshomestead.example',
        address: '214 Meadow Lane, Springfield, MO 65802 · Demo address',
        jurisdiction: 'Missouri · demo oven',
        laborRate: 18,
        targetMargin: 65,
        taxRate: 0,
        disclaimer:
          'Made in a home kitchen. Review and customize this statement for your state’s cottage-food requirements.',
      },
    ],
  }
  // New workspaces store quantities in g/ml/each while keeping the baker's display units.
  for (const i of data.ingredients) {
    const originalUnit = i.unit
    const normalizedUnit = baseUnit(originalUnit, i.conversions)
    const factor = convert(1, originalUnit, normalizedUnit, i.conversions)
    i.storageUnit = originalUnit
    i.recipeUnit = normalizedUnit
    i.quantity *= factor
    i.threshold *= factor
    i.cost /= factor
    i.unit = normalizedUnit
  }
  Object.assign(
    data.ingredients.find((i) => i.id === 'flour')!,
    { purchaseQuantity: 25, purchaseUnit: 'lb', packagePrice: 10.95 },
  )
  for (const entry of data.ledger) {
    const i = data.ingredients.find((i) => i.id === entry.ingredientId)!
    entry.enteredQuantity = entry.quantity
    entry.enteredUnit = entry.unit
    const sign = entry.quantity < 0 ? -1 : 1
    entry.quantity =
      sign *
      convert(Math.abs(entry.quantity), entry.unit, i.unit, i.conversions)
    entry.unit = i.unit
  }
  rollup(data)
  for (const sale of data.sales) {
    const p = data.products.find((p) => p.id === sale.productId)!
    sale.historicalCogs = productCosting(p, data).perPackage * sale.quantity
  }
  return data
}

export function rollup(data: Workspace) {
  const linked = new Set<string>(),
    linking = new Set<string>()
  function link(r: Item) {
    if (linking.has(r.id))
      throw new Error(
        'A recipe cannot contain itself, directly or through another recipe.',
      )
    if (linked.has(r.id)) return
    linking.add(r.id)
    delete r.baseRecipe
    if (r.baseRecipeId) {
      const source = data.recipes.find((base) => base.id === r.baseRecipeId)
      if (!source)
        throw new Error('The linked base recipe is unavailable in this oven.')
      link(source)
      r.baseRecipe = source
    }
    linking.delete(r.id)
    linked.add(r.id)
  }
  for (const r of data.recipes) link(r)
  const done = new Set<string>(),
    visiting = new Set<string>()
  function update(i: Item) {
    if (done.has(i.id) || !i.compoundRecipeId) return
    if (visiting.has(i.id)) throw new Error('Compound recipe cycle detected.')
    visiting.add(i.id)
    const r = data.recipes.find((r) => r.id === i.compoundRecipeId)
    if (!r) throw new Error('Compound recipe is missing.')
    for (const line of effectiveRecipeLines(r, data.recipes)) {
      const child = data.ingredients.find((i) => i.id === line.ingredientId)
      if (child) update(child)
    }
    i.currentCost = recipeCost(r, data.ingredients) / r.yield
    const children = effectiveRecipeLines(r, data.recipes)
      .map((l: any) =>
        data.ingredients.find((child) => child.id === l.ingredientId),
      )
      .filter((child): child is Item => Boolean(child))
    i.componentAllergens = [
      ...new Set(
        children.flatMap((child: Item) => [
          ...(child.allergens || []),
          ...(child.componentAllergens || []),
        ]),
      ),
    ]
    i.componentReviewed =
      children.length > 0 &&
      children.every(
        (child: Item) =>
          child.reviewed === true &&
          (!child.compoundRecipeId || child.componentReviewed === true),
      )
    visiting.delete(i.id)
    done.add(i.id)
  }
  for (const i of data.ingredients) update(i)
}
