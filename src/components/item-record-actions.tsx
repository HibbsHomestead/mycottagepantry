import { ItemCopyButton } from './item-copy'
import { Eye, Pencil } from 'lucide-react'
import type { Item } from '@/lib/domain'
import type { DeletableTable } from '@/lib/item-deletion'
import { ItemDeleteButton } from './item-deletion'
import { ActionTip } from './action-tip'
import './item-record-actions.css'

/** Shared placement; deletion continues through the server-checked confirmation. */
export function ItemRecordActions({
  item,
  table,
  view,
  edit,
}: {
  item: Item
  table: DeletableTable
  view: () => void
  edit?: () => void
}) {
  return (
    <div className="item-record-actions">
      <ActionTip label={`View details for ${item.name}`}>
        <button
          type="button"
          className="btn secondary responsive-action"
          aria-label={`View details for ${item.name}`}
          onClick={(e) => {
            e.stopPropagation()
            view()
          }}
        >
          <Eye size={18} aria-hidden="true" />
          <span className="responsive-action-label">View details</span>
        </button>
      </ActionTip>
      {edit && (
        <ActionTip label={`Edit ${item.name}`}>
          <button
            type="button"
            className="btn secondary responsive-action"
            aria-label={`Edit ${item.name}`}
            onClick={(e) => {
              e.stopPropagation()
              edit()
            }}
          >
            <Pencil size={18} aria-hidden="true" />
            <span className="responsive-action-label">Edit</span>
          </button>
        </ActionTip>
      )}
      <ItemCopyButton table={table} item={item} />
      <span className="item-action-destructive">
        <ItemDeleteButton table={table} item={item} />
      </span>
    </div>
  )
}
