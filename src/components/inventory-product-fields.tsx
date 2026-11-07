import { inventoryProductLabels } from '@/lib/inventory-product'
export function InventoryProductFields({
  value,
  change,
  typeAware = false,
}: {
  typeAware?: boolean
  value: Record<string, any>
  change: (key: string, value: string) => void
}) {
  return (
    <details className="form-step">
      <summary>Product source & specifications</summary>
      <label className="field">
        <span>Saved product URL</span>
        <input
          type="url"
          value={value.productSourceUrl || ''}
          onChange={(e) => change('productSourceUrl', e.target.value)}
        />
      </label>
      <div className="form-grid">
        {Object.entries(inventoryProductLabels)
          .filter(
            ([key]) =>
              (!typeAware ||
                ((!key.startsWith('yarn') ||
                  (value.usedAs === 'material' &&
                    value.materialType === 'yarn')) &&
                  (!['fiber', 'color', 'pattern'].includes(key) ||
                    value.usedAs === 'material'))) &&
              !['materialType', 'fabricWidth', 'widthUnit'].includes(key) &&
              (value[key] != null ||
                [
                  'manufacturerSku',
                  'retailerSku',
                  'dimensions',
                  'itemsPerPackage',
                ].includes(key)),
          )
          .map(([key, label]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                value={value[key] ?? ''}
                onChange={(e) => change(key, e.target.value)}
              />
            </label>
          ))}
      </div>
      {value.listedOnlinePrice != null && (
        <p>
          Listed online price: {value.listedOnlinePrice} {value.currency}.
          Actual purchase cost is entered separately when receiving.
        </p>
      )}
    </details>
  )
}
