import type { Item, Workspace } from '@/lib/domain'
import { labelsForProduct } from '@/lib/saved-labels'

export function ProductLabelsInfo({
  value,
  workspace,
}: {
  value: Item
  workspace: Workspace
}) {
  const labels = labelsForProduct(workspace, value)
  return (
    <section className="product-labels-info" aria-label="Linked labels">
      <h3>Labels</h3>
      {labels.length ? (
        <ul>
          {labels.map((label) => (
            <li key={label.id}>
              {label.name}
              {label.format === 'front-back' ? ' · Front + Back' : ''}
            </li>
          ))}
        </ul>
      ) : (
        <p>No linked labels.</p>
      )}
      <p className="table-note">
        Create or duplicate a label in Labels and choose this product. A product
        can have several labels.
      </p>
    </section>
  )
}
