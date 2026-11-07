import { ArtworkPicker } from './artwork-picker'
import { libraryArtwork } from '@/lib/artwork-library'
import { useId, useState, type ReactNode } from 'react'
import type { Item, Workspace } from '@/lib/domain'
import { PantryPhoto } from './pantry-photo'

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

/** Readable image name: never show an internal ID or a generated file hash. */
export function imageDisplayName(asset: Item | undefined, index = 0) {
  if (!asset) return ''
  const raw = String(asset.name || '').trim(),
    base = raw.replace(/\.(png|jpe?g|webp|gif)$/i, '').trim()
  const looksGenerated =
    !base ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      base,
    ) ||
    (!!asset.id && base.includes(String(asset.id))) ||
    /^[0-9a-f]{16,}$/i.test(base) ||
    /^(image|img|file|upload|blob)?[-_ ]?[0-9a-f-]{20,}$/i.test(base)
  if (!looksGenerated) return raw
  const kind = /photo/i.test(String(asset.category || ''))
    ? 'Uploaded photo'
    : 'Uploaded image'
  return index > 0 ? `${kind} ${index}` : kind
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
  const photoSelect = useId()
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

  async function upload(file: File, role: 'photo' | 'graphic') {
    if (!canUpload) return
    setUploading(role)
    onBusy(true)
    setError('')
    setStatus(role === 'photo' ? 'Uploading photo…' : 'Uploading artwork…')
    try {
      const result = await uploadAsset(
        file,
        role === 'photo' ? 'product photo' : 'illustration',
      )
      onWorkspace(result.workspace)
      if (role === 'photo') onChange('imageAssetId', result.asset.id)
      else setGraphic(result.asset.id)
      setStatus(
        `${role === 'photo' ? 'Photo' : 'Label artwork'} uploaded. Select Save to keep it on this item.`,
      )
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
        <PantryPhoto
          item={{ ...value, name: value.name || 'New item' }}
          assets={assets}
          kind="product"
          className="item-images-preview"
        />
        <div className="item-images-controls">
          <h3>{photoLabel}</h3>
          <p className="form-hint">
            {photo
              ? `${imageDisplayName(photo, assets.indexOf(photo) + 1)} · shown on inventory and product cards and in View Details.`
              : 'No photo yet. Cards show a generic icon until you add one.'}
          </p>
          <div className="item-images-actions">
            {canUpload && (
              <UploadButton
                label={photo ? 'Replace photo' : 'Upload photo'}
                disabled={locked}
                onFile={(file) => void upload(file, 'photo')}
              />
            )}
            {photo && (
              <button
                type="button"
                className="btn secondary"
                disabled={locked}
                onClick={() => onChange('imageAssetId', '')}
              >
                Remove photo
              </button>
            )}
          </div>
          <label className="field" htmlFor={photoSelect}>
            <span>Or choose from your oven’s images</span>
            <select
              id={photoSelect}
              value={value.imageAssetId || ''}
              disabled={locked}
              onChange={(e) => onChange('imageAssetId', e.target.value)}
            >
              <option value="">No photo</option>
              {assets.map((a, i) => (
                <option key={a.id} value={a.id}>
                  {imageDisplayName(a, i + 1)}
                </option>
              ))}
            </select>
          </label>
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
