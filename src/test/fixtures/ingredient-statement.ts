import { demoData } from '../../lib/demo'
import {
  blankLabel,
  newElement,
  resolveLabelData,
} from '../../lib/label-studio'
import { labelLayout } from '../../lib/label-sets'
import { sourceKey } from '../../lib/saved-labels'
import { defaultSheet } from '../../lib/label-print-layout'

export const statement =
  'Ingredients: Chocolate chips (sugar, chocolate (cocoa mass, cocoa butter), soy lecithin, vanilla), Flour, enriched (wheat flour, vitamins (niacin, iron)), Sea Salt'
export const mainNames = ['Chocolate chips', 'Flour, enriched', 'Sea Salt']

export function ingredientStatementFixture() {
  const workspace = demoData()
  const source = { kind: 'product' as const, id: workspace.products[0].id }
  workspace.ingredients = [
    {
      id: 'chips',
      name: 'Chocolate chips',
      subingredients:
        'sugar, chocolate (cocoa mass, cocoa butter), soy lecithin, vanilla',
    },
    {
      id: 'flour',
      name: 'Flour, enriched',
      subingredients: 'wheat flour, vitamins (niacin, iron)',
    },
    { id: 'salt', name: 'Sea Salt', subingredients: '' },
  ].map((part) => ({
    ...part,
    statement: part.name,
    reviewed: true,
    unit: 'g',
    allergens: [],
  }))
  workspace.recipes[0] = {
    ...workspace.recipes[0],
    lines: workspace.ingredients.map((part, index) => ({
      ingredientId: part.id,
      quantity: 300 - index * 100,
      unit: 'g',
    })),
  }
  workspace.products[0].recipeId = workspace.recipes[0].id
  const element = {
    ...newElement('text', '', 'recipe.ingredients'),
    id: 'ingredients',
    x: 20,
    y: 20,
    width: 248,
    height: 150,
    font: 'DM Sans',
    fontSize: 10,
    bold: true,
    color: '#324536',
    align: 'left' as const,
    letterSpacing: 0.15,
  }
  const document = {
    ...blankLabel(),
    id: 'mixed-ingredient-weights',
    name: 'Nested ingredient label',
    width: 288,
    height: 216,
    labelType: 'Custom label',
    recordKind: 'label' as const,
    workflowVersion: 1 as const,
    renderVersion: 2 as const,
    revision: 1,
    source,
    productId: source.id,
    manualTextReviewedFor: sourceKey(source),
    format: 'front-back' as const,
    elements: [element],
    back: labelLayout({
      ...blankLabel(),
      width: 288,
      height: 216,
      elements: [{ ...element, rotation: 3 }],
    }),
    printSettings: {
      copies: 1,
      parts: 'both' as const,
      order: 'paired' as const,
      layout: { ...defaultSheet, mode: 'roll' as const },
      printingMethod: 'browser',
    },
  }
  workspace.label_templates = [document]
  workspace.label_recovery_drafts = []
  workspace.label_print_jobs = []
  return {
    workspace,
    source,
    document,
    data: resolveLabelData(workspace, source),
  }
}
