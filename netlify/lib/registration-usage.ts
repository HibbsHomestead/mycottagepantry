import type { Item, Workspace } from '../../src/lib/domain'
import { packagingLines, effectiveRecipeLines } from '../../src/lib/domain'
import { proposedRecordLimits, type PlanId } from '../../src/lib/launch-plans'
import type { RegistrationClient } from './registration-core'
const active = (item: Item) => item.active !== false && item.archived !== true
export async function assertRegistrationQuota(
  client: RegistrationClient,
  org: string,
  plan: PlanId | null,
  table: string,
  item: Item,
) {
  // No plan limits apply to complimentary or app-managed rows while unapproved.
  if (!plan) return
  const rule =
    table === 'recipes'
      ? 'activeRecipes'
      : table === 'products'
        ? 'activeProducts'
        : table === 'ingredients'
          ? 'activeStockTrackedItems'
          : null
  if (!rule) return
  const limit = proposedRecordLimits[plan][rule]
  if (limit === null) return
  const counts = (row: Item) =>
    active(row) && (table !== 'ingredients' || row.trackInventory !== false)
  const { rows } = await client.query(
    `SELECT id,data FROM ${table} WHERE business_id=$1`,
    [org],
  )
  const previous = rows.find((r) => r.id === item.id)?.data
  if (!counts(item) || (previous && counts(previous))) return
  if (rows.filter((r) => counts(r.data)).length >= limit)
    throw new Error(
      `Free supports ${limit} active ${table === 'ingredients' ? 'stock-tracked items' : table}. Your existing records are preserved.`,
    )
}
export function assertTestWorkspaceAction(
  plan: PlanId,
  method: string,
  requestUrl: URL,
  body: any,
) {
  if (method !== 'POST') {
    if (
      plan === 'free' &&
      [...requestUrl.searchParams.keys()].some((k) =>
        /label|font|recipeImport|productImport|receipt|assistant|price/i.test(
          k,
        ),
      )
    )
      throw new Error('This workflow is not available on Free.')
    return
  }
  if (plan !== 'free') return
  const allowed = [
    'save',
    'ingredientUpdate',
    'ingredientOffer',
    'pantryView',
    'pantrySort',
    'pantryNavigation',
    'appearance',
    'unit',
    'conversion',
    'receive',
    'adjust',
    'complete',
    'inventoryCountStart',
    'inventoryCountLine',
    'inventoryCountComplete',
    'inventoryCountCancel',
    'shelfMedia',
  ]
  if (!allowed.includes(body?.action))
    throw new Error(
      'This workflow is not available on Free. Records are preserved.',
    )
  if (
    body.action === 'save' &&
    ![
      'ingredients',
      'recipes',
      'products',
      'batches',
      'vendors',
      'settings',
    ].includes(body.table)
  )
    throw new Error('This record type is not available on Free.')
}
export function assertFullFreeStockCoverage(state: Workspace, batchId: string) {
  const batch = state.batches.find((r) => r.id === batchId)
  const recipe = state.recipes.find((r) => r.id === batch?.recipeId)
  if (!recipe) throw new Error('The batch recipe is unavailable.')
  const products = state.products.filter((p) => p.recipeId === recipe.id)
  const ids = [
    ...effectiveRecipeLines(recipe, state.recipes).map(
      (l: Item) => l.ingredientId,
    ),
    ...products.flatMap((p) =>
      packagingLines(p).map((l: Item) => l.ingredientId),
    ),
  ]
  if (
    ids.some(
      (id) =>
        !state.ingredients.find(
          (i) => i.id === id && i.trackInventory !== false,
        ),
    )
  )
    throw new Error(
      'Free batch completion requires tracked stock for every ingredient and packaging item. Nothing was completed.',
    )
}
