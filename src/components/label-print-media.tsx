import { useState, type ReactNode } from 'react'
import { ArrowDown } from 'lucide-react'
import { calibrationMarkup } from '@/lib/label-calibration'
import {
  checkPrinterSize,
  printerDesign,
  printerSize,
  printPlacement,
  printRotations,
  samePrintSize,
  validatePrinterProfile,
  type PrinterProfile,
} from '@/lib/label-printers'
import { FormErrorNotice } from './form-error-notice'

const rotationLabels = {
  0: '0° · No rotation',
  90: '90° · Clockwise',
  180: '180° · Half turn',
  270: '270° · 90° counterclockwise',
}

export function RollArtworkPreview({
  design,
  profile,
  children,
}: {
  design: { width: number; height: number }
  profile?: PrinterProfile
  children: ReactNode
}) {
  if (profile) {
    try {
      checkPrinterSize(design, profile)
    } catch (failure) {
      return <p className="warning-text">{(failure as Error).message}</p>
    }
  }
  const { media, matrix } = printPlacement(design, profile)
  return (
    <figure className="studio-roll-artwork">
      <figcaption>
        Loaded media: {(media.width / 72).toFixed(2)} ×{' '}
        {(media.height / 72).toFixed(2)} in ·{' '}
        {rotationLabels[profile?.rotation ?? 0]}
      </figcaption>
      <span>Leading edge</span>
      <svg
        role="img"
        aria-label="Artwork on loaded media with the leading edge at the top"
        className="studio-roll-artwork-page"
        viewBox={`0 0 ${media.width} ${media.height}`}
        style={{
          width: `min(100%, 520px, ${(420 * media.width) / media.height}px)`,
        }}
      >
        <g transform={`matrix(${matrix.join(' ')})`} aria-hidden="true">
          <svg width={design.width} height={design.height}>
            {children}
          </svg>
        </g>
      </svg>
      <span className="studio-roll-feed">
        <ArrowDown size={16} aria-hidden="true" /> Feed direction
      </span>
    </figure>
  )
}

export function CalibrationPreview({
  profile,
}: {
  profile: PrinterProfile
}) {
  return (
    <figure className="studio-feed-preview">
      <figcaption>Test label preview · leading edge at top</figcaption>
      <div
        role="img"
        aria-label="Calibration label: leading edge at top, feed arrow points down. TOP, BOTTOM, triangle corner marker and measurement guide rotate with the artwork."
        dangerouslySetInnerHTML={{ __html: calibrationMarkup(profile) }}
      />
      <small>
        The arrow shows the feed direction. Measure between the guide ticks
        on the printed label.
      </small>
    </figure>
  )
}

export function LabelPrintMedia({
  design,
  profile,
  onSave,
  onTest,
}: {
  design: { width: number; height: number }
  profile?: PrinterProfile
  onSave?: (profile: PrinterProfile) => Promise<void>
  onTest?: (profile: PrinterProfile) => Promise<void>
}) {
  const initial: PrinterProfile = profile || {
    id: '',
    name: `Browser roll · ${design.width / 72} × ${design.height / 72} in`,
    method: 'browser',
    orientation: 'portrait',
    width: design.width / 72,
    height: design.height / 72,
    unit: 'in',
    offsetX: 0,
    offsetY: 0,
    preferred: false,
    options: { colorType: 'color' },
  }
  const matching = samePrintSize(design, printerDesign(initial))
  const [draft, setDraft] = useState<PrinterProfile>({
    ...initial,
    id: matching ? initial.id : '',
    preferred: matching && initial.preferred,
    designWidth: design.width,
    designHeight: design.height,
    rotation: (matching ? initial.rotation : undefined) ?? 0,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  let invalid = ''
  try {
    if (onSave) validatePrinterProfile(draft)
    else checkPrinterSize(design, initial)
  } catch (failure) {
    invalid = (failure as Error).message
  }
  const media = printerSize(draft)
  const swapped =
    !samePrintSize(media, design) &&
    samePrintSize(media, {
      width: design.height,
      height: design.width,
    })
  const saved = Boolean(
    profile &&
    matching &&
    draft.width === profile.width &&
    draft.height === profile.height &&
    draft.rotation === (profile.rotation ?? 0),
  )
  const testedProfile = onSave ? draft : initial
  async function run(action: () => Promise<void>) {
    setError('')
    setBusy(true)
    try {
      await action()
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <fieldset className="studio-media-setup">
      <legend>Roll / single-label media</legend>
      <p>
        Label design size: {(design.width / 72).toFixed(2)} ×{' '}
        {(design.height / 72).toFixed(2)} in
      </p>
      {onSave ? (
        <div className="studio-two">
          <label className="studio-field">
            <span>Across printhead ({draft.unit})</span>
            <input
              type="number"
              step="any"
              value={draft.width || ''}
              onChange={(event) =>
                setDraft({ ...draft, width: Number(event.target.value) })
              }
            />
          </label>
          <label className="studio-field">
            <span>Feed length ({draft.unit})</span>
            <input
              type="number"
              step="any"
              value={draft.height || ''}
              onChange={(event) =>
                setDraft({ ...draft, height: Number(event.target.value) })
              }
            />
          </label>
          <label className="studio-field">
            <span>Output rotation</span>
            <select
              value={draft.rotation}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  rotation: Number(
                    event.target.value,
                  ) as PrinterProfile['rotation'],
                })
              }
            >
              {printRotations.map((rotation) => (
                <option key={rotation} value={rotation}>
                  {rotationLabels[rotation]}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <p>
          Loaded media: {initial.width} × {initial.height} {initial.unit}{' '}
          (across × feed) · {rotationLabels[initial.rotation ?? 0]}. Edit in
          Label Studio.
        </p>
      )}
      {onSave && swapped && (
        <p className="studio-small-note">
          The dimensions are swapped. Choose a quarter turn: 90° clockwise
          or 270° counterclockwise.
        </p>
      )}
      {invalid ? (
        <p className="warning-text">{invalid}</p>
      ) : (
        <CalibrationPreview profile={testedProfile} />
      )}
      {onSave && !saved && (
        <p className="studio-small-note">
          Changes apply to Print and PDF only after you save and select this
          profile. The label design stays unchanged.
        </p>
      )}
      <FormErrorNotice message={error} />
      {onSave && (
        <div className="button-row">
          <button
            type="button"
            className="btn secondary"
            disabled={busy || Boolean(invalid)}
            onClick={() => void run(() => onSave(draft))}
          >
            {draft.id ? 'Save media settings' : 'Save new print profile'}
          </button>
          {onTest && (
            <button
              type="button"
              className="btn secondary"
              disabled={busy || !saved || Boolean(invalid)}
              onClick={() => void run(() => onTest(profile!))}
            >
              Print one test label
            </button>
          )}
        </div>
      )}
    </fieldset>
  )
}
