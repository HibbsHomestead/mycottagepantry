import {
  inventoryReviewLabels,
  inventoryReviewReasons,
  type InventoryReviewReason,
} from '@/lib/inventory-review'
import type { Item, Workspace } from '@/lib/domain'
import './inventory-review.css'

export function InventoryReviewBadges({
  reasons,
  onSetup,
}: {
  reasons: InventoryReviewReason[]
  onSetup?: (reason: InventoryReviewReason) => void
}) {
  if (!reasons.length) return null
  return (
    <div className="inventory-review-badges" aria-label="Review reasons">
      {reasons.map((reason) =>
        onSetup ? (
          <button
            key={reason}
            type="button"
            className="inventory-review-badge"
            onClick={() => onSetup(reason)}
          >
            {inventoryReviewLabels[reason]}
          </button>
        ) : (
          <span key={reason} className="inventory-review-badge">
            {inventoryReviewLabels[reason]}
          </span>
        ),
      )}
    </div>
  )
}

export function InventoryReviewNotice({
  item,
  workspace,
  canEdit,
  busy,
  onSetup,
  onMarkReviewed,
}: {
  item: Item
  workspace: Workspace
  canEdit: boolean
  busy: boolean
  onSetup: (reason: InventoryReviewReason) => void
  onMarkReviewed: () => void
}) {
  const reasons = inventoryReviewReasons(item, workspace)
  if (!reasons.length) return null
  return (
    <section className="inventory-review-notice" aria-label="Item setup review">
      <InventoryReviewBadges
        reasons={reasons.filter((r) => r !== 'import')}
        onSetup={canEdit && !busy ? onSetup : undefined}
      />
      {reasons.includes('import') && (
        <div className="inventory-import-review">
          <span>
            <strong>Review imported data</strong>
            <small>
              Check the imported values, then mark reviewed. Missing setup and
              supplier/allergen review stay separate.
            </small>
          </span>
          {canEdit && (
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={onMarkReviewed}
            >
              {busy ? 'Saving…' : 'Mark reviewed'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
