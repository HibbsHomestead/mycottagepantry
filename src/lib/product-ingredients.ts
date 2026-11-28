import type { Item, Workspace } from './domain'
import { resolveLabelData, type LabelData } from './label-studio'

export type ProductIngredientSection = {
  name: string
  quantity?: string
  product?: Item
  recipe?: Item
  data?: LabelData
  issues: string[]
  children?: ProductIngredientSection[]
}

export function productIngredients(
  workspace: Workspace,
  product: Item,
): ProductIngredientSection {
  function visit(
    item: Item,
    path: Set<string>,
    quantity?: string,
  ): ProductIngredientSection {
    const name =
      [...new Set([item.name, item.flavor, item.variant].filter(Boolean))].join(
        ' · ',
      ) || 'New product'
    const section = { name, quantity, product: item }
    if (path.has(item.id))
      return {
        ...section,
        issues: ['Circular contents reference. Expansion stopped.'],
      }
    if (item.workflow === 'kit') {
      const nextPath = new Set(path).add(item.id)
      const children = (item.kitComponents || []).map(
        (line: Item): ProductIngredientSection => {
          const included = workspace.products.find(
            (candidate) => candidate.id === line.productId,
          )
          const unit =
            line.basis === 'unpackaged'
              ? line.contentUnit || 'loose'
              : 'packaged'
          const count = `×${line.quantity} · ${unit}`
          return included
            ? visit(included, nextPath, count)
            : {
                name: 'Unavailable included product',
                quantity: count,
                issues: [`Product ${line.productId} could not be found.`],
              }
        },
      )
      return {
        ...section,
        children,
        issues: children.length ? [] : ['No contents configured.'],
      }
    }
    const data = resolveLabelData(
      {
        ...workspace,
        products: [
          item,
          ...workspace.products.filter((candidate) => candidate.id !== item.id),
        ],
      },
      { kind: 'product', id: item.id },
    )
    if (data.nonFood) return { ...section, data, issues: [] }
    const recipe = workspace.recipes.find(
      (candidate) => candidate.id === item.recipeId,
    )
    const issues = data.warnings.flatMap((warning) => {
      if (
        warning.startsWith('Net weight needs review:') ||
        warning.includes('connected recipe is unavailable')
      )
        return []
      return [
        warning
          .replace(/ \[[^\]]+\]$/, '')
          .replace(
            /^Missing information: subingredients for (.*?);.*$/,
            'Subingredients missing for $1.',
          ),
      ]
    })
    if (item.workflow === 'resale' && !recipe && !data.supplierLabelSource)
      issues.push('No manufacturer ingredient statement on file.')
    if (item.workflow !== 'resale' && !recipe)
      issues.push(
        item.recipeId ? 'Linked recipe unavailable.' : 'No recipe linked.',
      )
    if (issues.some((issue) => !issue.startsWith('Allergen information not confirmed')) || !data.values['recipe.ingredients'])
      issues.push('Ingredient statement not reviewed.')
    if (
      !data.values['recipe.ingredients'] ||
      issues.some((issue) =>
        /allergen|subingredients|unavailable|no recipe|missing|invalid/i.test(
          issue,
        ),
      )
    )
      issues.push('Allergen information not confirmed.')
    return { ...section, recipe, data, issues: [...new Set(issues)] }
  }
  return visit(product, new Set())
}
