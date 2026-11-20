import './item-deletion.css'
import { TooltipProvider } from './ui/tooltip'
import type { ButtonHTMLAttributes } from 'react'
import { Trash2 } from 'lucide-react'
import { ActionTip } from './action-tip'
export function ItemRemoveButton({
  label,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <TooltipProvider>
      <ActionTip label={label}>
        <button
          {...props}
          type="button"
          className={`icon-button item-delete-action item-remove-button ${className}`}
          aria-label={label}
        >
          <Trash2 size={18} aria-hidden="true" />
        </button>
      </ActionTip>
    </TooltipProvider>
  )
}
