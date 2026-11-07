import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog'
import { copyLabelDesign, templateNameKey } from '@/lib/label-library'
import type { LabelDocument } from '@/lib/label-studio'

export type TemplateDialogAction = {
  mode: 'new' | 'update' | 'rename' | 'duplicate'
  document: LabelDocument
  fromEditor?: boolean
}

export function TemplateSaveDialog({
  action,
  templates,
  onSave,
  onClose,
}: {
  action: TemplateDialogAction
  templates: LabelDocument[]
  onSave: (document: LabelDocument, expectedRevision: number) => Promise<void>
  onClose: () => void
}) {
  const [copy] = useState(() => copyLabelDesign(action.document, 'template'))
  const [name, setName] = useState(
    action.mode === 'rename'
      ? action.document.name
      : action.mode === 'duplicate' || action.document.recordKind === 'template'
        ? action.document.name.slice(0, 90) + ' copy'
        : action.document.name,
  )
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const duplicate = templates.find(
    (t) =>
      templateNameKey(t.name) === templateNameKey(name) &&
      !(action.mode === 'rename' && t.id === action.document.id),
  )
  const title =
    action.mode === 'update'
      ? 'Update Existing Template'
      : action.mode === 'rename'
        ? 'Rename template'
        : action.mode === 'duplicate'
          ? 'Duplicate template'
          : 'Save as New Template'
  async function save(target?: LabelDocument) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const existing = action.mode === 'rename' ? action.document : target
      const document = {
        ...copy,
        ...(!existing ? { renderVersion: 2 as const } : {}),
        id: existing?.id || copy.id,
        revision: existing?.revision || 0,
        name:
          existing && action.mode !== 'rename' ? existing.name : name.trim(),
      }
      await onSave(document, existing?.revision || 0)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {action.mode === 'update'
            ? 'Choose the template to replace with this editable design. Previously saved labels keep their own designs.'
            : 'Save the complete editable design, including dimensions, elements, images, fonts, and field bindings, to your oven.'}
        </DialogDescription>
        {action.mode === 'update' ? (
          <label className="studio-field">
            Existing template
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={busy}
            >
              <option value="">Choose a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="studio-field">
            Template name
            <input
              autoFocus
              maxLength={100}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        {duplicate && action.mode !== 'update' && (
          <p role="alert">
            A template named “{duplicate.name}” already exists. Choose another
            name or explicitly update it below.
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
          {duplicate && action.mode !== 'update' && (
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => void save(duplicate)}
            >
              Update existing “{duplicate.name}”
            </button>
          )}
          <button
            className="btn"
            disabled={
              busy ||
              (action.mode === 'update'
                ? !targetId
                : !name.trim() || !!duplicate)
            }
            onClick={() =>
              void save(
                action.mode === 'update'
                  ? templates.find((t) => t.id === targetId)
                  : undefined,
              )
            }
          >
            {busy
              ? 'Saving…'
              : action.mode === 'update'
                ? 'Update Template'
                : action.mode === 'rename'
                  ? 'Rename template'
                  : 'Save template'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

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
            ? 'Source templates, other labels, and shared images remain available.'
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
