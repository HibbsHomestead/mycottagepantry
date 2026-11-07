import {
  convert,
  ingredientUnits,
  money,
  unitLabel,
  type Item,
} from '@/lib/domain'
import { applyPurchaseSetup, purchaseSetupView } from '@/lib/purchase-setup'
import { precise } from '@/lib/ingredients'

export function IngredientPurchaseSetup({
  original,
  draft,
  change,
  changeStorage,
  conversions,
}: {
  original: Item
  draft: Item
  change: (key: string, value: Item[string]) => void
  changeStorage: (unit: string) => void
  conversions: () => void
}) {
  const view = purchaseSetupView(original),
    s = draft.purchaseSetup || view.setup
  const review = draft.purchaseSetupReview || view.review
  const shelf = draft.storageUnit || original.unit
  const set = (key: string, value: string) =>
    change('purchaseSetup', {
      ...s,
      [key]: value,
      ...(key === 'packageUnit' && value === shelf ? { stockUnits: 1 } : {}),
    })
  const select = (
    value: string,
    onChange: (v: string) => void,
    label: string,
  ) => (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Choose unit</option>
      {Object.keys(ingredientUnits(draft.conversions)).map((u) => (
        <option key={u} value={u}>
          {unitLabel(u)}
        </option>
      ))}
    </select>
  )
  const priceText = (n: number) =>
    !draft.currency || draft.currency === 'USD'
      ? money(n)
      : new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: draft.currency,
        }).format(n)
  let summary: string[] = [],
    missing = '',
    issue = ''
  try {
    const preview = applyPurchaseSetup(original, {
      ...draft,
      purchaseSetup: s,
      purchaseSetupConfirmed: true,
    })
    const p = Number(s.price),
      count = Number(s.stockUnits)
    summary = [
      `1 ${s.packageUnit} = ${precise(count)} ${shelf}`,
      `${priceText(p)} per ${s.packageUnit}`,
    ]
    if (shelf !== s.packageUnit)
      summary.push(`${priceText(p / count)} per ${shelf}`)
    if (draft.recipeUnit && draft.recipeUnit !== shelf) {
      try {
        summary.push(
          `${priceText((p / count) * convert(1, draft.recipeUnit, shelf, preview.conversions))} per ${draft.recipeUnit}`,
        )
      } catch {
        missing = `A verified conversion from ${unitLabel(shelf)} to ${unitLabel(draft.recipeUnit)} is needed for recipes.`
      }
    }
  } catch (e) {
    issue = (e as Error).message
  }
  return (
    <>
      {review && (
        <div className="form-hint">
          <p className="warning-text">{review}</p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={!!draft.purchaseSetupConfirmed}
              onChange={(e) =>
                change('purchaseSetupConfirmed', e.target.checked)
              }
            />
            I reviewed the saved basis and entered the price and contents of one
            package.
          </label>
        </div>
      )}
      <div className="form-grid ingredient-purchase-five">
        <label className="field">
          <span>Purchasing package unit</span>
          {select(
            s.packageUnit,
            (v) => set('packageUnit', v),
            'Purchasing package unit',
          )}
        </label>
        <label className="field">
          <span>Purchasing price</span>
          <input
            type="number"
            min="0"
            step="any"
            aria-label="Purchasing price"
            value={s.price}
            onChange={(e) => set('price', e.target.value)}
          />
          <small className="form-hint">
            Price per 1 {s.packageUnit || 'purchasing package'}.
          </small>
        </label>
        <label className="field">
          <span>Stock shelf unit</span>
          {select(shelf, changeStorage, 'Stock shelf unit')}
        </label>
        <label className="field">
          <span># of stock units in purchasing unit</span>
          <input
            type="number"
            min="0.000001"
            step="any"
            aria-label="# of stock units in purchasing unit"
            value={s.stockUnits}
            onChange={(e) => set('stockUnits', e.target.value)}
          />
          <small className="form-hint">
            {unitLabel(shelf)} in 1 {s.packageUnit || 'purchasing package'}.
          </small>
        </label>
        <label className="field">
          <span>Recipe unit</span>
          {select(
            draft.recipeUnit,
            (v) => change('recipeUnit', v),
            'Recipe unit',
          )}
        </label>
      </div>
      {!!summary.length && (
        <p className="form-hint purchase-unit-summary">
          {summary.map((text) => (
            <span key={text}>{text}</span>
          ))}
        </p>
      )}
      {issue && <p className="form-hint warning-text">{issue}</p>}
      {missing && (
        <p className="form-hint warning-text">
          {missing}{' '}
          <button type="button" className="text-button" onClick={conversions}>
            Open Unit Conversions
          </button>
        </p>
      )}
    </>
  )
}
