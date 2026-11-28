import { useId, useState } from 'react'
import { effectiveRecipeLines, type Item, type Workspace } from '@/lib/domain'
import {
  productIngredients,
  type ProductIngredientSection,
} from '@/lib/product-ingredients'
import {
  supplierLabelLimits,
  supplierLabelSource,
  type SupplierLabelSource,
} from '@/lib/supplier-label-source'
import './product-ingredients.css'
import { IngredientModeReview, LabelSourceAllergenReview, ProductAllergenReview, type ReviewMutation } from './label-ingredient-review'

const recipeUrl = (id: string) =>
  `/oven?recipe=${encodeURIComponent(id)}#Recipes`

type Props = {
  product: Item
  workspace: Workspace
  onReviewIngredient?: (item: Item) => void
  onReviewProduct?: (item: Item) => void
  onReviewRecipeLink?: () => void
  onOpenLabels?: () => void
  onSupplierChange?: (value: SupplierLabelSource) => void
  onIngredientOptionsChange?: (key: string, value: unknown) => void
  onReviewAllergens?: ReviewMutation
  isDraft?: boolean
}

function issueCount(section: ProductIngredientSection): number {
  return (
    Number(section.issues.length > 0) +
    (section.children || []).reduce(
      (count, child) => count + issueCount(child),
      0,
    )
  )
}

export function ProductIngredients(props: Props) {
  const { product, workspace, onOpenLabels, onSupplierChange, isDraft } = props
  const title = useId()
  const section = productIngredients(workspace, product)
  if (section.data?.nonFood) return null
  const issues = issueCount(section)
  return (
    <section className="product-ingredients" aria-labelledby={title}>
      <header>
        <div>
          <h3 id={title}>Ingredients &amp; allergens</h3>
          <p>
            {isDraft ? 'Draft product sources' : 'Current product sources'} ·
            not an approved or printed label snapshot.
          </p>
        </div>
        {onOpenLabels && (
          <button type="button" className="text-button" onClick={onOpenLabels}>
            Open Label Studio
          </button>
        )}
      </header>
      {section.children && issues > 0 && (
        <p className="product-ingredients-status">
          {issues} {issues === 1 ? 'entry needs' : 'entries need'} source
          review. Expand an entry for details.
        </p>
      )}
      <SourceDetails section={section} props={props} />
      {section.data?.ingredientMerge && <IngredientModeReview preview={section.data.ingredientMerge} change={props.onIngredientOptionsChange} />}
      {onSupplierChange && product.workflow === 'resale' && (
        <SupplierSourceFields product={product} change={onSupplierChange} />
      )}
    </section>
  )
}

