import { DropboxArtworkImport } from './dropbox-artwork-import'
import { useEffect, useRef, useState } from 'react'
import type { Item, Workspace } from '@/lib/domain'
import {
  artworkHeight,
  canvasBlob,
  loadMockupImage,
  renderMockup,
  type MockupComposition,
  type Placement,
} from '@/lib/mockup'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import './product-mockup.css'

type Props = {
  productId: string
  assets: Item[]
  canEdit: boolean
  onWorkspace: (w: Workspace) => void
  consolidatedMedia?: boolean
  primaryImageAssetId?: string
  onPrimaryImage?: (id: string) => void
}
const blank = (): MockupComposition => ({
  version: 1,
  baseId: '',
  artworkId: '',
  placement: { x: 0, y: 0, width: 300, rotation: 0 },
  area: { x: 0, y: 0, width: 500, height: 500 },
  panelWidth: 0,
  panelHeight: 0,
  calibrated: false,
})
async function upload(file: File, extra?: unknown) {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    !file.size ||
    file.size > 5000000
  )
    throw new Error('Choose a PNG, JPEG, or WebP under 5 MB.')
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(
      'This image could not be opened. Choose a valid PNG, JPEG, or WebP file.',
    )
  })
  const valid = bitmap.width * bitmap.height <= 40000000
  bitmap.close()
  if (!valid) throw new Error('Choose an image up to 40 megapixels.')
  const form = new FormData()
  form.set('file', file)
  form.set('collection', 'Product mockups')
  if (extra) form.set('mockup', JSON.stringify(extra))
  const response = await fetch('/api/workspace?upload=1', {
    method: 'POST',
    body: form,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.asset)
    throw new Error(
      result.error ||
        'Upload interrupted. Your editor is still open; try again.',
    )
  return result as { asset: Item; workspace: Workspace }
}
export function ProductMockups(props: Props) {
  const [editing, setEditing] = useState<Item | null | undefined>(undefined)
  const saved = props.assets.filter(
    (a) => a.productId === props.productId && a.category === 'product-mockup',
  )
  if (!props.productId)
    return <p>Save this product first to create a linked mockup.</p>
  return (
    <section className="mockup-launch" aria-label="Product mockups">
      <h3>Visual mockups</h3>
      {props.canEdit && (
        <button
          type="button"
          className="btn secondary"
          onClick={() => setEditing(null)}
        >
          Create mockup
        </button>
      )}
      <div className="mockup-saved">
        {saved.map((a) => (
          <div key={a.id}>
            {(!props.consolidatedMedia ||
              a.id !== props.primaryImageAssetId) && (
              <img src={`${a.fileUrl}&imageWidth=128`} alt={a.name} />
            )}
            <span>{a.name}</span>
            {props.canEdit && (
              <>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setEditing(a)}
                >
                  Edit mockup
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setEditing({ ...a, id: '', name: `${a.name} copy` })
                  }
                >
                  Duplicate mockup
                </button>
              </>
            )}
            <a href={a.fileUrl} download={`${a.name}.png`}>
              Download PNG
            </a>
          </div>
        ))}
      </div>
      {saved.some((a) => a.inProductGallery) && (
        <section aria-label="Product gallery">
          <h3>Product gallery</h3>
          <div className="mockup-saved">
            {saved
              .filter((a) => a.inProductGallery)
              .map((a) => (
                <div key={a.id}>
                  <a href={a.fileUrl} target="_blank" rel="noreferrer">
                    {props.consolidatedMedia ? (
                      'Open image'
                    ) : (
                      <img src={`${a.fileUrl}&imageWidth=128`} alt={a.name} />
                    )}
                  </a>
                  <span>{a.name}</span>
                </div>
              ))}
          </div>
        </section>
      )}
      {editing !== undefined && (
        <MockupEditor
          {...props}
          initial={editing}
          close={() => setEditing(undefined)}
        />
      )}
    </section>
  )
}
function MockupEditor({
  assets,
  productId,
  onWorkspace,
  onPrimaryImage,
  initial,
  close,
}: Props & { initial: Item | null; close: () => void }) {
  const [c, setC] = useState<MockupComposition>(() =>
    initial?.mockup ? structuredClone(initial.mockup) : blank(),
  )
  const [history, setHistory] = useState<MockupComposition[]>([]),
    [future, setFuture] = useState<MockupComposition[]>([])
  const [name, setName] = useState(initial?.name || 'New product mockup'),
    [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState('')

  const [gallery, setGallery] = useState(false),
    [primary, setPrimary] = useState(false),
    [confirmPrimary, setConfirmPrimary] = useState(false)
  const [discard, setDiscard] = useState(false),
    [exportWidth, setExportWidth] = useState(1600),
    [background, setBackground] = useState('#ffffff')
  const [crop, setCrop] = useState(false),
    [cropRect, setCropRect] = useState({ x: 0, y: 0, width: 100, height: 100 }),
    [cropPreview, setCropPreview] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{
    x: number
    y: number
    p: Placement
    resize: boolean
    corner: number
    snapshot: MockupComposition
  } | null>(null)
  const baseAsset = assets.find((a) => a.id === c.baseId),
    artAsset = assets.find((a) => a.id === c.artworkId)
  const base = usePrivateBitmap(baseAsset?.fileUrl, setError)
  const art = usePrivateBitmap(artAsset?.fileUrl, setError)
  function change(next: MockupComposition) {
    setHistory((h) => [...h.slice(-49), structuredClone(c)])
    setFuture([])
    setC(next)
    setDirty(true)
  }
  function placement(p: Partial<Placement>) {
    change({ ...c, placement: { ...c.placement, ...p } })
  }
  const height = art ? artworkHeight(c.placement, art.width, art.height) : 0
  const requestClose = () => {
    if (!busy) {
      if (dirty) setDiscard(true)
      else close()
    }
  }
  useEffect(() => {
    if (!dirty) return
    const listener = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  }, [dirty])
  useEffect(() => {
    if (!base || !canvasRef.current) return
    const rendered = renderMockup(
      base,
      art,
      c,
      base.width,
      base.height,
      art?.width || 1,
      art?.height || 1,
      Math.min(base.width, 1200),
    )
    const canvas = canvasRef.current
    canvas.width = rendered.width
    canvas.height = rendered.height
    canvas.getContext('2d')!.drawImage(rendered, 0, 0)
  }, [base, art, c])
  function chooseBase(id: string) {
    const a = assets.find((a) => a.id === id)
    if (!a) return
    change({
      ...c,
      baseId: id,
      calibrated: false,
      area: { x: 0, y: 0, width: a.widthPx, height: a.heightPx },
      placement: {
        x: a.widthPx * 0.3,
        y: a.heightPx * 0.3,
        width: a.widthPx * 0.4,
        rotation: 0,
      },
    })
  }
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    setStatus('')
    try {
      await action()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Something went wrong. Your work is still here.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function source(file: File, role: 'base' | 'art') {
    await run(async () => {
      const result = await upload(file)
      onWorkspace(result.workspace)
      if (role === 'base') {
        const a = result.asset
        change({
          ...c,
          baseId: a.id,
          calibrated: false,
          area: { x: 0, y: 0, width: a.widthPx, height: a.heightPx },
          placement: {
            x: a.widthPx * 0.3,
            y: a.heightPx * 0.3,
            width: a.widthPx * 0.4,
            rotation: 0,
          },
        })
      } else change({ ...c, artworkId: result.asset.id })
    })
  }
  async function render(type = 'image/png', width = exportWidth) {
    if (!base) throw new Error('Choose a blank-item photograph first.')
    if (
      width < 100 ||
      width > 6000 ||
      width * Math.round((width * base.height) / base.width) > 24000000
    )
      throw new Error(
        'Choose 100–6000 pixels and an export under 24 megapixels.',
      )
    return canvasBlob(
      renderMockup(
        base,
        art,
        c,
        base.width,
        base.height,
        art?.width || 1,
        art?.height || 1,
        width,
        type === 'image/jpeg' ? background : undefined,
      ),
      type,
    )
  }
  async function download(type: string) {
    await run(async () => {
      const blob = await render(type)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}.${type === 'image/png' ? 'png' : 'jpg'}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setStatus('Image downloaded without editing guides.')
    })
  }
  async function save(template = false) {
    await run(async () => {
      if (!template && !art) throw new Error('Choose artwork first.')
      if (primary && !confirmPrimary)
        throw new Error('Confirm the primary image change below before saving.')
      const outputWidth = Math.min(
        exportWidth,
        base?.width || 1600,
        2400,
        Math.floor(
          Math.sqrt((24000000 * (base?.width || 1)) / (base?.height || 1)),
        ),
      )
      const savedComposition = template ? { ...c, artworkId: '' } : c
      const blob =
        template && base
          ? await canvasBlob(
              renderMockup(
                base,
                null,
                savedComposition,
                base.width,
                base.height,
                1,
                1,
                outputWidth,
              ),
            )
          : await render('image/png', outputWidth)
      if (blob.size > 5000000)
        throw new Error(
          'The saved preview exceeds 5 MB. Reduce export width and try again. Your originals are preserved.',
        )
      const result = await upload(
        new File([blob], `${name}.png`, { type: 'image/png' }),
        {
          name,
          productId,
          composition: savedComposition,
          template,
          gallery,
          primary,
          confirmPrimary,
          originalId: initial?.id || '',
        },
      )
      onWorkspace(result.workspace)
      if (!template && primary && confirmPrimary)
        onPrimaryImage?.(result.asset.id)
      setDirty(false)
      setStatus(
        template
          ? 'Blank template saved.'
          : 'Mockup saved as a new revision. Original images are preserved.',
      )
    })
  }
  const n = (
    label: string,
    value: number,
    onChange: (n: number) => void,
    step = 1,
  ) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        disabled={busy}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
      />
    </label>
  )
  const low = !!(
    base &&
    art &&
    (c.placement.width * exportWidth) / base.width > art.width
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
    >
      <DialogContent
        className="mockup-editor"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <header>
          <div>
            <DialogTitle>Product mockup</DialogTitle>
            <DialogDescription>
              Mockup preview. Actual placement, size, and colors may vary.
            </DialogDescription>
          </div>
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={requestClose}
          >
            Close
          </button>
        </header>
        <div className="mockup-layout">
          <div className="mockup-preview">
            {base ? (
              <div
                className="mockup-stage"
                style={{
                  aspectRatio: `${base.width}/${base.height}`,
                  width: `min(100%, ${(75 * base.width) / base.height}dvh)`,
                }}
              >
                <canvas
                  ref={canvasRef}
                  aria-label="Live mockup preview. Base image locked."
                />
                <div
                  className="mockup-area"
                  style={{
                    left: `${(c.area.x / base.width) * 100}%`,
                    top: `${(c.area.y / base.height) * 100}%`,
                    width: `${(c.area.width / base.width) * 100}%`,
                    height: `${(c.area.height / base.height) * 100}%`,
                  }}
                />
                {art && (
                  <div
                    tabIndex={0}
                    role="group"
                    aria-label="Artwork placement. Use arrow keys to move; Shift moves ten pixels."
                    className="mockup-layer"
                    style={{
                      left: `${(c.placement.x / base.width) * 100}%`,
                      top: `${(c.placement.y / base.height) * 100}%`,
                      width: `${(c.placement.width / base.width) * 100}%`,
                      height: `${(height / base.height) * 100}%`,
                      transform: `rotate(${c.placement.rotation}deg)`,
                    }}
                    onKeyDown={(e) => {
                      const delta = e.shiftKey ? 10 : 1
                      const moves: Record<string, Partial<Placement>> = {
                        ArrowLeft: { x: c.placement.x - delta },
                        ArrowRight: { x: c.placement.x + delta },
                        ArrowUp: { y: c.placement.y - delta },
                        ArrowDown: { y: c.placement.y + delta },
                      }
                      if (moves[e.key]) {
                        e.preventDefault()
                        placement(moves[e.key])
                      }
                    }}
                    onPointerDown={(e) => {
                      if (busy) return
                      e.preventDefault()
                      e.currentTarget.setPointerCapture(e.pointerId)
                      const corner = Number(
                        (e.target as HTMLElement).dataset.corner ?? -1,
                      )
                      drag.current = {
                        x: e.clientX,
                        y: e.clientY,
                        p: { ...c.placement },
                        resize: corner >= 0,
                        corner,
                        snapshot: structuredClone(c),
                      }
                    }}
                    onPointerMove={(e) => {
                      const d = drag.current
                      if (!d) return
                      const rect =
                        e.currentTarget.parentElement!.getBoundingClientRect()
                      const dx = ((e.clientX - d.x) * base.width) / rect.width,
                        dy = ((e.clientY - d.y) * base.height) / rect.height
                      if (d.resize) {
                        const angle = (d.p.rotation * Math.PI) / 180
                        const local =
                          dx * Math.cos(angle) + dy * Math.sin(angle)
                        const localY =
                          dy * Math.cos(angle) - dx * Math.sin(angle)
                        const ratio = art.height / art.width
                        const sx = d.corner === 0 || d.corner === 3 ? -1 : 1
                        const sy = d.corner < 2 ? -1 : 1
                        const width = Math.max(
                          1,
                          d.p.width +
                            (2 * (sx * local + sy * localY * ratio)) /
                              (1 + ratio * ratio),
                        )
                        const h = (width * art.height) / art.width
                        setC({
                          ...c,
                          placement: {
                            ...d.p,
                            width,
                            x: d.p.x + (d.p.width - width) / 2,
                            y:
                              d.p.y +
                              ((d.p.width * art.height) / art.width - h) / 2,
                          },
                        })
                      } else
                        setC({
                          ...c,
                          placement: { ...d.p, x: d.p.x + dx, y: d.p.y + dy },
                        })
                      setDirty(true)
                    }}
                    onPointerUp={() => {
                      if (drag.current) {
                        const snapshot = drag.current.snapshot
                        setHistory((h) => [...h.slice(-49), snapshot])
                        setFuture([])
                        drag.current = null
                      }
                    }}
                    onPointerCancel={() => {
                      if (drag.current) {
                        setC(drag.current.snapshot)
                        drag.current = null
                      }
                    }}
                  >
                    {[0, 1, 2, 3].map((i) => (
                      <span
                        key={i}
                        data-corner={i}
                        className={`mockup-handle corner-${i}`}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="mockup-empty">
                Upload a blank tote or another blank-item photograph to begin.
              </div>
            )}
            <p className="form-hint">
              Base image locked · Normal artwork overlay · Guides stay out of
              exports.
            </p>
          </div>
          <div className="mockup-controls" aria-busy={busy}>
            <label className="field">
              <span>Mockup / template name</span>
              <input
                disabled={busy}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setDirty(true)
                }}
              />
            </label>
            <details open={!base || !art}>
              <summary>Source images & templates</summary>
              <fieldset disabled={busy}>
                <legend>Source images</legend>
                {(['base', 'art'] as const).map((role) => (
                  <div key={role}>
                    <label className="field">
                      <span>
                        {role === 'base' ? 'Blank-item photograph' : 'Artwork'}
                      </span>
                      <select
                        value={role === 'base' ? c.baseId : c.artworkId}
                        onChange={(e) =>
                          role === 'base'
                            ? chooseBase(e.target.value)
                            : change({ ...c, artworkId: e.target.value })
                        }
                      >
                        <option value="">Select uploaded image</option>
                        {assets
                          .filter((a) => a.fileUrl && !a.mockup)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>
                        Upload {role === 'base' ? 'blank image' : 'artwork'}
                      </span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          e.target.value = ''
                          if (f) void source(f, role)
                        }}
                      />
                    </label>
                  </div>
                ))}
                <p className="form-hint">
                  PNG, JPG, WebP · 5 MB · 40 megapixels. Use artwork you own or
                  are licensed to use. White is preserved; artwork without
                  transparency may show a rectangular background.
                </p>
                <label className="field">
                  <span>Reusable blank template</span>
                  <select
                    value=""
                    onChange={(e) => {
                      const a = assets.find((a) => a.id === e.target.value)
                      if (a?.mockup) {
                        change({
                          ...structuredClone(a.mockup),
                          artworkId: c.artworkId,
                        })
                        setName(`${a.name} copy`)
                      }
                    }}
                  >
                    <option value="">Choose and duplicate a template</option>
                    {assets
                      .filter((a) => a.category === 'mockup-template')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                </label>
              </fieldset>
            </details>
            <DropboxArtworkImport
              productId={productId}
              disabled={busy}
              updated={artAsset?.sourceMetadata?.provider === 'dropbox'}
              onBusy={setBusy}
              onImported={(result) => {
                onWorkspace(result.workspace)
                change({ ...c, artworkId: result.asset.id })
              }}
            />
            <fieldset disabled={!art || busy}>
              <legend>Artwork placement · source pixels</legend>
              <div className="mockup-numbers">
                {n('X', c.placement.x, (v) => placement({ x: v }))}
                {n('Y', c.placement.y, (v) => placement({ y: v }))}
                {n('Width', c.placement.width, (v) => {
                  if (v > 0) placement({ width: v })
                })}
                {n('Height', height, (v) => {
                  if (v > 0 && art)
                    placement({ width: (v * art.width) / art.height })
                })}
                {n('Rotation (degrees)', c.placement.rotation, (v) =>
                  placement({ rotation: v }),
                )}
              </div>
              <p className="form-hint">
                Aspect ratio locked. Arrow keys move selected artwork.
              </p>
              {!c.calibrated && (
                <p className="form-hint">Visual placement only.</p>
              )}
              <div className="button-row">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() =>
                    placement({
                      x: c.area.x + (c.area.width - c.placement.width) / 2,
                    })
                  }
                >
                  Center horizontally
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() =>
                    placement({ y: c.area.y + (c.area.height - height) / 2 })
                  }
                >
                  Center vertically
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    if (base)
                      placement({
                        x: base.width * 0.3,
                        y: base.height * 0.3,
                        width: base.width * 0.4,
                        rotation: 0,
                      })
                  }}
                >
                  Reset placement
                </button>
              </div>
            </fieldset>
            <div className="button-row">
              <button
                type="button"
                className="btn secondary"
                disabled={!history.length || busy}
                onClick={() => {
                  setFuture((f) => [c, ...f])
                  setC(history[history.length - 1])
                  setHistory((h) => h.slice(0, -1))
                  setDirty(true)
                }}
              >
                Undo
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={!future.length || busy}
                onClick={() => {
                  setHistory((h) => [...h, c])
                  setC(future[0])
                  setFuture((f) => f.slice(1))
                  setDirty(true)
                }}
              >
                Redo
              </button>
            </div>
            <details>
              <summary>Placement area & physical calibration</summary>
              <p className="form-hint">
                Set the guide to the known printable panel in the photograph.
                This guide is not supplier approval.
              </p>
              <div className="mockup-numbers">
                {(['x', 'y', 'width', 'height'] as const).map((key) => (
                  <div key={key}>
                    {n(`Area ${key}`, c.area[key], (v) => {
                      if ((key === 'width' || key === 'height') && v <= 0)
                        return
                      change({
                        ...c,
                        calibrated: false,
                        area: { ...c.area, [key]: v },
                      })
                    })}
                  </div>
                ))}
                {n(
                  'Panel width (inches)',
                  c.panelWidth,
                  (v) =>
                    change({
                      ...c,
                      panelWidth: Math.max(0, v),
                      calibrated: false,
                    }),
                  0.01,
                )}
                {n(
                  'Panel height (inches)',
                  c.panelHeight,
                  (v) =>
                    change({
                      ...c,
                      panelHeight: Math.max(0, v),
                      calibrated: false,
                    }),
                  0.01,
                )}
              </div>
              <button
                type="button"
                className="btn secondary"
                disabled={busy || !c.panelWidth || !c.panelHeight || !base}
                onClick={() => change({ ...c, calibrated: true })}
              >
                Calibrate selected panel
              </button>
              {c.calibrated ? (
                <div className="mockup-numbers">
                  {n(
                    'Artwork width (inches)',
                    (c.placement.width / c.area.width) * c.panelWidth,
                    (v) => {
                      if (v > 0)
                        placement({ width: (v / c.panelWidth) * c.area.width })
                    },
                    0.01,
                  )}
                  {n(
                    'Artwork height (inches)',
                    (height / c.area.height) * c.panelHeight,
                    (v) => {
                      if (v > 0 && art)
                        placement({
                          width:
                            ((v / c.panelHeight) * c.area.height * art.width) /
                            art.height,
                        })
                    },
                    0.01,
                  )}
                </div>
              ) : null}
            </details>
            <details
              open={crop}
              onToggle={(e) => setCrop(e.currentTarget.open)}
            >
              <summary>Crop one design from a gangsheet</summary>
              <p className="form-hint">
                Select the gangsheet as Artwork. Enter a crop in its source
                pixels and review it. The original stays intact. No automatic
                separation or background removal.
              </p>
              <div className="mockup-numbers">
                {(['x', 'y', 'width', 'height'] as const).map((key) => (
                  <div key={key}>
                    {n(`Crop ${key}`, cropRect[key], (v) => {
                      setCropPreview('')
                      setCropRect({ ...cropRect, [key]: v })
                    })}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn secondary"
                disabled={!art || busy}
                onClick={() => {
                  if (!art) return
                  const r = cropRect
                  if (
                    r.x < 0 ||
                    r.y < 0 ||
                    r.width <= 0 ||
                    r.height <= 0 ||
                    r.x + r.width > art.width ||
                    r.y + r.height > art.height
                  ) {
                    setError('Keep the crop inside the artwork image.')
                    return
                  }
                  const canvas = document.createElement('canvas')
                  canvas.width = r.width
                  canvas.height = r.height
                  canvas
                    .getContext('2d')!
                    .drawImage(
                      art,
                      r.x,
                      r.y,
                      r.width,
                      r.height,
                      0,
                      0,
                      r.width,
                      r.height,
                    )
                  setCropPreview(canvas.toDataURL())
                }}
              >
                Review crop
              </button>
              {cropPreview && (
                <>
                  <img
                    className="mockup-crop"
                    src={cropPreview}
                    alt="Review selected design crop"
                  />
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const blob = await (await fetch(cropPreview)).blob()
                        const result = await upload(
                          new File([blob], 'Gangsheet design crop.png', {
                            type: 'image/png',
                          }),
                        )
                        onWorkspace(result.workspace)
                        change({ ...c, artworkId: result.asset.id })
                        setCropPreview('')
                        setCrop(false)
                      })
                    }
                  >
                    Use reviewed crop
                  </button>
                </>
              )}
            </details>
            <fieldset disabled={busy}>
              <legend>Save & export</legend>
              {n('Export width (pixels)', exportWidth, (v) =>
                setExportWidth(v),
              )}
              <p className="form-hint">
                {base
                  ? `Export: ${exportWidth} × ${Math.round((exportWidth * base.height) / base.width)} pixels. `
                  : ''}
                Maximum 6000 pixels wide and 24 megapixels. PNG/JPG mockup
                image; original artwork stays unchanged.
              </p>
              <label className="field">
                <span>JPG background (required)</span>
                <input
                  type="color"
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                />
              </label>
              {low && (
                <p role="status">
                  Low-resolution artwork: this export enlarges the design.
                  Upscaling does not restore detail.
                </p>
              )}
              {base && exportWidth > base.width && (
                <p className="form-hint">
                  Export enlarges the photograph beyond its original resolution.
                </p>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={gallery}
                  onChange={(e) => {
                    setGallery(e.target.checked)
                    setPrimary(false)
                    setConfirmPrimary(false)
                  }}
                />{' '}
                Save to product gallery
              </label>
              {gallery && (
                <label>
                  <input
                    type="checkbox"
                    checked={primary}
                    onChange={(e) => {
                      setPrimary(e.target.checked)
                      setConfirmPrimary(false)
                    }}
                  />{' '}
                  Set as primary product image
                </label>
              )}
              {primary && (
                <label className="mockup-confirm">
                  <input
                    type="checkbox"
                    checked={confirmPrimary}
                    onChange={(e) => setConfirmPrimary(e.target.checked)}
                  />{' '}
                  I confirm replacing the product’s primary image. The previous
                  image file is retained.
                </label>
              )}
              <div className="button-row">
                <button
                  type="button"
                  className="btn"
                  disabled={!base || !art}
                  onClick={() => void save()}
                >
                  Save mockup
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={!base}
                  onClick={() => void save(true)}
                >
                  Save blank template
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={!base}
                  onClick={() => void download('image/png')}
                >
                  Download PNG
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={!base}
                  onClick={() => void download('image/jpeg')}
                >
                  Download JPG
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={requestClose}
                >
                  Cancel
                </button>
              </div>
            </fieldset>
            <p className="form-hint">
              Visual mockups only. No production, inventory, pricing, or
              financial changes. Nothing is published.
            </p>
            {busy && (
              <p role="status">Processing image… Keep this editor open.</p>
            )}
            {status && <p role="status">{status}</p>}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {discard && (
              <div role="alert" className="mockup-confirm">
                <p>Discard unsaved mockup changes?</p>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setDiscard(false)}
                >
                  Keep editing
                </button>
                <button type="button" className="btn" onClick={close}>
                  Discard changes and close
                </button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function usePrivateBitmap(
  url: string | undefined,
  onError: (s: string) => void,
) {
  const [loaded, setLoaded] = useState<{
    url: string
    bitmap: ImageBitmap
  } | null>(null)
  useEffect(() => {
    if (!url) return
    let dead = false
    let image: ImageBitmap | null = null
    loadMockupImage(url)
      .then((bitmap) => {
        image = bitmap
        if (dead) bitmap.close()
        else setLoaded({ url, bitmap })
      })
      .catch((e) => {
        if (!dead) onError(e.message)
      })
    return () => {
      dead = true
      image?.close()
    }
  }, [url, onError])
  return loaded && loaded.url === url ? loaded.bitmap : null
}
