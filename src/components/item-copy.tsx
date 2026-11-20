import { createContext, useContext, type ReactNode } from 'react'
import { Copy } from 'lucide-react'
import type { Item } from '@/lib/domain'
import { ActionTip } from './action-tip'

type CopyAction = (table: 'recipes' | 'products', item: Item) => void
const CopyContext = createContext<CopyAction | null>(null)
export function ItemCopyProvider({
  onCopy,
  children,
  enabled = true,
}: {
  onCopy: CopyAction
  enabled?: boolean
  children: ReactNode
}) {
  return <CopyContext.Provider value={enabled ? onCopy : null}>{children}</CopyContext.Provider>
}
export function ItemCopyButton({ table, item }: { table: string; item: Item }) {
  const copy = useContext(CopyContext)
  if (!copy || !['recipes', 'products'].includes(table)) return null
  return (
    <ActionTip label={`Copy ${item.name}`}>
      <button
        type="button"
        className="btn secondary responsive-action"
        aria-label={`Copy ${item.name}`}
        onClick={(event) => {
          event.stopPropagation()
          copy(table as 'recipes' | 'products', item)
        }}
      >
        <Copy size={18} aria-hidden="true" />
        <span className="responsive-action-label">Copy</span>
      </button>
    </ActionTip>
  )
}
