import { configuredTaxRates } from '../../src/lib/tax-configuration'
import { randomUUID } from 'node:crypto'
import type { Item, Workspace } from '../../src/lib/domain'
import { validateTaxRates } from '../../src/lib/domain'
import {
  categoryListSchema,
  categoryMappingsSchema,
  normalizedCategoryName,
  categoryImpact,
} from '../../src/lib/product-categories'

export async function handleProductCategories(
  req: Request,
  context: {
    state: Workspace
    role: string
    save: (table: string, item: Item) => Promise<void>
    client: { query: (sql: string) => Promise<unknown> }
  },
) {
  const { state, role, save, client } = context
  const settings = state.settings[0]
  if (!settings)
    throw new Error('Oven settings are unavailable. Retry loading categories.')
  let categories = categoryListSchema.parse(settings.productCategories || [])
  const revision = settings.categoryConfigRevision || 0
  const respond = async (extra = {}) => {
    await client.query('COMMIT')
    return Response.json(
      {
        categories,
        mappings: settings.categoryTaxMappings || {},
        rates: configuredTaxRates(settings),
        revision: settings.categoryConfigRevision || 0,
        products: state.products.map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          productCategoryId: p.productCategoryId,
          taxSource: p.taxSource,
          taxStatus: p.taxStatus,
          taxRateIds: p.taxRateIds,
          taxAssignments: p.taxAssignments,
          priceTaxMode: p.priceTaxMode,
        })),
        ...extra,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  }
  if (req.method === 'GET') return respond()
  if (req.method !== 'POST') throw new Error('Use GET or POST for categories.')
  if (!['Owner', 'Manager'].includes(role))
    throw new Error(
      'Only an Owner or Manager can manage product categories or tax mappings.',
    )
  if (Number(req.headers.get('content-length') || 0) > 30000)
    throw new Error('Category request is too large.')
  const input = await req.json()
  if (JSON.stringify(input).length > 30000)
    throw new Error('Category request is too large.')
  if (input.expectedRevision !== revision)
    throw new Error(
      'Category settings changed. Reload the list and review again; your form edits are preserved.',
    )
  let affected: Item[] = [],
    needsConfirmation = false,
    selectedId: string | undefined
  if (input.operation === 'saveCategory') {
    const previous = categories.find((c) => c.id === input.category?.id)
    if (input.category?.id && !previous)
      throw new Error('This saved category is unavailable in this oven.')
    const name =
      typeof input.category?.name === 'string'
        ? input.category.name.trim().replace(/\s+/g, ' ')
        : ''
    if (!name || name.length > 100)
      throw new Error('Enter a category name of 1–100 characters.')
    if (
      categories.some(
        (c) =>
          c.id !== previous?.id &&
          [c.name, ...(c.previousNames || [])].some(
            (value) =>
              normalizedCategoryName(value) === normalizedCategoryName(name),
          ),
      )
    )
      throw new Error('A product category with this name already exists.')
    if (
      !['food', 'non_food'].includes(input.category.classification) &&
      !(
        previous?.classification === null &&
        input.category.classification === null
      )
    )
      throw new Error('Choose Food or Non-food for this category.')
    const category = {
      ...previous,
      id: previous?.id || randomUUID(),
      name,
      ...(previous && previous.name !== name
        ? {
            previousNames: [
              ...new Set([...(previous.previousNames || []), previous.name]),
            ],
          }
        : {}),
      classification: input.category.classification,
    }
    if (previous && previous.classification !== category.classification) {
      needsConfirmation = true
      affected = categoryImpact(state.products, categories, previous.id)
    }
    categories = categoryListSchema.parse(
      previous
        ? categories.map((c) => (c.id === previous.id ? category : c))
        : [...categories, category],
    )
    selectedId = category.id
  } else if (input.operation === 'setCategoryActive') {
    const previous = categories.find((c) => c.id === input.categoryId)
    if (!previous)
      throw new Error('This saved category is unavailable in this oven.')
    if (typeof input.active !== 'boolean' || input.confirm !== true)
      throw new Error('Confirm the category archive or restore action.')
    affected = categoryImpact(state.products, categories, previous.id)
    if (!input.active && affected.length)
      throw new Error(
        `This category is linked to ${affected.length} products. Reassign them before archiving. No products or transaction records were changed.`,
      )
    categories = categories.map((c) =>
      c.id === previous.id ? { ...c, active: input.active } : c,
    )
  } else if (input.operation === 'saveMappings') {
    const mappings = categoryMappingsSchema.parse(input.mappings)
    const rates = configuredTaxRates(settings)
    validateTaxRates(rates)
    for (const ids of Object.values(mappings)) {
      if (
        new Set(ids).size !== ids.length ||
        ids.some(
          (id) => !rates.some((r: Item) => r.id === id && r.active !== false),
        )
      )
        throw new Error(
          'Select available tax treatments configured in this oven.',
        )
    }
    const changedClasses = ['food', 'non_food'].filter(
      (key) =>
        JSON.stringify(
          [...(settings.categoryTaxMappings?.[key] || [])].sort(),
        ) !==
        JSON.stringify(
          [...(mappings[key as keyof typeof mappings] || [])].sort(),
        ),
    )
    needsConfirmation = changedClasses.length > 0
    affected = categoryImpact(
      state.products,
      categories.filter((c) => changedClasses.includes(c.classification || '')),
    )
    settings.categoryTaxMappings = mappings
    settings.taxRates ??= rates
  } else throw new Error('Choose a supported category operation.')
  if (needsConfirmation && input.confirmAffected !== affected.length)
    throw new Error(
      `Review and confirm the change affecting ${affected.length} linked products. Completed transaction taxes remain unchanged.`,
    )
  settings.productCategories = categories
  settings.categoryConfigRevision = revision + 1
  await save('settings', settings)
  await save('activity', {
    id: randomUUID(),
    name:
      input.operation === 'saveMappings'
        ? 'Category tax mappings saved'
        : input.operation === 'setCategoryActive'
          ? input.active
            ? 'Product category restored'
            : 'Product category archived'
          : 'Product category saved',
    detail: `${affected.length} linked products reviewed; historical transactions preserved`,
    date: new Date().toISOString().slice(0, 10),
  })
  return respond({ selectedId })
}
