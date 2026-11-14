import { useState, type ReactNode } from 'react'
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  Bold,
  Italic,
  Underline,
  ArrowDownUp,
  WholeWord,
  RotateCcw,
  BringToFront,
  SendToBack,
} from 'lucide-react'
import type { LabelElement } from '@/lib/label-studio'
import { rotateAboutCenter } from '@/lib/label-transform'

/** Keep incomplete numeric entry local; only valid values reach the document. */
function CompactNumber({
  label,
  shortLabel,
  value,
  onChange,
  min = 0,
  max = 1000,
  unit,
  icon,
}: {
  label: string
  shortLabel?: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  unit?: string
  icon?: ReactNode
}) {
  const [draft, setDraft] = useState({ value, text: String(value) })
  return (
    <label className="studio-compact-number" title={label}>
      <span aria-hidden="true">{icon || shortLabel}</span>
      <input
        aria-label={label}
        type="number"
        step="any"
        min={min}
        max={max}
        value={draft.value === value ? draft.text : String(value)}
        onChange={(event) => {
          const next = event.target.valueAsNumber
          const valid = Number.isFinite(next) && next >= min && next <= max
          setDraft({ value: valid ? next : value, text: event.target.value })
          if (valid) onChange(next)
        }}
        onBlur={() => setDraft({ value, text: String(value) })}
      />
      {unit && (
        <span className="studio-control-unit" aria-hidden="true">
          {unit}
        </span>
      )}
    </label>
  )
}

export function StudioToolButton({
  label,
  children,
  active,
  disabled,
  onClick,
}: {
  label: string
  children: ReactNode
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="studio-tool-button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function LabelTextToolbar({
  element,
  fontPicker,
  colorPicker,
  supportsBold,
  onPatch,
}: {
  element: LabelElement
  fontPicker: ReactNode
  colorPicker: ReactNode
  supportsBold: boolean
  onPatch: (patch: Partial<LabelElement>) => void
}) {
  const isText = element.type === 'text'
  return (
    <fieldset
      className="studio-property-toolbar studio-text-toolbar"
      aria-label="Text formatting"
      disabled={!isText || element.locked}
    >
      <legend className="sr-only">Text formatting</legend>
      <div className="studio-font-row">
        {fontPicker}
        <CompactNumber
          label="Size (pt)"
          unit="pt"
          value={element.fontSize}
          min={1}
          max={300}
          onChange={(fontSize) => onPatch({ fontSize })}
        />
      </div>
      <div className="studio-tool-row">
        <div className="studio-tool-group" role="group" aria-label="Text style">
          <StudioToolButton
            label={
              supportsBold ? 'Bold' : 'Bold (this font has one print weight)'
            }
            active={isText && element.bold}
            disabled={!supportsBold}
            onClick={() => onPatch({ bold: !element.bold })}
          >
            <Bold size={16} />
          </StudioToolButton>
          <StudioToolButton
            label="Italic"
            active={isText && element.italic}
            onClick={() => onPatch({ italic: !element.italic })}
          >
            <Italic size={16} />
          </StudioToolButton>
          <StudioToolButton
            label="Underline"
            active={isText && element.underline}
            onClick={() => onPatch({ underline: !element.underline })}
          >
            <Underline size={16} />
          </StudioToolButton>
        </div>
        <label
          className="studio-case-control"
          title={`Text case: ${element.textCase}`}
          data-active={isText && element.textCase !== 'none'}
        >
          <span aria-hidden="true">Aa</span>
          <select
            aria-label="Text case"
            value={element.textCase}
            onChange={(e) =>
              onPatch({ textCase: e.target.value as LabelElement['textCase'] })
            }
          >
            <option value="none">Original case</option>
            <option value="upper">UPPERCASE</option>
            <option value="lower">lowercase</option>
            <option value="title">Title Case</option>
          </select>
        </label>
        {colorPicker}
      </div>
      <div className="studio-tool-row">
        <div
          className="studio-tool-group"
          role="group"
          aria-label="Horizontal alignment"
        >
          {(
            [
              ['left', 'Align left', AlignLeft],
              ['center', 'Align center', AlignCenter],
              ['right', 'Align right', AlignRight],
            ] as const
          ).map(([align, label, Icon]) => (
            <StudioToolButton
              key={align}
              label={label}
              active={isText && element.align === align}
              onClick={() => onPatch({ align })}
            >
              <Icon size={16} />
            </StudioToolButton>
          ))}
        </div>
        <div
          className="studio-tool-group"
          role="group"
          aria-label="Vertical alignment"
        >
          {(
            [
              ['top', 'Align top', AlignVerticalJustifyStart],
              ['middle', 'Align middle', AlignVerticalJustifyCenter],
              ['bottom', 'Align bottom', AlignVerticalJustifyEnd],
            ] as const
          ).map(([vertical, label, Icon]) => (
            <StudioToolButton
              key={vertical}
              label={label}
              active={isText && element.vertical === vertical}
              onClick={() => onPatch({ vertical })}
            >
              <Icon size={16} />
            </StudioToolButton>
          ))}
        </div>
      </div>
      <div className="studio-numeric-row">
        <CompactNumber
          label="Line height"
          icon={<ArrowDownUp size={16} />}
          value={element.lineHeight}
          min={0.5}
          max={4}
          onChange={(lineHeight) => onPatch({ lineHeight })}
        />
        <CompactNumber
          label="Letter spacing (pt)"
          icon={<WholeWord size={16} />}
          unit="pt"
          value={element.letterSpacing}
          min={-2}
          max={20}
          onChange={(letterSpacing) => onPatch({ letterSpacing })}
        />
      </div>
    </fieldset>
  )
}

