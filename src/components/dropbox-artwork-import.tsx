import { useEffect, useRef, useState } from 'react'
import type { PreviewDiagnostics } from '../../netlify/lib/dropbox-artwork'
import type { Item, Workspace } from '@/lib/domain'

type Selection = {
  id: string
  name: string
  bytes: number
  thumbnailLink?: string
  isDir?: boolean
}
type Preview = {
  data: string
  width: number
  height: number
  bytes: number
  hasAlpha: boolean
}
type Dropbox = {
  isBrowserSupported(): boolean
  choose(options: {
    success(files: Selection[]): void
    cancel(): void
    linkType: string
    multiselect: boolean
    folderselect: boolean
    extensions: string[]
  }): void
}
declare global {
  interface Window {
    Dropbox?: Dropbox
  }
}
let loading: Promise<void> | undefined
async function loadChooser() {
  if (window.Dropbox) return
  if (!loading)
    loading = (async () => {
      const r = await fetch('/api/workspace?dropboxChooser=1')
      const config = await r.json()
      if (!r.ok || !config.appKey)
        throw new Error(
          'Dropbox selection is unavailable. Use device upload for now.',
        )
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script')
        script.id = 'dropboxjs'
        script.src = 'https://www.dropbox.com/static/api/2/dropins.js'
        script.dataset.appKey = config.appKey
        script.onload = () => resolve()
        script.onerror = () => {
          script.remove()
          reject(new Error('Dropbox could not load. Try reopening the editor.'))
        }
        document.head.append(script)
      })
    })().catch((e) => {
      loading = undefined
      throw e
    })
  await loading
}
export function DropboxArtworkImport({
  productId,
  disabled,
  updated,
  onBusy,
  onImported,
}: {
  productId: string
  disabled: boolean
  updated: boolean
  onBusy(value: boolean): void
  onImported(result: { asset: Item; workspace: Workspace }): void
}) {
  const [ready, setReady] = useState(false),
    [message, setMessage] = useState('Loading Dropbox selection…')
  const [phase, setPhase] = useState('idle'),
    [selection, setSelection] = useState<Selection>()
  const [preview, setPreview] = useState<Preview>(),
    [approved, setApproved] = useState(false)
  const [dark, setDark] = useState(true),
    [progress, setProgress] = useState<number>()
  const [diagnostics, setDiagnostics] = useState<PreviewDiagnostics>()
  const [reviewedLight, setReviewedLight] = useState(false)
  const [reviewedDark, setReviewedDark] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    let live = true
    void loadChooser()
      .then(() => {
        if (live) {
          setReady(true)
          setMessage('')
        }
      })
      .catch((e) => {
        if (live) setMessage(e.message)
      })
    return () => {
      live = false
      abort.current?.abort()
    }
  }, [])
  function cancel() {
    generation.current++
    abort.current?.abort()
    setPhase('idle')
    setPreview(undefined)
    setSelection(undefined)
    setApproved(false)
    setMessage('Selection cancelled. Your existing artwork is unchanged.')
    onBusy(false)
  }
  async function prepare(file: Selection) {
    setSelection({ id: file.id, name: file.name, bytes: file.bytes })
    setDiagnostics(undefined)
    setDark(true)
    setReviewedLight(false)
    setReviewedDark(false)
    setPhase('preparing')
    setPreview(undefined)
    setApproved(false)
    const controller = new AbortController()
    abort.current = controller
    try {
      const r = await fetch('/api/workspace?dropboxPreview=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          selection: { id: file.id, name: file.name, bytes: file.bytes },
          thumbnailLink: file.thumbnailLink,
        }),
        signal: controller.signal,
      })
      const result = await r.json()
      setDiagnostics(result.diagnostics)
      if (!r.ok)
        throw new Error(
          result.error ||
            'Preview unavailable. Upload a smaller transparent copy from your device.',
        )
      if (!controller.signal.aborted) {
        setPreview(result)
        setPhase('review')
        setMessage('Review artwork')
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setMessage(e instanceof Error ? e.message : 'Import failed—try again.')
        setPhase('idle')
        onBusy(false)
      }
    }
  }
  function choose() {
    if (!window.Dropbox?.isBrowserSupported()) {
      setMessage(
        'Dropbox selection is unavailable in this browser. Use device upload.',
      )
      return
    }
    const attempt = ++generation.current
    setMessage('Choosing artwork')
    setPhase('choosing')
    onBusy(true)
    try {
      window.Dropbox.choose({
        linkType: 'preview',
        multiselect: false,
        folderselect: false,
        extensions: ['.png', '.jpg', '.jpeg', '.webp'],
        success: (files) => {
          if (attempt !== generation.current) return
          if (files[0]) void prepare(files[0])
          else cancel()
        },
        cancel: () => {
          if (attempt === generation.current) cancel()
        },
      })
    } catch {
      cancel()
      setMessage('Dropbox selection failed. Try again or use device upload.')
    }
  }
  async function save() {
    if (!preview || !selection || !approved || !reviewedLight || !reviewedDark)
      return
    setDiagnostics((d) => (d ? { ...d, stage: 'private storage/save' } : d))
    setPhase('saving')
    setMessage('Saving mockup copy')
    setProgress(undefined)
    try {
      const blob = await (
        await fetch(`data:image/png;base64,${preview.data}`)
      ).blob()
      const form = new FormData()
      form.set(
        'file',
        new File(
          [blob],
          selection.name.replace(/\.[^.]+$/, '') + '-mockup.png',
          { type: 'image/png' },
        ),
      )
      form.set('collection', 'Product mockups')
      form.set('category', 'mockup artwork')
      form.set('dropboxImport', JSON.stringify({ productId, selection }))
      const result = await new Promise<{ asset: Item; workspace: Workspace }>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('POST', '/api/workspace?upload=1')
          xhr.timeout = 60000
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable)
              setProgress(Math.floor((e.loaded / e.total) * 100))
          }
          xhr.onerror = xhr.ontimeout = () =>
            reject(
              new Error('Import interrupted. Retry saving this reviewed copy.'),
            )
          xhr.onload = () => {
            try {
              const data = JSON.parse(xhr.responseText)
              if (xhr.status >= 200 && xhr.status < 300 && data.asset)
                resolve(data)
              else reject(new Error(data.error || 'Import failed—try again.'))
            } catch {
              reject(new Error('Import failed—try again.'))
            }
          }
          xhr.send(form)
        },
      )
      onImported(result)
      setPhase('idle')
      setPreview(undefined)
      setApproved(false)
      setMessage('Ready to edit. The mockup copy is saved privately.')
      onBusy(false)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Import failed—try again.')
      setPhase('review')
    }
  }
  const active = phase !== 'idle'
  return (
    <section className="dropbox-import" aria-label="Dropbox artwork import">
      <h4>Artwork from Dropbox · optional</h4>
      <p>
        Your original stays in Dropbox. Cottage Pantry saves an optimized copy
        for mockups. Selecting a file can create a shareable Dropbox link;
        selected source links are not guaranteed to expire.
      </p>
      <p className="form-hint">
        PNG, JPG and WebP sources. Preview availability depends on Dropbox.
        Saved copy: PNG, up to 3 MB and 2048 × 2048 pixels. This is not a
        full-resolution or print-ready import.
      </p>
      <button
        type="button"
        className="btn secondary"
        disabled={!ready || disabled || active}
        onClick={choose}
      >
        {updated ? 'Import updated copy from Dropbox' : 'Choose from Dropbox'}
      </button>
      {selection && (
        <p>
          {selection.name} · source size{' '}
          {(selection.bytes / 1_000_000).toFixed(2)} MB (reported by Dropbox).
          Original pixel dimensions unavailable.
        </p>
      )}
      <p role="status">
        {phase === 'preparing' ? 'Preparing preview…' : message}
      </p>
      {diagnostics && (
        <p role="status">
          Preview stage: {diagnostics.stage} · HTTP status:{' '}
          {diagnostics.httpStatus ?? 'unavailable'} · Retrieved bytes:{' '}
          {diagnostics.retrievedBytes ?? 'unavailable'} · Decoded preview:{' '}
          {diagnostics.width && diagnostics.height
            ? `${diagnostics.width} × ${diagnostics.height}`
            : 'unavailable'}{' '}
          · Prepared-copy bytes: {diagnostics.preparedBytes ?? 'unavailable'} ·
          Preparation time: {diagnostics.preparationMs} ms
        </p>
      )}
      {preview && (
        <div className="dropbox-review">
          <h4>Review artwork</h4>
          <button
            type="button"
            className="btn secondary"
            disabled={phase === 'saving'}
            onClick={() => {
              setDark(!dark)
              setApproved(false)
            }}
          >
            Use {dark ? 'light' : 'dark'} review background
          </button>
          <div
            className="dropbox-image"
            style={{ background: dark ? '#282d29' : '#faf8f2' }}
          >
            <img
              src={`data:image/png;base64,${preview.data}`}
              alt="Optimized artwork for approval"
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={dark ? reviewedDark : reviewedLight}
              disabled={phase === 'saving'}
              onChange={(e) => {
                if (dark) setReviewedDark(e.target.checked)
                else setReviewedLight(e.target.checked)
                setApproved(false)
              }}
            />
            I reviewed transparency and detail on this {dark ? 'dark' : 'light'}{' '}
            background.
          </label>
          <p>
            {preview.width} × {preview.height} pixels ·{' '}
            {(preview.bytes / 1_000_000).toFixed(2)} MB · PNG ·{' '}
            {preview.hasAlpha ? 'Alpha channel present' : 'No alpha channel'}
          </p>
          <p>
            Check white artwork, transparency, color, aspect ratio and small
            text on both backgrounds. A preview cannot restore detail or
            transparency lost by Dropbox. Enlarging an export cannot restore
            detail missing from this copy.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={approved}
              disabled={phase === 'saving' || !reviewedLight || !reviewedDark}
              onChange={(e) => setApproved(e.target.checked)}
            />
            I approve this copy for mockups.
          </label>
          <button
            type="button"
            className="btn"
            disabled={
              !approved || !reviewedLight || !reviewedDark || phase === 'saving'
            }
            onClick={() => void save()}
          >
            Save mockup copy
          </button>
        </div>
      )}
      {phase === 'saving' && (
        <p role="status">
          {progress === undefined
            ? 'Saving mockup copy…'
            : progress < 100
              ? `Uploading copy: ${progress}%`
              : 'Copy uploaded. Waiting for private save…'}{' '}
          Keep this editor open; a failed save can be retried safely.
        </p>
      )}
      {active && phase !== 'saving' && (
        <button type="button" className="btn secondary" onClick={cancel}>
          Cancel Dropbox import
        </button>
      )}
      {updated && (
        <p className="form-hint">
          An updated import creates a reviewed copy. Previously saved mockups
          keep their existing artwork.
        </p>
      )}
    </section>
  )
}
