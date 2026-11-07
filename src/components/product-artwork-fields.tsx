import { useState } from 'react'
import type { Workspace, Item } from '@/lib/domain'
const roles = [
  ['imageAssetId', 'Product photo', 'product photo'],
  ['graphicAssetId', 'Label graphic', 'illustration'],
]
export function ProductArtworkFields({
  assets,
  value,
  onChange,
  onWorkspace,
  canUpload,
  onBusy,
  purpose = 'product',
  only,
}: {
  assets: Item[]
  value: Record<string, any>
  onChange: (key: string, value: string | number) => void
  onWorkspace: (w: Workspace) => void
  canUpload: boolean
  onBusy: (busy: boolean) => void
  purpose?: 'product' | 'material'
  /** Limit to specific artwork roles, e.g. label graphics when the photo is edited elsewhere. */
  only?: string[]
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState('')
  async function upload(file: File, key: string, category: string) {
    if (!canUpload) return
    setBusy(true)
    onBusy(true)
    setError('')
    setStatus('Uploading artwork…')
    try {
      const body = new FormData()
      body.set('file', file)
      body.set('category', category)
      body.set('collection', 'Product artwork')
      const response = await fetch('/api/workspace?upload=1', {
        method: 'POST',
        body,
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || 'Artwork upload failed.')
      onWorkspace(result.workspace)
      if (key === 'graphicAssetId') onChange('labelArtworkVersion', 2)
      onChange(key, result.asset.id)
      setStatus(`Photo uploaded. Save the ${purpose} to keep this link.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Artwork upload failed.')
      setStatus('')
    } finally {
      setBusy(false)
      onBusy(false)
    }
  }
  return (
    <details>
      <summary>
        {purpose === 'material'
          ? 'Material photo'
          : only?.length === 1 && only[0] === 'graphicAssetId'
            ? 'Label graphic'
            : 'Product images & label graphics'}
      </summary>
      <p>Upload a photo or choose existing artwork.</p>
      {(purpose === 'material'
        ? [['imageAssetId', 'Material photo', 'product photo']]
        : roles.filter(([key]) => !only || only.includes(key))
      ).map(([key, label, category]) => (
        <div key={key} style={{ margin: '14px 0' }}>
          <label className="field">
            <span>{label}</span>
            <select
              aria-label={label}
              value={
                value[key] ||
                (key === 'graphicAssetId' && value.labelArtworkVersion !== 2
                  ? value.iconAssetId || ''
                  : '')
              }
              onChange={(e) => {
                if (key === 'graphicAssetId') onChange('labelArtworkVersion', 2)
                onChange(key, e.target.value)
              }}
            >
              <option value="">No linked artwork</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {key === 'graphicAssetId' && (
            <small>
              Optional artwork for this product. Available to add in Label
              Studio.
            </small>
          )}
          {value[key] && (
            <img
              src={assets.find((a) => a.id === value[key])?.fileUrl}
              alt={`${label} preview`}
              style={{
                width: 90,
                height: 70,
                objectFit: 'contain',
                margin: '8px 0',
              }}
            />
          )}
          <label className="btn secondary">
            Upload {label.toLowerCase()}
            <input
              className="sr-only"
              type="file"
              aria-label={`Upload ${label.toLowerCase()}`}
              accept="image/png,image/jpeg,image/webp"
              disabled={busy || !canUpload}
              onChange={(e) => {
                if (e.target.files?.[0])
                  void upload(e.target.files[0], key, category)
              }}
            />
          </label>
        </div>
      ))}
      <small>
        PNG, JPEG, or WebP · up to 5 MB. Transparent PNG works well for icons
        and logos.
      </small>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </details>
  )
}