export function LabelGeometryToolbar({
  element,
  onPatch,
  onLayer,
  atFront,
  atBack,
}: {
  element: LabelElement
  onPatch: (patch: Partial<LabelElement>) => void
  onLayer: (layer: 'front' | 'back') => void
  atFront: boolean
  atBack: boolean
}) {
  // Shift the decimal representation for display, avoiding binary multiplication
  // artifacts while leaving the stored opacity untouched until the user edits it.
  const [opacityDigits, opacityExponent = '0'] = String(element.opacity).split(
    'e',
  )
  const opacityPercent = Number(
    `${opacityDigits}e${Number(opacityExponent) + 2}`,
  )
  return (
    <fieldset
      className="studio-property-toolbar studio-geometry-toolbar"
      aria-label="Position, size & layers"
      disabled={element.locked}
    >
      <legend>Position, size &amp; layers</legend>
      <div className="studio-numeric-row">
        <CompactNumber
          label="X (pt)"
          shortLabel="X"
          unit="pt"
          value={element.x}
          min={-1000}
          onChange={(x) => onPatch({ x })}
        />
        <CompactNumber
          label="Y (pt)"
          shortLabel="Y"
          unit="pt"
          value={element.y}
          min={-1000}
          onChange={(y) => onPatch({ y })}
        />
      </div>
      <div className="studio-numeric-row">
        <CompactNumber
          label="Width (pt)"
          shortLabel="W"
          unit="pt"
          value={element.width}
          min={1}
          onChange={(width) => onPatch({ width })}
        />
        <CompactNumber
          label="Height (pt)"
          shortLabel="H"
          unit="pt"
          value={element.height}
          min={1}
          onChange={(height) => onPatch({ height })}
        />
      </div>
      <div className="studio-numeric-row studio-angle-row">
        <CompactNumber
          label="Rotation (°)"
          shortLabel="Angle"
          unit="°"
          value={element.rotation}
          min={-360}
          max={360}
          onChange={(angle) => onPatch(rotateAboutCenter(element, angle))}
        />
        <CompactNumber
          label="Opacity"
          shortLabel="Opacity"
          unit="%"
          value={opacityPercent}
          max={100}
          onChange={(percent) => onPatch({ opacity: percent / 100 })}
        />
      </div>
      <div className="studio-tool-row">
        <StudioToolButton
          label="Reset rotation to 0°"
          disabled={!element.rotation}
          onClick={() => onPatch(rotateAboutCenter(element, 0))}
        >
          <RotateCcw size={16} />
        </StudioToolButton>
        <div
          className="studio-tool-group"
          role="group"
          aria-label="Layer order"
        >
          <StudioToolButton
            label="Bring to front"
            disabled={atFront}
            onClick={() => onLayer('front')}
          >
            <BringToFront size={16} />
          </StudioToolButton>
          <StudioToolButton
            label="Send to back"
            disabled={atBack}
            onClick={() => onLayer('back')}
          >
            <SendToBack size={16} />
          </StudioToolButton>
        </div>
        <span className="studio-layer-caption">Layers</span>
      </div>
    </fieldset>
  )
}
