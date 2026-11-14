import { randomUUID } from 'node:crypto'
import type { Item, Workspace } from '../../src/lib/domain'
import {
  recipeCategories,
  recipeCategoryKey,
  recipeCategorySchema,
  recipeCategoryListSchema,
} from '../../src/lib/recipe-categories'

export async function handleRecipeCategories(
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
  if (!settings)
    throw new Error('Oven settings are unavailable. Reload and retry.')
  let categories = recipeCategories(state)
  const revision = settings.recipeCategoryRevision || 0
  if (req.method !== 'GET') {
    if (req.method !== 'POST')
      throw new Error('Use GET or POST for recipe categories.')
    if (!['Owner', 'Manager'].includes(role))
      throw new Error('Only an Owner or Manager can manage recipe categories.')
    const raw = await req.text()
    if (raw.length > 10000) throw new Error('Category request is too large.')
    const input = JSON.parse(raw)
    if (input.expectedRevision !== revision)
      throw new Error(
        'Recipe categories changed. Reload categories and review again; your edits are preserved.',
      )
    const categoryId =
      input.operation === 'saveCategory' ? input.category?.id : input.categoryId
    const previous = categories.find((c) => c.id === categoryId)
    if (input.operation === 'saveCategory') {
      if (input.category?.id && !previous)
        throw new Error('This recipe category is unavailable in this oven.')
      const category = recipeCategorySchema.parse({
        ...previous,
        id: previous?.id || randomUUID(),
        name:
          typeof input.category?.name === 'string'
            ? input.category.name.trim().replace(/\s+/g, ' ')
            : '',
        icon: input.category?.icon,
        previousNames:
          previous && previous.name !== input.category.name
            ? [...new Set([...previous.previousNames, previous.name])]
            : previous?.previousNames || [],
      })
      if (
        categories.some(
          (c) =>
            c.id !== category.id &&
            [c.name, ...c.previousNames].some(
              (n) => recipeCategoryKey(n) === recipeCategoryKey(category.name),
            ),
        )
      )
        throw new Error(
          'A recipe category with this name already exists, including archived categories.',
        )
      categories = previous
        ? categories.map((c) => (c.id === category.id ? category : c))
        : [...categories, category]
    } else if (input.operation === 'setCategoryActive') {
      if (!previous || typeof input.active !== 'boolean')
        throw new Error('Choose a saved category to archive or restore.')
      categories = categories.map((c) =>
        c.id === previous.id ? { ...c, active: input.active } : c,
      )
    } else throw new Error('Choose a supported recipe category operation.')
    settings.recipeCategories = recipeCategoryListSchema.parse(categories)
    settings.recipeCategoryRevision = revision + 1
    await save('settings', settings)
    await save('activity', {
      id: randomUUID(),
      name: 'Recipe categories updated',
      detail: 'Existing recipe data and historical costs preserved.',
      date: new Date().toISOString().slice(0, 10),
    })
  }
  await client.query('COMMIT')
  return Response.json(
    { categories, revision: settings.recipeCategoryRevision || 0 },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
