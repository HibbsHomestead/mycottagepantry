import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react'
import { money, type Item, type Workspace } from '@/lib/domain'
import {
  resalePurchaseUnits,
  resaleStockPreview,
  sellUnitNames,
  sellUnitOptions,
  stockChoices,
  titlePackSize,
  unitWord,
} from '@/lib/resale-stock'

function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  return (
    <label className="field">
      <span id={id}>{label}</span>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{ 'aria-labelledby'?: string }>,
            { 'aria-labelledby': id },
          )
        : children}
    </label>
  )
}

/** Defines what one sellable item means; package counts never redefine it. */
export function ResaleSellUnitFields({
  value,
  change,
}: {
  value: Item
  change: (key: string, value: Item[string]) => void
}) {
  const names = sellUnitNames(value)
  const sealed = value.sellUnit === 'sealed pack'
  const choice =
    value.initialStock === true ? 'existing' : value.stockChoice || 'none'
  const titleSize = titlePackSize(value.name)
  const input = (key: string, kind = 'text', required = false) => (
    <input
      type={kind}
      value={value[key] ?? ''}
      required={required}
      onChange={(e) => change(key, e.target.value)}
    />
  )
  return (
    <fieldset className="resale-stock-group">
      <legend>How do you sell this item?</legend>
      <div className="form-grid">
        <Field label="Sellable unit">
          <select
            value={value.sellUnit || ''}
            required={choice !== 'none'}
            onChange={(e) => change('sellUnit', e.target.value)}
          >
            <option value="">Choose a unit…</option>
            {sellUnitOptions.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {value.sellUnit === 'other' && (
          <>
            <Field label="Unit name (one)">
              {input('sellUnitLabel', 'text', true)}
            </Field>
            <Field label="Unit name (several, optional)">
              {input('sellUnitPlural')}
            </Field>
          </>
        )}
        {sealed && (
          <Field label="What’s inside one sealed pack? (optional)">
            <input
              value={value.packContents ?? ''}
              placeholder="e.g. 15 bottles"
              onChange={(e) => change('packContents', e.target.value)}
            />
          </Field>
        )}
      </div>
      <p className="form-hint">
        {sealed
          ? 'Stock is counted in sealed packs. The contents are for reference and are never multiplied into the count.'
          : `Stock, counts and costs below are in ${names.plural}.`}
      </p>
      {titleSize > 0 && !sealed && (
        <p className="form-hint">
          The name mentions a {titleSize} pack. That describes what is inside
          one package, not how many you own. If you sell the whole pack
          unopened, choose “Sealed pack”.
        </p>
      )}
    </fieldset>
  )
}

/** Resale “Purchase & Stock” tab: one sellable unit, one stock path, one cost basis. */
export function ResaleStockFields({
  value,
  change,
  workspace,
}: {
  value: Item
  change: (key: string, v: Item[string]) => void
  workspace: Workspace
}) {
  const choice = value.stockChoice || 'none'
  const names = sellUnitNames(value)
  const packMode =
    (choice === 'existing' && value.countMethod === 'packs') ||
    (choice === 'purchase' && (value.purchaseUnit || 'each') !== 'each')
  const packWord =
    choice === 'purchase' ? value.purchaseUnit || 'pack' : 'pack/case'
  const basis = value.costBasis || 'unit'
  const { plan, error } = resaleStockPreview(value)
  const input = (
    key: string,
    kind = 'text',
    required = false,
    min?: number,
  ) => (
    <input
      type={kind}
      inputMode={kind === 'number' ? 'decimal' : undefined}
      step={kind === 'number' ? 'any' : undefined}
      min={min}
      value={value[key] ?? ''}
      required={required}
      onChange={(e) => change(key, e.target.value)}
    />
  )
  // Switching entry methods never reinterprets an amount typed for another basis.
  const resetPackBasis = () => {
    if (basis === 'pack') {
      change('costBasis', 'unit')
      change('costAmount', '')
    }
  }
  const supplier = (label: string) => (
    <Field label={label}>
      <select
        value={value.vendorId || ''}
        onChange={(e) => change('vendorId', e.target.value)}
      >
        <option value="">Not set</option>
        {workspace.vendors.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </Field>
  )
  const costLabel =
    basis === 'total'
      ? choice === 'purchase'
        ? 'Total paid for this purchase'
        : 'Total cost of all starting stock'
      : basis === 'pack'
        ? `Cost per ${packWord}`
        : `Cost per ${names.singular}`
  const costFields = (
    <>
      <div className="form-grid">
        <Field label="How do you want to enter the cost?">
          <select
            value={basis}
            onChange={(e) => {
              change('costBasis', e.target.value)
              change('costAmount', '')
            }}
          >
            {choice === 'purchase' && (
              <option value="total">Total paid for this purchase</option>
            )}
            <option value="unit">Cost per {names.singular}</option>
            {choice === 'existing' && (
              <option value="total">Total cost of all starting stock</option>
            )}
            {packMode && <option value="pack">Cost per {packWord}</option>}
            {choice === 'existing' && (
              <option value="unknown">I don’t know the cost yet</option>
            )}
          </select>
        </Field>
        {basis !== 'unknown' && (
          <Field label={costLabel}>
            {input('costAmount', 'number', true, 0)}
          </Field>
        )}
      </div>
      {basis === 'unknown' ? (
        <div className="resale-stock-note" role="note">
          <p>
            A cost is required to add starting stock. Without it, inventory
            value and profit on these sales would be wrong, so a blank cost is
            never saved as $0.
          </p>
          <p>
            Enter your best estimate of what you paid (and mark it as an
            estimate), or save the item with no stock now and add the stock once
            you find the cost.
          </p>
          <div className="resale-stock-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={() => change('costBasis', 'unit')}
            >
              Enter an estimate
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => change('stockChoice', 'none')}
            >
              Save without stock for now
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="form-hint">
            Use what you paid to acquire the stock, not your selling price.
            Enter 0 only if it was genuinely free.
          </p>
          {choice === 'existing' && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={value.costEstimated === true}
                onChange={(e) => change('costEstimated', e.target.checked)}
              />
              This cost is my best estimate.
            </label>
          )}
        </>
      )}
    </>
  )
  return (
    <div className="resale-stock">
      <ResaleSellUnitFields value={value} change={change} />
      <fieldset className="resale-stock-group">
        <legend>Starting stock</legend>
        <div className="resale-stock-choices" role="radiogroup">
          {stockChoices.map(([key, label, hint]) => (
            <label key={key} className="resale-stock-choice">
              <input
                type="radio"
                name="resale-stock-choice"
                value={key}
                checked={choice === key}
                onChange={() => {
                  change('stockChoice', key)
                  if (
                    basis === 'unknown' ||
                    basis === 'pack' ||
                    key === 'purchase'
                  ) {
                    change('costBasis', key === 'purchase' ? 'total' : 'unit')
                    change('costAmount', '')
                  }
                }}
              />
              <span>
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {choice === 'none' && (
        <>
          <div className="form-grid">
            {supplier('Usual supplier (optional)')}
          </div>
          <p className="form-hint">
            No stock or payment is recorded. Use Receive stock or an inventory
            count when items arrive.
          </p>
        </>
      )}
      {choice === 'existing' && (
        <>
          <label className="check-label">
            <input
              type="checkbox"
              checked={value.countMethod === 'packs'}
              onChange={(e) => {
                change('countMethod', e.target.checked ? 'packs' : 'direct')
                if (!e.target.checked) resetPackBasis()
              }}
            />
            Count by packs/cases
          </label>
          {value.countMethod === 'packs' ? (
            <div className="form-grid">
              <Field label="Number of packs/cases">
                {input('packCount', 'number', true, 0)}
              </Field>
              <Field label={`${cap(names.plural)} per pack/case`}>
                {input('unitsPerPack', 'number', true, 1)}
              </Field>
              <Field label={`Additional loose ${names.plural} (optional)`}>
                {input('looseUnits', 'number', false, 0)}
              </Field>
            </div>
          ) : (
            <Field label={`How many ${names.plural} do you currently have?`}>
              {input('startingCount', 'number', true, 1)}
            </Field>
          )}
          {costFields}
          <div className="form-grid">
            <Field label="Inventory as of">
              {input('receivedDate', 'date', true)}
            </Field>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={value.addPurchaseDetails === true}
              onChange={(e) => change('addPurchaseDetails', e.target.checked)}
            />
            Add supporting purchase details (optional)
          </label>
          {value.addPurchaseDetails === true && (
            <div className="form-grid">
              {supplier('Supplier')}
              <Field label="Original purchase date (optional)">
                {input('purchaseDate', 'date')}
              </Field>
              <Field label="Receipt reference (optional)">
                {input('receiptReference')}
              </Field>
            </div>
          )}
        </>
      )}
      {choice === 'purchase' && (
        <>
          <div className="form-grid">
            <Field label="Quantity purchased">
              {input('purchaseQuantity', 'number', true, 1)}
            </Field>
            <Field label="Purchase unit">
              <select
                value={value.purchaseUnit || 'each'}
                onChange={(e) => {
                  change('purchaseUnit', e.target.value)
                  if (e.target.value === 'each') resetPackBasis()
                }}
              >
                {resalePurchaseUnits.map((u) => (
                  <option key={u} value={u}>
                    {u === 'each' ? `Individual ${names.plural}` : u}
                  </option>
                ))}
              </select>
            </Field>
            {(value.purchaseUnit || 'each') !== 'each' && (
              <Field
                label={`${cap(names.plural)} in each ${value.purchaseUnit}`}
              >
                {input('itemsPerUnit', 'number', true, 1)}
              </Field>
            )}
          </div>
          {(value.purchaseUnit || 'each') !== 'each' && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={value.packageContentsConfirmed === true}
                onChange={(e) =>
                  change('packageContentsConfirmed', e.target.checked)
                }
              />
              I checked how many {names.plural} are in each {value.purchaseUnit}
              .
            </label>
          )}
          {costFields}
          <div className="form-grid">
            {supplier('Supplier')}
            <Field label="Purchase date (optional)">
              {input('purchaseDate', 'date')}
            </Field>
            <Field label="Received date">
              {input('receivedDate', 'date', true)}
            </Field>
            <Field label="Receipt reference (optional)">
              {input('receiptReference')}
            </Field>
          </div>
        </>
      )}
      {choice !== 'none' && (
        <div className="resale-stock-preview" aria-live="polite">
          {plan ? (
            <>
              <p className="resale-stock-total">
                {choice === 'purchase' ? 'You are adding ' : 'Starting stock: '}
                <strong>
                  {plan.quantity} {unitWord(names, plan.quantity)}
                </strong>
              </p>
              {breakdown(value, plan.quantity, names) && (
                <p>{breakdown(value, plan.quantity, names)}</p>
              )}
              <p>
                {money(plan.unitCost)} per {names.singular} ·{' '}
                {money(plan.totalCost)} total
                {plan.costEstimated ? ' (estimated)' : ''}
              </p>
            </>
          ) : (
            <p className="muted">{error}</p>
          )}
        </div>
      )}
    </div>
  )
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
function breakdown(
  value: Item,
  total: number,
  names: { singular: string; plural: string },
) {
  if (value.stockChoice === 'existing' && value.countMethod === 'packs') {
    const packs = Number(value.packCount),
      per = Number(value.unitsPerPack),
      loose = Number(value.looseUnits || 0)
    return `${packs} ${packs === 1 ? 'pack/case' : 'packs/cases'} × ${per} ${unitWord(names, per)}${loose ? ` + ${loose} loose ${unitWord(names, loose)}` : ''} = ${total} ${unitWord(names, total)}`
  }
  if (value.stockChoice === 'purchase' && value.purchaseUnit !== 'each') {
    const q = Number(value.purchaseQuantity),
      per = Number(value.itemsPerUnit)
    return `${q} ${value.purchaseUnit}${q === 1 ? '' : value.purchaseUnit === 'box' ? 'es' : 's'} × ${per} ${unitWord(names, per)} = ${total} ${unitWord(names, total)}`
  }
  return ''
}
