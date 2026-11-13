import { ArtworkPicker } from './artwork-picker'
import { libraryArtwork } from '@/lib/artwork-library'
import { useId, useState, type ReactNode } from 'react'
import type { Item, Workspace } from '@/lib/domain'
import { ItemPhotoField } from './item-photo-field'
import { imageDisplayName } from '@/lib/image-display-name'
export { imageDisplayName } from '@/lib/image-display-name'

async function uploadAsset(file: File, category: string) {
  const body = new FormData()
  body.set('file', file)
  body.set('category', category)
  body.set('collection', 'Product artwork')
  const response = await fetch('/api/workspace?upload=1', {
    method: 'POST',
    body,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.asset?.id)
    throw new Error(
      result.error || 'Upload failed. Your other changes are preserved.',
    )
  return result as { asset: Item; workspace: Workspace }
}

function UploadButton({
  label,
  disabled,
  onFile,
}: {
  label: string
  disabled: boolean
  onFile: (file: File) => void
}) {
  const id = useId()
  return (
    <label
      className={`btn secondary item-images-upload${disabled ? ' is-disabled' : ''}`}
      htmlFor={id}
    >
      {label}
      <input
        id={id}
        className="sr-only"
        type="file"
        aria-label={label}
        accept="image/png,image/jpeg,image/webp"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onFile(file)
        }}
      />
    </label>
  )
}

/**
 * Images & Labels tab shared by item editors. The inventory-card photo and the
 * optional label artwork are separate links: changing one never replaces the
 * other, and uploads only attach to the draft until the whole form is saved.
 */
export function ItemImagesPanel({
  value,
  assets,
  canUpload,
  disabled,
  onChange,
  onWorkspace,
  onBusy,
  photoLabel = 'Product photo',
  labelArtwork = true,
  children,
}: {
  value: Item
  assets: Item[]
  canUpload: boolean
  disabled: boolean
  onChange: (key: string, value: string | number) => void
  onWorkspace: (workspace: Workspace) => void
  onBusy: (busy: boolean) => void
  photoLabel?: string
  /** Show the optional label icon/graphic selector. */
  labelArtwork?: boolean
  /** Type-specific label text fields (name parts, net quantity). */
  children?: ReactNode
}) {
  const [picker, setPicker] = useState(false)
  const [uploading, setUploading] = useState(''),
    [error, setError] = useState(''),
    [status, setStatus] = useState('')
  const locked = disabled || !!uploading
  const photo = assets.find((a) => a.id === value.imageAssetId)
  const graphicId =
    value.graphicAssetId ||
    (value.labelArtworkVersion !== 2 ? value.iconAssetId || '' : '')
  const graphic =
    libraryArtwork(graphicId) || assets.find((a) => a.id === graphicId)
  const setGraphic = (id: string) => {
    onChange('labelArtworkVersion', 2)
    onChange('graphicAssetId', id)
  }

  async function upload(file: File, role: 'graphic') {
    if (!canUpload) return
    setUploading(role)
    onBusy(true)
    setError('')
    setStatus('Uploading artwork…')
    try {
      const result = await uploadAsset(file, 'illustration')
      onWorkspace(result.workspace)
      setGraphic(result.asset.id)
      setStatus('Label artwork uploaded. Select Save to keep it on this item.')
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : 'Upload failed. Your other changes are preserved.',
      )
      setStatus('')
    } finally {
      setUploading('')
      onBusy(false)
    }
  }

  return (
    <div className="item-images">
      {picker && (
        <ArtworkPicker
          assets={assets}
          selected={graphicId}
          choose={(id) => {
            setGraphic(id)
            setPicker(false)
          }}
          close={() => setPicker(false)}
        />
      )}
      <section className="item-images-photo" aria-label={photoLabel}>
        <ItemPhotoField
          value={value}
          assets={assets}
          canUpload={canUpload}
          disabled={locked}
          onChange={onChange}
          onWorkspace={onWorkspace}
          onBusy={onBusy}
          className="item-photo-control"
          previewClassName="item-images-preview"
          collection="Product artwork"
        />
        <div className="item-images-controls">
          <h3>{photoLabel}</h3>
          <p className="form-hint">
            {photo
              ? `${imageDisplayName(photo, assets.indexOf(photo) + 1)} · shown on inventory and product cards and in View Details.`
              : 'No photo yet. Cards show a generic icon until you add one.'}
          </p>
          <small className="form-hint">PNG, JPEG, or WebP · up to 5 MB.</small>
        </div>
      </section>
      {labelArtwork && (
        <section className="item-images-label" aria-label="Label artwork">
          <span className="item-images-icon">
            {graphic?.fileUrl ? (
              <img src={graphic.fileUrl} alt="Label artwork preview" />
            ) : (
              <span className="form-hint">No label artwork</span>
            )}
          </span>
          <div className="item-images-controls">
            <h3>Label icon/artwork (optional)</h3>
            <p className="form-hint">
              Used only in Label Studio. It never replaces the card photo.
            </p>
            <div className="item-images-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={locked}
                onClick={() => setPicker(true)}
              >
                Choose artwork
              </button>
              {canUpload && (
                <UploadButton
                  label="Upload my own"
                  disabled={locked}
                  onFile={(file) => void upload(file, 'graphic')}
                />
              )}
              {graphicId && (
                <button
                  type="button"
                  className="btn secondary"
                  disabled={locked}
                  onClick={() => setGraphic('')}
                >
                  Remove artwork
                </button>
              )}
            </div>
          </div>
        </section>
      )}
      {children}
      {status && (
        <p role="status" className="form-hint">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  )
}
