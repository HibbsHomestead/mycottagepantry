import { useId, useState, type ReactNode } from 'react'
import type { Item, Workspace } from '@/lib/domain'
import { PantryPhoto } from './pantry-photo'

/**
 * Shared photo section for Add Item and Edit Product: preview, choose an
 * existing oven photo, or upload one. Uploading stores the asset only; the
 * item keeps the link when the surrounding form is saved.
 */
export function ItemPhotoField({
  value,
  assets,
  kind,
  disabled = false,
  canUpload = true,
  onChange,
  onWorkspace,
  onBusy,
  onError,
  children,
  uploadLabel = 'Upload photo',
  showPhotoPicker = true,
}: {
  value: Item
  assets: Item[]
  kind: 'pantry' | 'product'
  disabled?: boolean
  canUpload?: boolean
  onChange: (key: string, value: string) => void
  onWorkspace: (workspace: Workspace) => void
  onBusy?: (busy: boolean) => void
  onError?: (message: string) => void
  children?: ReactNode
  uploadLabel?: string
  showPhotoPicker?: boolean
}) {
  const [uploading, setUploading] = useState(false),
    [localError, setLocalError] = useState('')
  const photoId = useId(),
    uploadId = useId()
  const report = (message: string) => {
    setLocalError(onError ? '' : message)
    onError?.(message)
  }
  return (
    <div className="add-item-photo">
      <PantryPhoto
        item={{ ...value, name: value.name || 'New item' }}
        assets={assets}
        kind={kind}
        className="add-item-photo-preview"
      />
      {showPhotoPicker && (
        <label className="field" htmlFor={photoId}>
          <span>Photo</span>
          <select
            id={photoId}
            value={value.imageAssetId || ''}
            disabled={disabled || uploading}
            onChange={(e) => onChange('imageAssetId', e.target.value)}
          >
            <option value="">No photo</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {canUpload && (
        <label className="field" htmlFor={uploadId}>
          <span>{uploadLabel}</span>
          <input
            id={uploadId}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={disabled || uploading}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              setUploading(true)
              onBusy?.(true)
              report('')
              try {
                const body = new FormData()
                body.set('file', file)
                body.set('category', 'product photo')
                const response = await fetch('/api/workspace?upload=1', {
                  method: 'POST',
                  body,
                })
                const result = await response.json().catch(() => ({}))
                if (!response.ok || !result.asset?.id)
                  throw new Error(
                    result.error ||
                      'Photo upload failed. Your other changes are preserved.',
                  )
                onWorkspace(result.workspace)
                onChange('imageAssetId', result.asset.id)
              } catch (error) {
                report(
                  error instanceof Error
                    ? error.message
                    : 'Photo upload failed. Your other changes are preserved.',
                )
              } finally {
                setUploading(false)
                onBusy?.(false)
                e.target.value = ''
              }
            }}
          />
        </label>
      )}
      {uploading && <p role="status">Uploading photo…</p>}
      {localError && (
        <p role="alert" className="form-error">
          {localError}
        </p>
      )}
      {children}
    </div>
  )
}
