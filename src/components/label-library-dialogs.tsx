import { useState } from 'react'
import type { LabelDocument } from '@/lib/label-studio'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog'

export function DeleteDesignDialog({
  documents,
  kind,
  openDocumentId,
  affectedProducts = [],
  onDelete,
  onClose,
}: {
  documents: LabelDocument[]
  kind: 'label' | 'template'
  openDocumentId?: string
  affectedProducts?: string[]
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogTitle>
          Delete{' '}
          {documents.length === 1 ? kind : `${documents.length} ${kind}s`}?
        </DialogTitle>
        <DialogDescription>
          {documents.length === 1
            ? `Delete “${documents[0].name}”?`
            : `Delete these ${documents.length} selected ${kind}s?`}{' '}
          {kind === 'label'
            ? 'Other labels, products, shared images, and print history remain available.'
            : 'Labels already made from this template keep their complete editable designs. Products, artwork, and print history are preserved.'}
          {documents.some((d) => d.isSystem) &&
            ' This removes the built-in template only from this oven’s library and template picker, on every device. Other ovens are unaffected.'}
          {documents.some((d) => d.id === openDocumentId) &&
            ' The open design is included. Its editor closes and any unsaved edits are discarded after deletion succeeds.'}
        </DialogDescription>
        {affectedProducts.length > 0 && (
          <p role="alert">
            Resolve assignments before deletion: {affectedProducts.join(', ')}
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <button className="btn secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn studio-delete-button"
            disabled={busy || affectedProducts.length > 0}
            onClick={async () => {
              if (busy) return
              setBusy(true)
              setError('')
              try {
                await onDelete()
                onClose()
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy
              ? 'Deleting…'
              : documents.length === 1
                ? `Delete ${kind}`
                : `Delete ${documents.length} ${kind}s`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
