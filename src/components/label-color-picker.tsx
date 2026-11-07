import { useRef, useState, useEffect } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, Pipette, X } from 'lucide-react'
import {
  clamp,
  parseHex,
  hexRgb,
  rgbHex,
  hexHsl,
  hslHex,
  hexHsv,
  hsvHex,
  type LabelColor,
} from '@/lib/label-colors'
import './label-color-picker.css'
const basics = [
  '#000000',
  '#ffffff',
  '#292630',
  '#666666',
  '#999999',
  '#dddddd',
  '#71315f',
  '#a02956',
  '#c74335',
  '#e38d34',
  '#e7c754',
  '#476b46',
  '#266e6c',
  '#346ba1',
  '#53509a',
  '#78553d',
]
export function LabelColorPicker({
  label,
  value,
  allowNone = false,
  brand = [],
  documentColors = [],
  recent = [],
  canSaveBrand = false,
  onSaveBrand,
  onBegin,
  onPreview,
  onApply,
  onCancel,
}: {
  label: string
  value: LabelColor
  allowNone?: boolean
  brand?: Array<LabelColor & { name?: string }>
  documentColors?: LabelColor[]
  recent?: LabelColor[]
  canSaveBrand?: boolean
  onSaveBrand?: (color: LabelColor, name: string) => Promise<void>
  onBegin: () => void
  onPreview: (v: LabelColor) => void
  onApply: (v: LabelColor) => void
  onCancel: () => void
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(value),
    [hex, setHex] = useState(value.hex),
    [compact, setCompact] = useState(value.hex),
    [mode, setMode] = useState('RGB'),
    [hsv, setHsv] = useState(hexHsv(value.hex)),
    [error, setError] = useState(''),
    [name, setName] = useState(''),
    [saving, setSaving] = useState(false)
  const original = useRef(value),
    applied = useRef(false)
  useEffect(() => {
    if (!open) setCompact(value.hex)
  }, [value.hex, open])
  function update(v: LabelColor, keepHsv = false) {
    setDraft(v)
    setHex(v.hex)
    if (!keepHsv) setHsv(hexHsv(v.hex))
    setError('')
    onPreview(v)
  }
  function begin() {
    original.current = { ...value }
    applied.current = false
    setDraft(value)
    setHex(value.hex)
    setHsv(hexHsv(value.hex))
    setError('')
    onBegin()
    setOpen(true)
  }
  function close() {
    if (!applied.current) onCancel()
    setOpen(false)
  }
  function setHSV(next: typeof hsv) {
    setHsv(next)
    update(
      { hex: hsvHex(next.h, next.s, next.v), opacity: draft.opacity },
      true,
    )
  }
  const preview = (v: LabelColor) => ({
    background:
      v.hex === 'transparent'
        ? 'transparent'
        : `rgba(${hexRgb(v.hex).join(',')},${v.opacity})`,
  })
  const rgb = hexRgb(draft.hex),
    hsl = hexHsl(draft.hex)
  function group(title: string, colors: Array<LabelColor & { name?: string }>) {
    return (
      <section className="picker-swatches">
        <h4>{title}</h4>
        {!colors.length && (
          <small>
            {title === 'Brand colors'
              ? 'Choose a Brand Kit to use its colors.'
              : 'No colors yet.'}
          </small>
        )}
        <div>
          {colors.map((c, i) => (
            <button
              type="button"
              className="checker color-chip"
              key={c.hex + '-' + c.opacity + '-' + i}
              title={`${c.name ? c.name + ' · ' : ''}${c.hex} · ${c.opacity * 100}%`}
              aria-label={`${title}: ${c.name || c.hex} at ${c.opacity * 100}%`}
              aria-pressed={draft.hex === c.hex && draft.opacity === c.opacity}
              onClick={() => update(c)}
            >
              <span style={preview(c)} />
              {draft.hex === c.hex && draft.opacity === c.opacity && (
                <Check size={13} />
              )}
            </button>
          ))}
        </div>
      </section>
    )
  }
  return (
    <div className="color-control">
      <span className="color-control-label">{label}</span>
      <div className="color-compact">
        <Popover.Root
          open={open}
          modal
          onOpenChange={(next) => {
            if (next) begin()
            else close()
          }}
        >
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label={`Choose ${label.toLowerCase()}`}
              title={
                value.hex === 'transparent'
                  ? 'No fill'
                  : `${value.hex} · ${value.opacity * 100}%`
              }
              className={`checker color-trigger ${value.hex === 'transparent' ? 'no-fill' : ''}`}
            >
              <span style={preview(value)} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="label-color-popover"
              side="left"
              align="start"
              sideOffset={12}
              collisionPadding={12}
              aria-label={`${label} color picker`}
              onEscapeKeyDown={() => {}}
            >
              <div className="picker-heading">
                <strong>{label}</strong>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Cancel color change"
                  onClick={close}
                >
                  <X size={18} />
                </button>
              </div>
              <div
                className="saturation-area"
                style={{ backgroundColor: hsvHex(hsv.h, 1, 1) }}
                role="slider"
                tabIndex={0}
                aria-label="Saturation and brightness"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(hsv.s * 100)}
                aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
                onKeyDown={(e) => {
                  if (
                    [
                      'ArrowLeft',
                      'ArrowRight',
                      'ArrowUp',
                      'ArrowDown',
                    ].includes(e.key)
                  ) {
                    e.preventDefault()
                    setHSV({
                      ...hsv,
                      s: clamp(
                        hsv.s +
                          (e.key === 'ArrowRight'
                            ? 0.01
                            : e.key === 'ArrowLeft'
                              ? -0.01
                              : 0),
                      ),
                      v: clamp(
                        hsv.v +
                          (e.key === 'ArrowUp'
                            ? 0.01
                            : e.key === 'ArrowDown'
                              ? -0.01
                              : 0),
                      ),
                    })
                  }
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  const rect = e.currentTarget.getBoundingClientRect()
                  setHSV({
                    ...hsv,
                    s: clamp((e.clientX - rect.left) / rect.width),
                    v: 1 - clamp((e.clientY - rect.top) / rect.height),
                  })
                }}
                onPointerMove={(e) => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  setHSV({
                    ...hsv,
                    s: clamp((e.clientX - rect.left) / rect.width),
                    v: 1 - clamp((e.clientY - rect.top) / rect.height),
                  })
                }}
              >
                <span
                  style={{
                    left: `${hsv.s * 100}%`,
                    top: `${(1 - hsv.v) * 100}%`,
                  }}
                />
              </div>
              <label className="picker-range">
                Hue
                <input
                  aria-label="Hue"
                  type="range"
                  min="0"
                  max="359.9"
                  step="0.1"
                  value={hsv.h}
                  className="hue-slider"
                  onChange={(e) =>
                    setHSV({ ...hsv, h: Number(e.target.value) })
                  }
                />
              </label>
              <label className="picker-range">
                Opacity · {Number((draft.opacity * 100).toFixed(2))}%
                <input
                  aria-label="Color opacity"
                  type="range"
                  min="0"
                  max="100"
                  step="0.1"
                  value={draft.opacity * 100}
                  className="checker"
                  onChange={(e) =>
                    update(
                      { ...draft, opacity: Number(e.target.value) / 100 },
                      true,
                    )
                  }
                />
              </label>
              <div className="picker-inputs">
                <label>
                  HEX
                  <input
                    aria-label="Picker HEX"
                    value={hex}
                    onChange={(e) => {
                      setHex(e.target.value)
                      const parsed = parseHex(e.target.value)
                      if (parsed) {
                        setDraft({ ...draft, hex: parsed })
                        setHsv(hexHsv(parsed))
                        onPreview({ ...draft, hex: parsed })
                        setError('')
                      } else setError('Enter a 3- or 6-digit HEX color.')
                    }}
                  />
                </label>
                <label>
                  Color model
                  <select
                    aria-label="Color model"
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option>RGB</option>
                    <option>HSL</option>
                  </select>
                </label>
              </div>
              <div className="picker-channels">
                {(mode === 'RGB' ? ['R', 'G', 'B'] : ['H', 'S', 'L']).map(
                  (channel, index) => (
                    <label key={channel}>
                      {channel}
                      <input
                        aria-label={`${mode} ${channel}`}
                        type="number"
                        min="0"
                        max={mode === 'RGB' ? 255 : index === 0 ? 359.9 : 100}
                        step="any"
                        value={Number(
                          (mode === 'RGB' ? rgb[index] : hsl[index]).toFixed(2),
                        )}
                        onChange={(e) => {
                          const max =
                            mode === 'RGB' ? 255 : index === 0 ? 359.9 : 100
                          const n = Number(e.target.value)
                          if (
                            e.target.value === '' ||
                            !Number.isFinite(n) ||
                            n < 0 ||
                            n > max
                          ) {
                            setError(`Enter ${channel} between 0 and ${max}.`)
                            return
                          }
                          const channels = [...(mode === 'RGB' ? rgb : hsl)]
                          channels[index] = n
                          update({
                            ...draft,
                            hex:
                              mode === 'RGB'
                                ? rgbHex(
                                    ...(channels as [number, number, number]),
                                  )
                                : hslHex(
                                    ...(channels as [number, number, number]),
                                  ),
                          })
                        }}
                      />
                    </label>
                  ),
                )}
              </div>
              <div className="picker-previews">
                <span>
                  Previous
                  <button
                    type="button"
                    className="checker"
                    aria-label="Use previous color"
                    onClick={() => update(original.current)}
                  >
                    <span style={preview(original.current)} />
                  </button>
                </span>
                <span>
                  Current
                  <span className="checker">
                    <span style={preview(draft)} />
                  </span>
                </span>
                {typeof window !== 'undefined' && 'EyeDropper' in window && (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={async () => {
                      try {
                        const result = await new (
                          window as any
                        ).EyeDropper().open()
                        update({ ...draft, hex: result.sRGBHex })
                      } catch (e) {
                        if ((e as Error).name !== 'AbortError')
                          setError(
                            'Color sampling is unavailable. Enter a color instead.',
                          )
                      }
                    }}
                  >
                    <Pipette size={16} /> Sample screen
                  </button>
                )}
              </div>
              {allowNone && (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => update({ hex: 'transparent', opacity: 1 })}
                >
                  <span className="checker no-fill color-chip" /> No fill
                </button>
              )}
              {group('Brand colors', brand)}
              {group('Colors in this label', documentColors)}
              {group('Recently used', recent)}
              {group(
                'Basic colors',
                basics.map((hex) => ({ hex, opacity: 1 })),
              )}
              <div className="picker-brand-save">
                <label>
                  Name for Brand Kit
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Mulberry ink"
                  />
                </label>
                <button
                  type="button"
                  className="text-button"
                  disabled={
                    !canSaveBrand ||
                    !name.trim() ||
                    draft.hex === 'transparent' ||
                    saving
                  }
                  onClick={async () => {
                    setSaving(true)
                    try {
                      await onSaveBrand?.(draft, name.trim())
                      setName('')
                    } catch (e) {
                      setError((e as Error).message)
                    } finally {
                      setSaving(false)
                    }
                  }}
                >
                  Save to Brand Kit
                </button>
              </div>
              {error && <p role="alert">{error}</p>}
              <div className="picker-actions">
                <button type="button" className="btn secondary" onClick={close}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!!error}
                  onClick={() => {
                    applied.current = true
                    onApply(draft)
                    setOpen(false)
                  }}
                >
                  Apply
                </button>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <input
          aria-label={`${label} HEX`}
          value={compact}
          onChange={(e) => {
            setCompact(e.target.value)
            const hex = parseHex(e.target.value)
            if (hex) onApply({ ...value, hex })
          }}
          onBlur={() => setCompact(value.hex)}
          spellCheck={false}
        />
        <label className="compact-opacity">
          <input
            aria-label={`${label} opacity percent`}
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={Number((value.opacity * 100).toFixed(2))}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (e.target.value !== '' && n >= 0 && n <= 100)
                onApply({ ...value, opacity: n / 100 })
            }}
          />
          %
        </label>
      </div>
    </div>
  )
}
