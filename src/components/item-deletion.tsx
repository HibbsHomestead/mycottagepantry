import { DestructiveConfirmationContent } from './destructive-confirmation'
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Trash2 } from 'lucide-react'
import type { Item, Workspace } from '@/lib/domain'
import { itemType, type DeletableTable } from '@/lib/item-deletion'
import {
  fetchWorkspaceWithDiagnostics,
  readWorkspaceJsonWithDiagnostics,
} from '@/lib/inventory-error-details'
import { Dialog } from './ui/dialog'
import { ActionTip } from './action-tip'
import './item-deletion.css'

type Target = { table: DeletableTable; item: Item; draft?: boolean }
const SavedRecordContext = createContext<Workspace | null>(null)
const DeletionContext = createContext<((target: Target) => void) | null>(null)
export function ItemDeleteButton({ table, item, draft = false }: Target) {
  const request = useContext(DeletionContext)
  const workspace = useContext(SavedRecordContext)
  if (workspace && !workspace[table]?.some((row) => row.id === item.id))
    return null
  if (!request) return null
  return (
    <ActionTip label={`Delete ${item.name}`}>
      <button
        type="button"
        className="btn secondary item-delete-action responsive-action"
        aria-label={`Delete ${item.name}`}
        onClick={(event) => {
          event.stopPropagation()
          request({ table, item, draft })
        }}
      >
        <Trash2 size={18} aria-hidden="true" />
        <span className="responsive-action-label">Delete</span>
      </button>
    </ActionTip>
  )
}
export function ItemDeletionProvider({
  children,
  canDelete,
  workspace,
  onWorkspace,
  onDeleted,
}: {
  children: ReactNode
  canDelete: boolean
  workspace?: Workspace
  onWorkspace: (workspace: Workspace) => void
  onDeleted: () => void
}) {
  const [target, setTarget] = useState<Target | null>(null)
  const [blockers, setBlockers] = useState<string[]>([])
  const [checking, setChecking] = useState(false)
  const [ownedOutput, setOwnedOutput] = useState<{
    id: string
    name: string
  } | null>(null)
  const [canArchive, setCanArchive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  async function request(action: string, current: Target) {
    const response = await fetchWorkspaceWithDiagnostics({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        table: current.table,
        data: {
          id: current.item.id,
          confirmed: action === 'itemDelete' || action === 'itemArchive',
          expectedName: current.item.name,
          confirmedOutputId: ownedOutput?.id,
          expectedOutputName: ownedOutput?.name,
        },
      }),
    })
    const data = await readWorkspaceJsonWithDiagnostics(response)
    if (!response.ok)
      throw new Error(
        data.error ||
          'Unable to check this item. Retry; it has not been removed from this view.',
      )
    return data
  }
  useEffect(() => {
    if (!target) return
    let cancelled = false
    void request('itemDeleteCheck', target)
      .then((data) => {
        if (
          !Array.isArray(data.blockers) ||
          data.item?.id !== target.item.id ||
          data.item?.name !== target.item.name
        )
          throw new Error(
            'This item changed. Cancel and reopen deletion to review its current details.',
          )
        if (!cancelled) {
          setBlockers(data.blockers)
          setOwnedOutput(data.ownedOutput || null)
          setCanArchive(data.canArchive === true)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [target])
  return (
    <SavedRecordContext.Provider value={workspace || null}>
      <DeletionContext.Provider
        value={
          canDelete
            ? (next) => {
                setOwnedOutput(null)
                setCanArchive(false)
                setChecking(true)
                setError('')
                setBlockers([])
                setTarget(next)
              }
            : null
        }
      >
        {children}
        <Dialog
          open={!!target}
          onOpenChange={(open) => {
            if (!open && !pending.current) setTarget(null)
          }}
        >
          <DestructiveConfirmationContent
            busy={busy}
            title={
              <>
                {blockers.length
                  ? `Cannot delete ${target?.item.name}`
                  : `Delete ${target?.item.name}?`}
              </>
            }
            description={
              <>
                {blockers.length ? (
                  'Stock, linked records or history prevent permanent deletion. Review the dependencies below; nothing has been removed.'
                ) : (
                  <>
                    Permanently remove this{' '}
                    {target ? itemType(target.table, target.item) : 'item'}{' '}
                    definition from this business. Only the definition and any
                    explicitly named generated output are removed. Shared
                    images, artwork, original Dropbox files and unrelated
                    records are retained.
                  </>
                )}
              </>
            }
            actions={
              <>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => setTarget(null)}
                >
                  Cancel
                </button>
                {canArchive && !!blockers.length && (
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy || checking || !!error}
                    onClick={async () => {
                      if (!target || pending.current) return
                      pending.current = true
                      setBusy(true)
                      try {
                        const data = await request('itemArchive', target)
                        if (
                          !data.workspace?.products?.some(
                            (row: Item) =>
                              row.id === target.item.id &&
                              row.archived === true,
                          )
                        )
                          throw new Error(
                            'Archive was not confirmed. Refresh before retrying.',
                          )
                        onWorkspace(data.workspace)
                        setTarget(null)
                        onDeleted()
                      } catch (e) {
                        setError((e as Error).message)
                      } finally {
                        pending.current = false
                        setBusy(false)
                      }
                    }}
                  >
                    Archive basket instead
                  </button>
                )}
                <button
                  type="button"
                  className="btn destructive-confirm"
                  disabled={checking || busy || !!blockers.length || !!error}
                  onClick={async () => {
                    if (!target || pending.current) return
                    pending.current = true
                    setBusy(true)
                    try {
                      const data = await request('itemDelete', target)
                      if (
                        !data.workspace ||
                        data.workspace[target.table]?.some(
                          (row: Item) => row.id === target.item.id,
                        )
                      )
                        throw new Error(
                          'The response did not confirm deletion. Refresh before retrying.',
                        )
                      onWorkspace(data.workspace)
                      setTarget(null)
                      onDeleted()
                    } catch (e) {
                      setError((e as Error).message)
                    } finally {
                      pending.current = false
                      setBusy(false)
                    }
                  }}
                >
                  {busy ? 'Deleting…' : 'Delete'}
                </button>
              </>
            }
          >
            <p>
              {target?.table === 'ingredients'
                ? 'This removes the saved item and its unit-conversion setup.'
                : target?.table === 'recipes'
                  ? 'This removes the recipe/prep and its definition lines.'
                  : 'This removes the product and its packaging and tax-assignment setup. Packaging inventory items are retained.'}
            </p>

            {ownedOutput && (
              <p>
                This also permanently removes its generated output ingredient “
                {ownedOutput.name}” (ID: {ownedOutput.id}). Both records are
                removed together only after stock and dependency checks pass.
              </p>
            )}
            {target?.table === 'recipes' && !!blockers.length && (
              <p>
                “No products linked” only describes product links. Prepared
                inventory, other recipes and history are checked separately.
                Review the named records in Ingredients or Recipes. Recipe
                archive is not currently supported; retain historical records.
              </p>
            )}
            {target?.draft && (
              <p className="warning-text">
                Deleting discards the unsaved draft in this editor. It does not
                save your changes.
              </p>
            )}
            {checking && (
              <p role="status">Checking stock, history and linked records…</p>
            )}
            {!!blockers.length && (
              <section aria-label="Deletion blockers">
                <h3>This item cannot be deleted</h3>
                <p>
                  Resolve current links where appropriate. Historical
                  transactions and stock movements must remain intact.
                </p>
                <ul>
                  {blockers.map((blocker, index) => (
                    <li key={index}>{blocker}</li>
                  ))}
                </ul>
              </section>
            )}
            {canArchive && !!blockers.length && (
              <p>
                Archiving the basket preserves its definition, stock, links and
                history, and marks it archived. It is not permanent deletion.
                The existing list continues to show archived products.
              </p>
            )}
            {!checking && !error && !blockers.length && (
              <p>
                No blocking dependencies were found. The server checks again
                when you confirm.
              </p>
            )}
            {error && (
              <p role="alert">
                {error} Cancel and reopen to refresh the checks, or retry the
                operation. Your item remains visible.
              </p>
            )}
          </DestructiveConfirmationContent>
        </Dialog>
      </DeletionContext.Provider>
    </SavedRecordContext.Provider>
  )
}
