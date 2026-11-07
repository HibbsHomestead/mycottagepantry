import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import type { Item } from '@/lib/domain'
import {
  defaultShelfMedia,
  shelfLines,
  shelfLayout,
  validateShelfMedia,
  type ShelfMedia,
  type ShelfFields,
} from '@/lib/shelf-labels'
import { internalItemCode } from '@/lib/barcodes'
import { downloadLabel } from '@/lib/label-client-export'
import './inventory-tools.css'

export function ShelfLabels({
  items,
  initialLocationOnly = false,
  profiles,
  onSave,
  onClose,
}: {
  items: Item[]
  initialLocationOnly?: boolean
  profiles: ShelfMedia[]
  onSave: (profile: ShelfMedia) => Promise<void>
  onClose: () => void
}) {
  const [media, setMedia] = useState(defaultShelfMedia),
    [fields, setFields] = useState<ShelfFields>({
      location: true,
      reorder: false,
      sku: false,
      barcode: false,
      qr: false,
      text: '',
    }),
    [copies, setCopies] = useState(1),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [graphicsPending, setGraphicsPending] = useState(false),
    [graphics, setGraphics] = useState<Record<string, string>>({}),
    [measuredClipped, setMeasuredClipped] = useState(false)
  const preview = useRef<HTMLDivElement>(null)
  const [locationOnly, setLocationOnly] = useState(initialLocationOnly),
    [location, setLocation] = useState('')
  const locations = [
    ...new Set(items.map((i) => i.storageLocation).filter(Boolean)),
  ] as string[]
  const labels = locationOnly ? [{ id: 'location', name: location }] : items
  useEffect(() => {
    let cancelled = false
    setGraphicsPending(true)
    setGraphics({})
    void (async () => {
      const next: Record<string, string> = {}
      for (const item of items) {
        if (fields.qr) {
          const QR = await import('qrcode')
          next[item.id] = await QR.toDataURL(internalItemCode(item.id), {
            margin: 4,
            width: 240,
            errorCorrectionLevel: 'M',
          })
        } else if (fields.barcode && item.barcode) {
          const bwip = await import('bwip-js/browser')
          const canvas = document.createElement('canvas')
          bwip.toCanvas(canvas, {
            bcid: 'code128',
            text: String(item.barcode),
            scale: 3,
            height: 10,
            padding: 10,
          })
          next[item.id] = canvas.toDataURL('image/png')
        }
      }
      if (!cancelled) setGraphics(next)
    })()
      .catch(() => {
        if (!cancelled)
          setError(
            'This barcode could not be rendered. Keep the stored code as text or use an internal QR.',
          )
      })
      .finally(() => {
        if (!cancelled) setGraphicsPending(false)
      })
    return () => {
      cancelled = true
    }
  }, [items, fields.qr, fields.barcode])
  function update(key: keyof ShelfMedia, value: any) {
    setMedia((old) => ({ ...old, [key]: value }))
    setConfirmed(false)
  }
  let valid = true
  try {
    validateShelfMedia(media)
  } catch {
    valid = false
  }
  const layouts = valid
    ? labels.map((i) =>
        shelfLayout(
          shelfLines(i, fields),
          media,
          !locationOnly && !!graphics[i.id],
        ),
      )
    : []
  useEffect(() => {
    if (!preview.current || !valid) return
    const width =
      media.rotation === 90
        ? media.height - 2 * media.marginY
        : media.width - 2 * media.marginX
    setMeasuredClipped(
      Array.from(preview.current.querySelectorAll('text')).some(
        (text) =>
          typeof text.getComputedTextLength === 'function' &&
          text.getComputedTextLength() > width + 0.05,
      ),
    )
  }, [media, fields, items, locationOnly, location, graphics, valid])
  const missingGraphic =
    !locationOnly &&
    items.some(
      (i) => (fields.qr || (fields.barcode && i.barcode)) && !graphics[i.id],
    )
  async function exportFiles(pdf: boolean) {
    setError('')
    setBusy(true)
    try {
      validateShelfMedia(media)
      if (!confirmed || !labels.length || (locationOnly && !location))
        throw new Error('Confirm the actual media and printable area first.')
      const svgs = Array.from(preview.current!.querySelectorAll(':scope > svg'))
      const rendered: Uint8Array[] = []
      for (const svg of svgs) {
        const url = URL.createObjectURL(
          new Blob([new XMLSerializer().serializeToString(svg)], {
            type: 'image/svg+xml',
          }),
        )
        try {
          const image = new Image()
          await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve()
            image.onerror = () =>
              reject(new Error('Label image export failed.'))
            image.src = url
          })
          const canvas = document.createElement('canvas')
          canvas.width = Math.round((media.width / 25.4) * media.dpi)
          canvas.height = Math.round((media.height / 25.4) * media.dpi)
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = 'white'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (b) => (b ? resolve(b) : reject(new Error('PNG export failed.'))),
              'image/png',
            ),
          )
          rendered.push(new Uint8Array(await blob.arrayBuffer()))
        } finally {
          URL.revokeObjectURL(url)
        }
      }
      if (pdf) {
        const { PDFDocument } = await import('pdf-lib')
        const doc = await PDFDocument.create()
        for (const bytes of rendered) {
          const image = await doc.embedPng(bytes)
          for (let n = 0; n < copies; n++) {
            const page = doc.addPage([
              (media.width / 25.4) * 72,
              (media.height / 25.4) * 72,
            ])
            page.drawImage(image, {
              x: 0,
              y: 0,
              width: page.getWidth(),
              height: page.getHeight(),
            })
          }
        }
        downloadLabel(
          await doc.save(),
          'shelf-bin-labels.pdf',
          'application/pdf',
        )
      } else {
        if (rendered.length !== 1)
          throw new Error(
            'Select one label for PNG export. Use PDF for multiple labels.',
          )
        downloadLabel(rendered[0], 'shelf-bin-label.png', 'image/png')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="inventory-tool-dialog">
        <DialogTitle>Shelf / bin / location labels</DialogTitle>
        <DialogDescription>
          Separate from product/package labels. Exporting does not change stock
          or prices. Printer connection and physical output are not verified.
        </DialogDescription>
        <div className="shelf-label-layout">
          <div>
            <label className="field">
              Saved media profile
              <select
                value={media.id}
                onChange={(e) => {
                  setMedia(
                    profiles.find((p) => p.id === e.target.value) ||
                      defaultShelfMedia,
                  )
                  setConfirmed(false)
                }}
              >
                <option value="">Custom media</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Profile name
              <input
                value={media.name}
                onChange={(e) => update('name', e.target.value)}
              />
            </label>
            <label className="field">
              Media type
              <select
                value={media.kind}
                onChange={(e) => update('kind', e.target.value)}
              >
                <option value="tape">Continuous tape (chosen length)</option>
                <option value="fixed">Fixed-size label</option>
              </select>
            </label>
            <div className="form-grid">
              {(
                [
                  'width',
                  'height',
                  'marginX',
                  'marginY',
                  'dpi',
                  'fontSize',
                ] as const
              ).map((key) => (
                <label className="field" key={key}>
                  {
                    {
                      width: 'Media width (mm)',
                      height: 'Media height / length (mm)',
                      marginX: 'Left & right margin (mm)',
                      marginY: 'Top & bottom margin (mm)',
                      dpi: 'Export resolution (dpi)',
                      fontSize: 'Font size (pt)',
                    }[key]
                  }
                  <input
                    type="number"
                    step="any"
                    value={media[key]}
                    onChange={(e) => update(key, Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
            <label className="field">
              Orientation
              <select
                value={media.rotation}
                onChange={(e) => update('rotation', Number(e.target.value))}
              >
                <option value="0">0°</option>
                <option value="90">90°</option>
              </select>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={media.singleLine}
                onChange={(e) => update('singleLine', e.target.checked)}
              />
              Single-line layout (otherwise wraps)
            </label>
            <button
              className="btn secondary"
              disabled={busy || !valid}
              onClick={async () => {
                setBusy(true)
                setError('')
                try {
                  const p = validateShelfMedia({
                    ...media,
                    id: media.id || crypto.randomUUID(),
                  })
                  await onSave(p)
                  setMedia(p)
                } catch (e) {
                  setError((e as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            >
              Save media profile
            </button>
            <p className="muted">
              Example dimensions are editable, not MakeID E1 specifications. Use
              the media’s documented printable area; tape width alone is
              insufficient.
            </p>
            {!!locations.length && (
              <>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={locationOnly}
                    onChange={(e) => setLocationOnly(e.target.checked)}
                  />
                  Location-only label
                </label>
                {locationOnly && (
                  <label className="field">
                    Storage location
                    <select
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    >
                      <option value="">Choose location</option>
                      {locations.map((l) => (
                        <option key={l}>{l}</option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {!locationOnly &&
              (['location', 'reorder', 'sku', 'barcode', 'qr'] as const).map(
                (key) => (
                  <label key={key} className="check-label">
                    <input
                      type="checkbox"
                      checked={fields[key]}
                      onChange={(e) =>
                        setFields((f) => ({
                          ...f,
                          [key]: e.target.checked,
                          ...(key === 'qr' && e.target.checked
                            ? { barcode: false }
                            : key === 'barcode' && e.target.checked
                              ? { qr: false }
                              : {}),
                        }))
                      }
                    />
                    {
                      {
                        location: 'Storage location',
                        reorder: 'Reorder threshold and unit',
                        sku: 'Internal SKU (when recorded)',
                        barcode: 'Existing barcode (Code 128 rendering)',
                        qr: 'Internal QR (oven access required)',
                      }[key]
                    }
                  </label>
                ),
              )}
            <label className="field">
              Custom short text
              <input
                maxLength={160}
                value={fields.text}
                onChange={(e) =>
                  setFields((f) => ({ ...f, text: e.target.value }))
                }
              />
            </label>
            <label className="field">
              Copies per label (PDF)
              <input
                type="number"
                min="1"
                max="50"
                value={copies}
                onChange={(e) =>
                  setCopies(
                    Math.max(
                      1,
                      Math.min(50, Math.floor(Number(e.target.value) || 1)),
                    ),
                  )
                }
              />
            </label>
          </div>
          <div>
            <p>
              <strong>Physical size:</strong> {media.width} × {media.height} mm
            </p>
            <p>
              Printable area: {Math.max(0, media.width - 2 * media.marginX)} ×{' '}
              {Math.max(0, media.height - 2 * media.marginY)} mm. Screen preview
              is scaled.
            </p>
            <div className="shelf-label-preview" ref={preview}>
              {valid &&
                labels.map((item, index) => {
                  const l = layouts[index]
                  return (
                    <svg
                      key={item.id}
                      xmlns="http://www.w3.org/2000/svg"
                      width={`${media.width}mm`}
                      height={`${media.height}mm`}
                      viewBox={`0 0 ${media.width} ${media.height}`}
                      role="img"
                      aria-label={`Shelf label for ${item.name}`}
                    >
                      <rect
                        width={media.width}
                        height={media.height}
                        fill="white"
                      />
                      <svg
                        x={media.marginX}
                        y={media.marginY}
                        width={media.width - 2 * media.marginX}
                        height={media.height - 2 * media.marginY}
                        overflow="hidden"
                      >
                        <g
                          transform={
                            media.rotation === 90
                              ? `translate(${media.width - 2 * media.marginX},0) rotate(90)`
                              : undefined
                          }
                        >
                          {l.lines.map((line, n) => (
                            <text
                              key={n}
                              x="0"
                              y={(n + 0.9) * l.lineHeight}
                              fontSize={l.size}
                              fontFamily="Arial, sans-serif"
                              fill="#161616"
                            >
                              {line}
                            </text>
                          ))}
                          {!locationOnly && graphics[item.id] && (
                            <image
                              href={graphics[item.id]}
                              x="0"
                              y={l.textHeight}
                              width={l.width}
                              height={l.graphicHeight}
                              preserveAspectRatio="xMinYMid meet"
                            />
                          )}
                        </g>
                      </svg>
                    </svg>
                  )
                })}
            </div>
            {(!valid ||
              measuredClipped ||
              layouts.some((l) => l.clipped || l.small)) && (
              <p role="alert" className="warning-text">
                Text may clip or be too small. Increase media dimensions, reduce
                content, or adjust wrapping/font size before export.
              </p>
            )}
            <p className="muted">
              Barcodes and QR codes need a physical scan test at the chosen
              size. PNG has explicit pixel dimensions at the selected dpi;
              import apps may resize it. PDF preserves millimetre page
              dimensions. No printer job is sent.
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I checked media size, supported margins and preview for this
              printer.
            </label>
            {error && (
              <p role="alert" className="warning-text">
                {error}
              </p>
            )}
            <div className="inventory-tool-actions">
              <button
                className="btn"
                disabled={
                  busy ||
                  graphicsPending ||
                  missingGraphic ||
                  !confirmed ||
                  !valid ||
                  measuredClipped ||
                  layouts.some((l) => l.clipped)
                }
                onClick={() => void exportFiles(true)}
              >
                Export actual-size PDF
              </button>
              <button
                className="btn secondary"
                disabled={
                  busy ||
                  graphicsPending ||
                  missingGraphic ||
                  !confirmed ||
                  !valid ||
                  labels.length !== 1 ||
                  measuredClipped ||
                  layouts.some((l) => l.clipped)
                }
                onClick={() => void exportFiles(false)}
              >
                Export PNG
              </button>
              <button className="btn secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
