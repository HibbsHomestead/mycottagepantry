import { useId } from 'react'
import { minimumOrder, wholePurchaseUnit } from '@/lib/item-restocking'
import type { Item } from '@/lib/domain'

export function ItemRestocking({
  value,
  change,
  stockUnit,
}: {
  value: Item
  change: (key: string, value: Item[string]) => void
  stockUnit?: string
}) {
  const id = useId()
  const stock = stockUnit || value.storageUnit || value.unit || '—'
  const purchase = value.purchaseUnit || 'Choose a purchase unit'
  let minimumError = ''
  let minimumValue = value.minimumOrderQuantity ?? ''
  try {
    minimumValue = minimumOrder(value).minimumOrderQuantity ?? ''
  } catch (e) {
    minimumError = (e as Error).message
  }
  const thresholdError =
    value.threshold !== '' &&
    (!Number.isFinite(Number(value.threshold ?? 0)) ||
      Number(value.threshold) < 0)
  return (
    <section className="item-restocking" aria-label="Restocking">
      <h3>Restocking</h3>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${id}-threshold`}>Reorder when stock reaches</label>
          <div className="restocking-quantity">
            <input
              id={`${id}-threshold`}
              type="number"
              min="0"
              step="any"
              value={value.threshold ?? ''}
              aria-invalid={thresholdError || undefined}
              onChange={(e) => change('threshold', e.target.value)}
            />{' '}
            <span>{stock} or less</span>
          </div>
          <small>Flag this item as low stock at this amount.</small>
          {value.thresholdUnitReviewRequired && (
            <small role="alert">
              Review the reorder level in {stock} before saving.
            </small>
          )}
          <small>
            {value.inventoryCreation
              ? 'Blank uses the existing default of zero.'
              : 'Zero flags empty stock. A blank value requires review before saving.'}
          </small>
          {thresholdError && (
            <small role="alert">Enter zero or a positive reorder level.</small>
          )}
        </div>
        <div className="field">
          <label htmlFor={`${id}-minimum`}>Minimum order quantity</label>
          <div className="restocking-quantity">
            <input
              id={`${id}-minimum`}
              type="number"
              min="0"
              step={
                wholePurchaseUnit(purchase, value.conversions) ? '1' : 'any'
              }
              value={minimumValue}
              aria-invalid={!!minimumError || undefined}
              onChange={(e) => {
                change('minimumOrderQuantity', e.target.value)
                change('minimumOrderUnit', value.purchaseUnit || '')
              }}
            />{' '}
            <span>{purchase}</span>
          </div>
          <small>The smallest amount you can buy in one order.</small>
          {value.amountPerPackage ||
          value.purchaseSetup?.stockUnits ||
          value.itemsPerUnit ? (
            <small>
              Package contents:{' '}
              {value.amountPerPackage ||
                value.purchaseSetup?.stockUnits ||
                value.itemsPerUnit}{' '}
              {value.contentsUnit || stock} per {purchase}.
            </small>
          ) : value.purchaseQuantity ? (
            <small>
              Recorded package: {value.purchaseQuantity} {purchase}
              {value.packageSize ? ` · ${value.packageSize}` : ''}.
            </small>
          ) : null}
          {minimumError && <small role="alert">{minimumError}</small>}
        </div>
      </div>
    </section>
  )
}
