import { randomUUID } from 'node:crypto'
import type { Item, Workspace } from '../../src/lib/domain'
import {
  pantrySectionCategories,
  pantrySectionCategorySchema,
} from '../../src/lib/section-categories'
import { normalizedCategoryName } from '../../src/lib/product-categories'
import { validateCategoryTree } from '../../src/lib/category-details'

export async function handlePantryCategories(
  req: Request,
  {
    state,
    role,
    save,
    client,
  }: {
    state: Workspace
    role: string
    save: (table: string, item: Item) => Promise<void>
    client: { query: (sql: string) => Promise<unknown> }
  },
) {
  const settings = state.settings[0]
  if (!settings) throw new Error('Business settings unavailable.')
  let categories = pantrySectionCategories(state)
  const revision = settings.pantryCategoryRevision || 0
  let selectedId: string | undefined
  if (req.method !== 'GET') {
    if (req.method !== 'POST' || !['Owner', 'Manager'].includes(role))
      throw new Error('Only an Owner or Manager can manage categories.')
    const raw = await req.text()
    if (raw.length > 15000) throw new Error('Category request is too large.')
    const input = JSON.parse(raw)
    if (input.expectedRevision !== revision)
      throw new Error(
        'Categories changed. Reload categories and retry; your edits are preserved.',
      )
    const previous = categories.find(
      (c) => c.id === (input.category?.id || input.categoryId),
    )
    if (input.operation === 'saveCategory') {
      if (input.category?.id && !previous)
        throw new Error('Category unavailable in this business.')
      const category = pantrySectionCategorySchema.parse({
        ...previous,
        ...input.category,
        id: previous?.id || randomUUID(),
        name: String(input.category?.name || '')
          .trim()
          .replace(/\s+/g, ' '),
        needsReview: false,
        previousNames:
          previous &&
          previous.name !==
            String(input.category?.name || '')
              .trim()
              .replace(/\s+/g, ' ')
            ? [...new Set([...(previous.previousNames || []), previous.name])]
            : previous?.previousNames,
      })
      if (
        !['food-ingredients', 'packaging', 'handmade-materials'].includes(
          category.scope,
        )
      )
        throw new Error('Choose a pantry category section.')
      if (previous && previous.scope !== category.scope)
        throw new Error('A saved category cannot move to another section.')
      if (
        categories.some(
          (c) =>
            c.id !== category.id &&
            c.scope === category.scope &&
            (c.parentId || '') === (category.parentId || '') &&
            normalizedCategoryName(c.name) ===
              normalizedCategoryName(category.name),
        )
      )
        throw new Error(
          'A category with this name and parent already exists in this section.',
        )
      categories = previous
        ? categories.map((c) => (c.id === previous.id ? category : c))
        : [...categories, category]
      validateCategoryTree(categories)
      selectedId = category.id
    } else if (input.operation === 'setCategoryActive') {
      if (!previous || typeof input.active !== 'boolean')
        throw new Error('Choose a saved category and status.')
      categories = categories.map((c) =>
        c.id === previous.id ? { ...c, active: input.active } : c,
      )
    } else throw new Error('Unsupported category operation.')
    settings.pantryCategories = categories
    settings.pantryCategoryRevision = revision + 1
    await save('settings', settings)
    await save('activity', {
      id: randomUUID(),
      name: 'Pantry category updated',
      detail: 'Assignments, inventory and historical costs preserved.',
      date: new Date().toISOString().slice(0, 10),
    })
  }
  await client.query('COMMIT')
  return Response.json(
    { categories, revision: settings.pantryCategoryRevision || 0, selectedId },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
