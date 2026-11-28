import { useId } from 'react'
import { prepYieldUnits, supportedPrepYieldUnit } from '@/lib/prep-yield'
import { unitLabel } from '@/lib/domain'
import './recipe-yield-fields.css'

export function RecipeYieldFields({
  recipe,
  onChange,
  linkedOutputUnit,
  typeLocked,
}: {
  recipe: { yield?: number | string; yieldUnit?: string; compound?: boolean }
  onChange: (key: string, value: string | boolean) => void
  linkedOutputUnit?: string
  typeLocked?: boolean
}) {
  const unit = recipe.yieldUnit || ''
  const typeHelp = useId()
  return (
    <fieldset className="recipe-yield-fields">
      <legend>Finished yield</legend>
      <div className="recipe-yield-inputs">
        <label className="field">
          <span>Batch yield</span>
          <input
            type="number"
            min="0.000001"
            step="any"
            value={recipe.yield ?? ''}
            onChange={(event) => onChange('yield', event.target.value)}
          />
        </label>
        <label className="field">
          <span>Yield unit</span>
          {recipe.compound ? (
            <select
              aria-label="Yield unit"
              value={unit}
              onChange={(event) => onChange('yieldUnit', event.target.value)}
              required
            >
              {!supportedPrepYieldUnit(unit) && (
                <option value={unit} disabled>
                  {unit
                    ? `${unit} — choose a supported prep unit`
                    : 'Choose a prep unit'}
                </option>
              )}
              {prepYieldUnits.map((value) => (
                <option key={value} value={value}>
                  {unitLabel(value)}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={unit}
              placeholder="loaves"
              onChange={(event) => onChange('yieldUnit', event.target.value)}
            />
          )}
        </label>
      </div>
      <div className="recipe-type-setting">
        <label className="check-label">
          <input
            type="checkbox"
            checked={recipe.compound === true}
            disabled={typeLocked}
            aria-describedby={typeHelp}
            onChange={(event) => onChange('compound', event.target.checked)}
          />
          Recipe type: Compound prep
        </label>
        <p className="form-hint" id={typeHelp}>
          {recipe.compound
            ? 'Produces a component that can be used in another recipe.'
            : 'Recipe — used to make a finished product.'}
          {typeLocked &&
            ' This recipe’s type is locked because it is linked to prepared stock or another recipe.'}
        </p>
      </div>
      {recipe.compound && !supportedPrepYieldUnit(unit) && (
        <p role="status">
          Choose a supported weight, volume or count unit. Your draft quantity
          and unit are preserved until you choose.
        </p>
      )}
      {linkedOutputUnit && (
        <p className="form-hint">
          Linked prepared inventory uses {unitLabel(linkedOutputUnit)}. Its
          yield unit cannot change here; changing stock units requires an
          explicit stock migration. The existing output is reused on save.
        </p>
      )}
      {recipe.compound && (
        <p className="form-hint">
          Weight and volume require a verified conversion on this prep’s
          inventory ingredient. Count-to-weight or volume also requires an
          explicit equivalence. No density is assumed.
        </p>
      )}
    </fieldset>
  )
}
