import { isPackaging } from '@/lib/pantry-category'
import { useRef, useState } from 'react'
import {
  ingredientUnits,
  unitLabel,
  parseQuantity,
  convert,
  costBreakdown,
  recipeProductionLines,
  type Item,
  type TaxRate,
  calculateTax,
  applicableTaxes,
  money,
} from '@/lib/domain'

export function ConversionEditor({
  ingredient,
  from,
  onSave,
  initialAmountTo = 120,
  expanded = false,
  disclosure = true,
  onCancel,
  initialConversion,
}: {
  ingredient: Item
  initialAmountTo?: number | ''
  from?: string
  onSave: (data: any) => Promise<void>
  expanded?: boolean
  disclosure?: boolean
  onCancel?: () => void
  initialConversion?: {
    from: string
    to: string
    amountFrom: number
    amountTo: number
    source?: string
    notes?: string
    verified?: boolean
  }
}) {
  const [draft, setDraft] = useState({
    from:
      initialConversion?.from ||
      from ||
      (isPackaging(ingredient) ? ingredient.purchaseUnit || 'each' : 'cup'),
    to: initialConversion?.to || ingredient.unit,
    amountFrom: (initialConversion?.amountFrom ?? 1) as number | string,
    amountTo: (initialConversion?.amountTo ??
      (isPackaging(ingredient) ? '' : initialAmountTo)) as number | string,
    verified: false,
    notes: initialConversion?.notes || '',
    source: initialConversion?.source || 'user_entered',
  })
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const content = (
    <>
      {expanded && <strong>Conversion for {ingredient.name}</strong>}
      <p>
        Use a measured value or supplier reference for this{' '}
        {isPackaging(ingredient) ? 'packaging' : 'ingredient'}. Package and case
        sizes require explicit item-specific contents.
      </p>
      <div className="form-grid conversion-equation">
        <label>
          From quantity
          <input
            type="text"
            value={draft.amountFrom}
            onChange={(e) => setDraft({ ...draft, amountFrom: e.target.value })}
          />
        </label>
        <label>
          From unit
          <select
            aria-label="From unit"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          >
            {Object.keys(ingredientUnits(ingredient.conversions)).map((u) => (
              <option key={u} value={u}>
                {unitLabel(u)}
              </option>
            ))}
          </select>
        </label>
        {expanded && (
          <span className="conversion-equals" aria-hidden="true">
            =
          </span>
        )}
        <label>
          To quantity
          <input
            type="text"
            value={draft.amountTo}
            onChange={(e) => setDraft({ ...draft, amountTo: e.target.value })}
          />
        </label>
        <label>
          To unit
          <select
            aria-label="To unit"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          >
            {Object.keys(ingredientUnits(ingredient.conversions)).map((u) => (
              <option key={u} value={u}>
                {unitLabel(u)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Source
        <select
          aria-label="Source"
          value={draft.source}
          onChange={(e) => setDraft({ ...draft, source: e.target.value })}
        >
          {['user_entered', 'package_label', 'verified_reference'].map(
            (source) => (
              <option key={source} value={source}>
                {
                  {
                    user_entered: 'My measurement',
                    package_label: 'Package label',
                    verified_reference: 'Verified reference',
                  }[source]
                }
              </option>
            ),
          )}
        </select>
      </label>
      <label>
        Source / measurement notes
        <input
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={draft.verified}
          onChange={(e) => setDraft({ ...draft, verified: e.target.checked })}
        />
        I verified these amounts for this{' '}
        {isPackaging(ingredient) ? 'packaging' : 'ingredient'}.
      </label>
      {error && (
        <p role="alert" className="warning-text">
          {error}
        </p>
      )}
      <div className="button-row conversion-actions">
        <button
          className={expanded ? 'btn' : 'text-button'}
          disabled={busy || !draft.verified}
          type="button"
          onClick={async () => {
            if (saving.current) return
            saving.current = true
            setBusy(true)
            setError('')
            try {
              await onSave({ ...draft, ingredientId: ingredient.id })
            } catch (e) {
              setError((e as Error).message)
            } finally {
              saving.current = false
              setBusy(false)
            }
          }}
        >
          {busy
            ? 'Saving conversion…'
            : `Save ${isPackaging(ingredient) ? 'packaging' : 'ingredient'} conversion`}
        </button>
        {onCancel && (
          <button
            type="button"
            className={expanded ? 'btn secondary' : 'text-button'}
            disabled={busy}
            onClick={onCancel}
          >
            Cancel conversion
          </button>
        )}
      </div>
    </>
  )
  if (!disclosure) return <>{content}</>
  return expanded ? (
    <div
      className="calculation-box recipe-conversion-editor"
      role="group"
      aria-label={`Conversion for ${ingredient.name}`}
    >
      {content}
    </div>
  ) : (
    <details className="calculation-box">
      <summary>Add a verified conversion for {ingredient.name}</summary>
      {content}
    </details>
  )
}

export function PackagingEditor({
  product,
  ingredients,
  onChange,
}: {
  product: Item
  ingredients: Item[]
  onChange: (lines: any[]) => void
}) {
  const lines =
    product.packagingLines ??
    (product.packagingId
      ? [
          {
            ingredientId: product.packagingId,
            quantity: product.packagingQuantity ?? 1,
            unit: 'each',
            required: true,
          },
        ]
      : [])
  const items = ingredients.filter((i) => i.usedAs === 'packaging')
  return (
    <section className="calculation-box">
      <h3>Packaging per sellable package</h3>
      <p>
        Include every bag, box, label, and seal. Optional lines entered here are
        included in this product's cost and inventory use.
      </p>
      {lines.map((line: any, index: number) => (
        <div className="packaging-editor" key={index}>
          <label>
            Packaging item
            <select
              value={line.ingredientId}
              onChange={(e) =>
                onChange(
                  lines.map((l: any, i: number) =>
                    i === index ? { ...l, ingredientId: e.target.value } : l,
                  ),
                )
              }
            >
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity
            <input
              type="text"
              value={line.quantity}
              onChange={(e) =>
                onChange(
                  lines.map((l: any, i: number) =>
                    i === index ? { ...l, quantity: e.target.value } : l,
                  ),
                )
              }
            />
          </label>
          <label>
            Unit
            <select
              value={line.unit || 'each'}
              onChange={(e) =>
                onChange(
                  lines.map((l: any, i: number) =>
                    i === index ? { ...l, unit: e.target.value } : l,
                  ),
                )
              }
            >
              {Object.keys(
                ingredientUnits(
                  items.find((item) => item.id === line.ingredientId)
                    ?.conversions,
                ),
              ).map((u) => (
                <option key={u} value={u}>
                  {unitLabel(u)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Notes
            <input
              value={line.notes || ''}
              onChange={(e) =>
                onChange(
                  lines.map((l: any, i: number) =>
                    i === index ? { ...l, notes: e.target.value } : l,
                  ),
                )
              }
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={line.required !== false}
              onChange={(e) =>
                onChange(
                  lines.map((l: any, i: number) =>
                    i === index ? { ...l, required: e.target.checked } : l,
                  ),
                )
              }
            />
            Required
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              onChange(lines.filter((_: any, i: number) => i !== index))
            }
          >
            Remove
          </button>
        </div>
      ))}

      <button
        type="button"
        className="text-button"
        disabled={!items.length}
        onClick={() =>
          onChange([
            ...lines,
            {
              ingredientId: items[0].id,
              quantity: 1,
              unit: items[0].unit,
              required: true,
            },
          ])
        }
      >
        Add packaging item
      </button>
      {!lines.length && (
        <p className="warning-text">
          No packaging assigned. Add packaging or confirm this product is sold
          unpackaged.
        </p>
      )}
    </section>
  )
}

export function TaxRateEditor({
  rates,
  onChange,
}: {
  rates: TaxRate[]
  onChange: (rates: TaxRate[]) => void
}) {
  const update = (index: number, key: string, value: any) =>
    onChange(rates.map((r, i) => (i === index ? { ...r, [key]: value } : r)))
  return (
    <section className="calculation-box">
      <h3>Tax rates and jurisdictions</h3>
      <p>
        Rates run in calculation order. A compounding rate uses pre-tax revenue
        plus all preceding taxes. Inclusive rates are backed out of the entered
        price.
      </p>
      {rates.map((r, index) => (
        <details key={r.id} open className="tax-rate-editor">
          <summary>
            {r.name || 'New tax rate'} · {r.ratePercent}% · {r.behavior}
          </summary>
          <div className="form-grid">
            <label>
              Rate name
              <input
                value={r.name}
                onChange={(e) => update(index, 'name', e.target.value)}
              />
            </label>
            <label>
              Jurisdiction
              <input
                value={r.jurisdiction}
                onChange={(e) => update(index, 'jurisdiction', e.target.value)}
              />
            </label>
            <label>
              Jurisdiction type
              <select
                value={r.jurisdictionType || 'other'}
                onChange={(e) =>
                  update(index, 'jurisdictionType', e.target.value)
                }
              >
                {['state', 'county', 'city', 'district', 'other'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Rate (%)
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                value={r.ratePercent}
                onChange={(e) =>
                  update(index, 'ratePercent', Number(e.target.value))
                }
              />
            </label>
            <label>
              Behavior
              <select
                value={r.behavior}
                onChange={(e) => update(index, 'behavior', e.target.value)}
              >
                <option value="exclusive">Exclusive · add to price</option>
                <option value="inclusive">Inclusive · included in price</option>
              </select>
            </label>
            <label>
              Calculation order
              <input
                type="number"
                min="0"
                value={r.order ?? 0}
                onChange={(e) => update(index, 'order', Number(e.target.value))}
              />
            </label>
            <label>
              Effective start
              <input
                type="date"
                value={r.start || ''}
                onChange={(e) => update(index, 'start', e.target.value)}
              />
            </label>
            <label>
              Effective end
              <input
                type="date"
                value={r.end || ''}
                onChange={(e) => update(index, 'end', e.target.value)}
              />
            </label>
            <label>
              Applies to
              <select
                value={r.appliesTo || 'all_products'}
                onChange={(e) => update(index, 'appliesTo', e.target.value)}
              >
                <option value="all_products">All products by default</option>
                <option value="product_category">Product category</option>
                <option value="selected_products">
                  Only manually assigned products
                </option>
              </select>
            </label>
            <label>
              Product category
              <input
                value={r.category || ''}
                onChange={(e) => update(index, 'category', e.target.value)}
              />
            </label>
            <label>
              Notes
              <input
                value={r.notes || ''}
                onChange={(e) => update(index, 'notes', e.target.value)}
              />
            </label>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={!!r.compound}
              onChange={(e) => update(index, 'compound', e.target.checked)}
            />
            Compound on preceding taxes
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={r.active !== false}
              onChange={(e) => update(index, 'active', e.target.checked)}
            />
            Active
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() => update(index, 'active', false)}
          >
            Deactivate rate
          </button>
        </details>
      ))}
      <button
        type="button"
        className="text-button"
        onClick={() =>
          onChange([
            ...rates,
            {
              id: crypto.randomUUID(),
              name: '',
              jurisdiction: '',
              ratePercent: 0,
              behavior: 'exclusive',
              active: true,
              order: rates.length,
              taxAccountId: 'sales-tax-payable',
            },
          ])
        }
      >
        Add tax rate
      </button>
      <p>
        Tax settings and reports are for recordkeeping. Confirm requirements,
        rates, and filings with a qualified tax professional.
      </p>
    </section>
  )
}
export function TaxPreview({
  product,
  business,
  amount,
  date,
}: {
  product: Item
  business: Item
  amount: number
  date?: string
}) {
  try {
    const t = calculateTax(
      amount || 0,
      applicableTaxes(product, business, date),
    )
    return (
      <details className="calculation-box">
        <summary>View calculation · tax and customer price</summary>
        <p>
          Entered amount: {money(amount)} ·{' '}
          {product.priceTaxMode === 'before'
            ? 'before tax'
            : product.priceTaxMode === 'includes'
              ? 'includes tax'
              : 'configured rate behaviors'}
        </p>
        <p>
          Pre-tax revenue = {amount || 0} ÷ {t.divisor.toFixed(8)} ={' '}
          {t.revenueExact.toFixed(6)}
        </p>
        {t.snapshot.map((r) => (
          <p key={r.id}>
            {r.name} · {r.jurisdiction} · {r.behavior}:{' '}
            {r.taxableBase.toFixed(6)} × {r.ratePercent}% ={' '}
            {r.exactAmount.toFixed(6)} → {money(r.amount)}
          </p>
        ))}
        {!t.snapshot.length && (
          <p>
            {product.taxStatus === 'exempt'
              ? 'Tax exempt'
              : product.taxStatus === 'zero_rated'
                ? 'Zero-rated'
                : 'No applicable active tax rates. Configure rates in Settings.'}
          </p>
        )}
        <p>
          Revenue {money(t.revenue)} + tax liability {money(t.tax)} = customer
          total <strong>{money(t.customerTotal)}</strong>
        </p>
        <small>
          Calculations retain precision; transaction taxes are allocated and
          rounded to cents.
        </small>
      </details>
    )
  } catch (e) {
    return (
      <p role="alert" className="warning-text">
        {(e as Error).message}
      </p>
    )
  }
}
export function LineCalculation({
  line,
  ingredient,
}: {
  line: any
  ingredient?: Item
}) {
  try {
    if (!ingredient) throw new Error('Choose an ingredient.')
    const quantity = convert(
      parseQuantity(line.quantity),
      line.unit,
      ingredient.unit,
      ingredient.conversions,
    )
    const cost = ingredient.currentCost ?? ingredient.cost
    return (
      <p>
        {ingredient.name}: {line.quantity} {line.unit} = {quantity.toFixed(6)}{' '}
        {ingredient.unit} × ${Number(cost).toFixed(8)} / {ingredient.unit} ={' '}
        <strong>${(quantity * cost).toFixed(6)}</strong>
      </p>
    )
  } catch (e) {
    return (
      <p className="warning-text">
        {ingredient?.name}: {(e as Error).message}
      </p>
    )
  }
}

export function CustomCountUnit({
  ingredient,
  onSave,
}: {
  ingredient: Item
  onSave: (data: any) => Promise<void>
}) {
  const [abbreviation, setAbbreviation] = useState(''),
    [factor, setFactor] = useState(12),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  return (
    <details className="calculation-box">
      <summary>Define a custom count unit</summary>
      <p>
        This definition belongs to your business and this{' '}
        {isPackaging(ingredient) ? 'packaging' : 'ingredient'}. Confirm how many
        each are in one unit.
      </p>
      <label>
        Unit name / abbreviation
        <input
          value={abbreviation}
          onChange={(e) => setAbbreviation(e.target.value)}
          placeholder="tray12"
        />
      </label>
      <label>
        Each per unit
        <input
          type="number"
          min="0.000001"
          step="any"
          value={factor}
          onChange={(e) => setFactor(Number(e.target.value))}
        />
      </label>
      {error && (
        <p className="warning-text" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onSave({ ingredientId: ingredient.id, abbreviation, factor })
            setError('')
          } catch (e) {
            setError((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        Save verified count definition
      </button>
    </details>
  )
}

export function ProductTaxOverrides({
  product,
  rates,
  onChange,
}: {
  product: Item
  rates: TaxRate[]
  onChange: (assignments: any[]) => void
}) {
  const assignments = product.taxAssignments || []
  return (
    <details className="calculation-box">
      <summary>Override individual tax behaviors and order</summary>
      <p>
        These assignments apply when entered prices use configured rate
        behaviors.
      </p>
      {rates
        .filter((r) => product.taxRateIds?.includes(r.id))
        .map((r) => {
          const a = assignments.find((a: any) => a.taxRateId === r.id) || {
            taxRateId: r.id,
          }
          const update = (key: string, value: any) =>
            onChange([
              ...assignments.filter((x: any) => x.taxRateId !== r.id),
              { ...a, [key]: value },
            ])
          return (
            <div className="form-grid" key={r.id}>
              <label>
                {r.name} behavior
                <select
                  value={a.behavior || ''}
                  onChange={(e) =>
                    update('behavior', e.target.value || undefined)
                  }
                >
                  <option value="">Use rate default ({r.behavior})</option>
                  <option value="inclusive">Inclusive</option>
                  <option value="exclusive">Exclusive</option>
                </select>
              </label>
              <label>
                {r.name} order
                <input
                  type="number"
                  min="0"
                  value={a.order ?? r.order ?? 0}
                  onChange={(e) => update('order', Number(e.target.value))}
                />
              </label>
            </div>
          )
        })}
    </details>
  )
}

export function BatchCostPreview({
  recipe,
  product,
  ingredients,
  multiplier,
  actualYield,
  laborMinutes,
  usage,
  wasteCost,
}: {
  recipe?: Item
  product?: Item
  ingredients: Item[]
  multiplier: number
  actualYield?: number
  laborMinutes?: number
  usage?: Record<string, number>
  wasteCost?: number
}) {
  try {
    if (!recipe) return null
    const adjusted = {
      ...recipe,
      baseRecipeId: undefined,
      baseRecipe: undefined,
      lines: recipeProductionLines(recipe, ingredients).map((l: any) => ({
        ...l,
        quantity:
          usage?.[l.ingredientId] !== undefined
            ? Number(usage[l.ingredientId]) / multiplier
            : l.quantity,
      })),
    }
    const c = costBreakdown(adjusted, ingredients, {
      product,
      multiplier,
      actualYield,
      laborMinutes,
      wasteCost,
      historical: true,
      baseCostOverride: recipe.baseRecipeId
        ? costBreakdown(recipe.baseRecipe, ingredients, {
            multiplier: multiplier * recipe.baseMultiplier,
            reusableBase: true,
            historical: true,
          })
        : undefined,
    })
    return (
      <details className="calculation-box">
        <summary>View calculation · run cost preview</summary>
        <p>
          Planned yield {c.plannedYield} → actual yield {c.actualYield}.
          Inventory costs use weighted averages.
        </p>
        <p>
          Ingredients {money(c.ingredient)} + packaging {money(c.packagingCost)}{' '}
          + labor {money(c.labor)} + overhead {money(c.overhead)} + waste{' '}
          {money(c.waste)} = <strong>{money(c.total)} per run</strong>.
        </p>
        <p>
          Cost per finished item = {c.total.toFixed(6)} ÷ {c.actualYield} ={' '}
          {c.perItem.toFixed(6)}. Cost per package = {c.perItem.toFixed(6)} ×{' '}
          {c.unitsPerPackage} = {c.perPackage.toFixed(6)}.
        </p>
        {c.packaging.map((l: any, index: number) => (
          <p key={index}>
            {l.name}: {l.inventoryQuantity} {l.storageUnit} × $
            {l.unitCost.toFixed(8)} = ${l.cost.toFixed(6)}
          </p>
        ))}
      </details>
    )
  } catch (e) {
    return (
      <p className="warning-text" role="alert">
        Run cost unavailable: {(e as Error).message}
      </p>
    )
  }
}