function SourceDetails({
  section,
  props,
}: {
  section: ProductIngredientSection
  props: Props
}) {
  const {
    workspace,
    onReviewIngredient,
    onReviewProduct,
    onReviewRecipeLink,
    onSupplierChange,
  } = props
  const { data, issues, recipe, product, children } = section
  const [copyStatus, setCopyStatus] = useState('')
  const statement = data?.values['recipe.ingredients']
  const allergens = data?.values['recipe.allergens']
  const supplier = data?.supplierLabelSource
  const needsAllergenReview = issues.includes(
    'Allergen information not confirmed.',
  )
  const sourceIssues = Object.entries(data?.sourceRecords || {}).flatMap(
    ([warning, source]) => {
      if (
        warning.startsWith('Net weight needs review:') ||
        source.kind !== 'ingredient'
      )
        return []
      return workspace.ingredients.filter((item) => item.id === source.id)
    },
  )
  let lines: ReturnType<typeof effectiveRecipeLines> = []
  if (recipe && !supplier) {
    try {
      lines = effectiveRecipeLines(recipe, workspace.recipes)
    } catch {
      lines = []
    }
  }
  if (data?.nonFood)
    return <p>Non-food item · food declarations do not apply.</p>
  return (
    <div className="product-ingredients-source">
      {issues.length > 0 && (
        <ul className="product-ingredients-status">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {recipe && !supplier && (
        <p className="product-ingredients-origin">
          Source recipe:{' '}
          <a href={recipeUrl(recipe.id)} target="_blank" rel="noreferrer">
            {recipe.name} · Review recipe (new tab)
          </a>
        </p>
      )}
      {supplier?.source && (
        <p className="product-ingredients-origin">
          Manufacturer source: {supplier.source}
        </p>
      )}
      {product &&
        onReviewProduct &&
        (section.quantity ||
          product.workflow === 'resale' ||
          (!recipe && !children)) && (
          <button
            type="button"
            className="text-button"
            onClick={() => onReviewProduct(product)}
          >
            {section.quantity
              ? 'Open source product'
              : product.workflow === 'resale'
                ? 'Review manufacturer source'
                : 'Review product recipe link'}
          </button>
        )}
      {!recipe && data && !children && onReviewRecipeLink && (
        <button
          type="button"
          className="text-button"
          onClick={onReviewRecipeLink}
        >
          Review product recipe link
        </button>
      )}
      {onReviewIngredient &&
        [...new Set(sourceIssues)].map((item) => (
          <button
            key={item.id}
            type="button"
            className="text-button"
            onClick={() => onReviewIngredient(item)}
          >
            Review {item.name}
          </button>
        ))}
      {statement && (
        <div>
          <h4>
            {supplier
              ? 'Manufacturer ingredient statement'
              : 'Generated ingredient statement'}
          </h4>
          <p className="product-ingredients-statement">{statement}</p>
          {!!data?.ingredientStatementOverrides?.length && (
            <p className="product-ingredients-origin">
              Uses saved wording overrides for{' '}
              {data.ingredientStatementOverrides
                .map((item) => item.name)
                .join(', ')}
              .
            </p>
          )}
          <button
            type="button"
            className="text-button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(statement)
                setCopyStatus('Ingredient statement copied.')
              } catch {
                setCopyStatus(
                  'Clipboard unavailable. Select and copy the statement text.',
                )
              }
            }}
          >
            Copy ingredient statement
          </button>{' '}
          <small role="status">{copyStatus}</small>
        </div>
      )}
      {data && (
        <div>
          <h4>
            {needsAllergenReview
              ? 'Allergen information · needs review'
              : 'Reviewed allergen source information'}
          </h4>
          {allergens && (
            <p className="product-ingredients-statement">{allergens}</p>
          )}
          {data.values['recipe.allergenAdvisory'] && !supplier && <p>{data.values['recipe.allergenAdvisory']}</p>}
          {!allergens && !needsAllergenReview && (
            <p>
              No explicit “contains” declaration recorded. This does not mean
              allergen-free.
            </p>
          )}
          {data.sourceAllergenStatements?.contains
            .filter((entry) => entry !== supplier?.contains)
            .map((entry) => (
              <p key={entry}>Supplier declaration: {entry}</p>
            ))}
          {data.sourceAllergenStatements?.advisories.map((entry) => (
            <p key={entry}>Supplier advisory: {entry}</p>
          ))}
        </div>
      )}
      {data && product && !props.isDraft && <LabelSourceAllergenReview workspace={workspace} source={{ kind: 'product', id: product.id }} data={data} mutate={props.onReviewAllergens} actionLabel="Major allergen review" onOpenSource={onReviewProduct ? (_, item) => { if (item) onReviewProduct(item) } : undefined} />}
      {data?.allergenReview?.status === 'confirmed' && product && <ProductAllergenReview
        key={`${product.id}:${product.allergenReview?.reviewedAt || ''}:${JSON.stringify(data.allergenReview.source)}`}
        review={data.allergenReview} product={product}
        mutate={section.quantity || props.isDraft ? undefined : props.onReviewAllergens}
      />}
      {lines.length > 0 && (
        <details>
          <summary>Recipe breakdown · internal quantities</summary>
          <ul>
            {lines.map((line, index) => {
              const ingredient = workspace.ingredients.find(
                (item) => item.id === line.ingredientId,
              )
              const prep = workspace.recipes.find(
                (recipe) => recipe.id === ingredient?.compoundRecipeId,
              )
              return (
                <li key={index}>
                  {ingredient?.name || 'Unavailable ingredient'} —{' '}
                  {line.quantity} {line.unit}
                  {prep && (
                    <>
                      {' '}
                      ·{' '}
                      <a
                        href={recipeUrl(prep.id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {prep.name} (new tab)
                      </a>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </details>
      )}
      {children?.map((child, index) => (
        <details
          className="product-ingredients-entry"
          key={`${child.product?.id || 'missing'}:${index}`}
          open={children.length <= 2 ? true : undefined}
        >
          <summary>
            <strong>{child.name}</strong> {child.quantity}{' '}
            <small>
              {child.data?.nonFood
                ? 'Non-food'
                : issueCount(child)
                  ? 'Needs review'
                  : ''}
            </small>
          </summary>
          <SourceDetails
            section={child}
            props={{ ...props, onSupplierChange: undefined }}
          />
        </details>
      ))}
      {!onReviewProduct &&
        !onReviewRecipeLink &&
        !onSupplierChange &&
        !recipe &&
        data &&
        !supplier && <p>Review the linked source in the product record.</p>}
    </div>
  )
}

function SupplierSourceFields({
  product,
  change,
}: {
  product: Item
  change: (value: SupplierLabelSource) => void
}) {
  const value = supplierLabelSource(product) || {
    source: '',
    declaration: '',
    contains: '',
    advisory: '',
    reviewed: false,
  }
  return (
    <fieldset className="product-supplier-source">
      <legend>Review manufacturer source</legend>
      <p>
        Copy the current manufacturer wording. Editing any field clears its
        review.
      </p>
      {(
        [
          ['source', 'Manufacturer reference (package, revision, or URL)'],
          ['declaration', 'Manufacturer ingredient statement'],
          ['contains', 'Manufacturer contains statement'],
          ['advisory', 'Manufacturer cross-contact advisory'],
        ] as const
      ).map(([key, label]) => (
        <label className="field" key={key}>
          {label}
          <textarea
            rows={key === 'declaration' ? 3 : 1}
            maxLength={supplierLabelLimits[key]}
            value={product.supplierLabelSource?.[key] || ''}
            onChange={(event) =>
              change({
                ...value,
                ...product.supplierLabelSource,
                [key]: event.target.value,
                reviewed: false,
              })
            }
          />
        </label>
      ))}
      {!value.contains && <label>
        <input type="checkbox" checked={value.noMajorAllergens === true} onChange={(event) => change({ ...value, reviewed: false, noMajorAllergens: event.target.checked })} />{' '}
        The manufacturer explicitly confirms absence of the major allergens.
      </label>}
      <label>
        <input
          type="checkbox"
          checked={value.reviewed}
          disabled={!value.source || !value.declaration}
          onChange={(event) =>
            change({ ...value, reviewed: event.target.checked })
          }
        />{' '}
        I reviewed the manufacturer’s ingredient and allergen information
        against this source.
      </label>
    </fieldset>
  )
}
