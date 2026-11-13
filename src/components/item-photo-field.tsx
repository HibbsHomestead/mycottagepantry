import { useEffect, useId, useState, type ReactNode } from 'react'
import type { Item, Workspace } from '@/lib/domain'
import { imageDisplayName } from '@/lib/image-display-name'
import { PhotoBox } from './photo-box'

/** Upload stores an asset; only the surrounding form's Save attaches it. */
export function ItemPhotoField({
  value,
  assets,
  disabled = false,
  canUpload = true,
  onChange,
  onWorkspace,
  onBusy,
  onError,
  children,
  uploadLabel = 'Upload photo',
  showPhotoPicker = true,
  className = 'add-item-photo',
  previewClassName = 'add-item-photo-preview',
  collection,
}: {
  value: Item
  assets: Item[]
  kind?: 'pantry' | 'product'
  disabled?: boolean
  canUpload?: boolean
  onChange: (key: string, value: string) => void
  onWorkspace: (workspace: Workspace) => void
  onBusy?: (busy: boolean) => void
  onError?: (message: string) => void
  children?: ReactNode
  uploadLabel?: string
  showPhotoPicker?: boolean
  className?: string
  previewClassName?: string
  collection?: string
}) {
  const errorId = useId()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState('')
  const [uploaded, setUploaded] = useState<Item | null>(null)
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview)
    },
    [preview],
  )
  const report = (message: string) => {
    setError(message)
    onError?.(message)
  }
  const photo =
    assets.find((a) => a.id === value.imageAssetId) ||
    (uploaded?.id === value.imageAssetId ? uploaded : null)
  async function upload(file: File) {
    if (disabled || uploading || !canUpload) return
    report('')
    if (!file.size || file.size > 5000000) {
      report('Choose a PNG, JPEG, or WebP image smaller than 5 MB.')
      return
    }
    setPreview(URL.createObjectURL(file))
    setUploading(true)
    onBusy?.(true)
    try {
      const body = new FormData()
      body.set('file', file)
      body.set('category', 'product photo')
      if (collection) body.set('collection', collection)
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
      setUploaded(result.asset)
      onWorkspace(result.workspace)
      onChange('imageAssetId', result.asset.id)
    } catch (e) {
      report(
        e instanceof Error
          ? e.message
          : 'Photo upload failed. Your other changes are preserved.',
      )
    } finally {
      setPreview('')
      setUploading(false)
      onBusy?.(false)
    }
  }
  return (
    <div className={className}>
      <PhotoBox
        className={previewClassName}
        src={preview || photo?.fileUrl}
        alt={`Photo of ${value.name || 'New item'}`}
        selected={value.imageAssetId || ''}
        disabled={disabled}
        busy={uploading}
        canUpload={canUpload}
        inputLabel={uploadLabel}
        errorId={error ? errorId : undefined}
        onFile={(file) => void upload(file)}
        onRemove={() => {
          report('')
          onChange('imageAssetId', '')
        }}
        choices={
          showPhotoPicker
            ? assets.map((a, i) => ({
                id: a.id,
                name: imageDisplayName(a, i + 1),
              }))
            : []
        }
        onSelect={(id) => {
          report('')
          onChange('imageAssetId', id)
        }}
      />
      {error && (
        <p id={errorId} role="alert" className="form-error">
          {error}
        </p>
      )}
      {children}
    </div>
  )
}
