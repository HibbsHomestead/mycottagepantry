import { type ReactNode } from 'react'
import { lengthUnits } from '@/lib/fabric'
import { type Item } from '@/lib/domain'

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
)
export function FabricFields({
  value,
  change,
  fixed = false,
  compact = false,
  packageSetup = false,
}: {
  value: Item
  change: (key: string, value: string | number | boolean) => void
  fixed?: boolean
  compact?: boolean
  packageSetup?: boolean
}) {
  const input = (key: string, required = false) => (
    <input
      value={value[key] ?? ''}
      required={required}
      onChange={(e) => change(key, e.target.value)}
    />
  )
  const select = (key: string, choices: string[], disabled = false) => (
    <select
      value={value[key] || ''}
      disabled={disabled}
      onChange={(e) => change(key, e.target.value)}
    >
      {choices.map((u) => (
        <option key={u}>{u}</option>
      ))}
    </select>
  )
  return (
    <>
      <div className="form-grid">
        <Field label="Fabric tracking">
          <select
            value={value.fabricTracking || 'length'}
            disabled={fixed}
            onChange={(e) => {
              change('fabricTracking', e.target.value)
              change('unit', e.target.value === 'precut' ? 'each' : 'yd')
              if (!packageSetup)
                change(
                  'purchaseUnit',
                  e.target.value === 'precut' ? 'each' : 'yd',
                )
            }}
          >
            <option value="length">Length / yardage</option>
            <option value="precut">Precut piece or bundle / count</option>
          </select>
        </Field>
        <Field label="Fabric width">
          <input
            value={value.fabricWidth ?? ''}
            required
            disabled={fixed}
            onChange={(e) => change('fabricWidth', e.target.value)}
          />
        </Field>
        <Field label="Width unit">
          {select('widthUnit', [...lengthUnits], fixed)}
        </Field>
        {value.fabricTracking !== 'precut' ? (
          <>
            <Field label="Piece tracking">
              <select
                value={value.pieceMode || 'aggregate'}
                disabled={fixed}
                onChange={(e) => change('pieceMode', e.target.value)}
              >
                <option value="aggregate">
                  Total length / continuity unknown
                </option>
                <option value="separate">One separate piece or remnant</option>
              </select>
            </Field>
            <Field label="Piece identifier">
              {input('pieceId', value.pieceMode === 'separate')}
            </Field>
          </>
        ) : (
          <>
            <Field label="Optional piece length">{input('pieceLength')}</Field>
            <Field label="Piece length unit">
              {select('pieceLengthUnit', [...lengthUnits])}
            </Field>
          </>
        )}
        <Field label="Fiber / composition">{input('fiber')}</Field>
        <Field label="Color">{input('color')}</Field>
        <Field label="Print / pattern">{input('pattern')}</Field>
        <Field label="Collection">{input('collection')}</Field>
        {!compact && (
          <>
            <Field label="Storage location">{input('storageLocation')}</Field>
            <Field label="Notes">{input('notes')}</Field>
          </>
        )}
      </div>
      <p className="form-hint">
        {compact
          ? 'Width is separate from length. Track each separate piece in its own record.'
          : 'Each width and color has its own record. Total length does not establish one continuous piece. Use a separate record for each piece; cut layout and automatic piece allocation are unavailable. Precuts and bundles stay counted items.'}
      </p>
    </>
  )
}
export function FabricPurchaseFields({
  value,
  change,
}: {
  value: Item
  change: (key: string, value: string | number | boolean) => void
}) {
  if (!['bolt', 'roll'].includes(value.purchaseUnit || value.unit)) return null
  return (
    <div className="form-grid">
      <Field label="Usable length per bolt / roll">
        <input
          required
          value={value.usableLength ?? ''}
          onChange={(e) => change('usableLength', e.target.value)}
        />
      </Field>
      <Field label="Confirmed length unit">
        <select
          value={value.usableLengthUnit || 'yd'}
          onChange={(e) => change('usableLengthUnit', e.target.value)}
        >
          {lengthUnits.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </Field>
      <label className="field">
        <span>
          <input
            type="checkbox"
            required
            checked={value.lengthConfirmed === true}
            onChange={(e) => change('lengthConfirmed', e.target.checked)}
          />{' '}
          I confirmed the usable length of every bolt / roll in this receipt.
        </span>
      </label>
    </div>
  )
}

export function FabricPriceFields({
  value,
  change,
  totalKey = 'price',
}: {
  value: Item
  change: (key: string, value: string | number | boolean) => void
  totalKey?: string
}) {
  const perUnit = value.priceMode === 'per_unit'
  return (
    <>
      <Field label="Purchase price entry">
        <select
          value={value.priceMode || 'total'}
          onChange={(e) => change('priceMode', e.target.value)}
        >
          <option value="total">Total acquisition cost</option>
          <option value="per_unit">Price per purchase unit</option>
        </select>
      </Field>
      <Field
        label={perUnit ? 'Price per purchase unit' : 'Total acquisition cost'}
      >
        <input
          type="number"
          min="0"
          step="any"
          required
          value={value[perUnit ? 'purchaseUnitPrice' : totalKey] ?? ''}
          onChange={(e) =>
            change(perUnit ? 'purchaseUnitPrice' : totalKey, e.target.value)
          }
        />
      </Field>
    </>
  )
}
