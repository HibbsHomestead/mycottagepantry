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
  BringToFront,
  SendToBack,
} from 'lucide-react'
import type { LabelElement } from '@/lib/label-studio'
import { alignLabelElements, orderLabelElement } from '@/lib/label-arrange'
import { elementAngle, setElementAngle } from '@/lib/label-transform'

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
  elements,
  width,
  height,
  onElements,
  onSelect,
  aspect,
  onAspect,
}: {
  element: LabelElement
  onPatch: (patch: Partial<LabelElement>) => void
  elements: LabelElement[]
  width: number
  height: number
  onElements: (elements: LabelElement[]) => void
  onSelect: (id: string) => void
  aspect: boolean
  onAspect: (locked: boolean) => void
}) {
  const [tab, setTab] = useState('Arrange')
  const [reference, setReference] = useState('safe')
  const index = elements.findIndex((e) => e.id === element.id)
  const order = (action: 'front' | 'back' | 'forward' | 'backward') =>
    onElements(orderLabelElement(elements, element.id, action))
  return (
    <section className="studio-position-panel" aria-label="Position">
      <h4>Position</h4>
      <div role="tablist" aria-label="Position panels">
        {['Arrange', 'Layers'].map((t) => (
          <button
            type="button"
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Arrange' ? (
        <div role="tabpanel" aria-label="Arrange">
          <fieldset disabled={element.locked}>
            <legend>Layer order</legend>
            <div className="studio-arrange-grid">
              {(
                [
                  ['forward', 'Forward', BringToFront],
                  ['backward', 'Backward', SendToBack],
                  ['front', 'To front', BringToFront],
                  ['back', 'To back', SendToBack],
                ] as const
              ).map(([action, label, Icon]) => (
                <button
                  type="button"
                  key={action}
                  disabled={
                    action === 'front' || action === 'forward'
                      ? index === elements.length - 1
                      : index === 0
                  }
                  onClick={() => order(action)}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset
            disabled={
              element.locked ||
              !!(
                element.groupId &&
                elements.some((e) => e.groupId === element.groupId && e.locked)
              )
            }
          >
            <legend>Align to label</legend>
            <label className="studio-reference-control">
              Alignment reference
              <select
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              >
                <option value="safe">Safe area</option>
                <option value="edges">Label edges</option>
              </select>
            </label>
            <div className="studio-arrange-grid">
              {(
                [
                  ['top', 'Top', AlignVerticalJustifyStart],
                  ['left', 'Left', AlignLeft],
                  ['middle', 'Middle', AlignVerticalJustifyCenter],
                  ['center', 'Center', AlignCenter],
                  ['bottom', 'Bottom', AlignVerticalJustifyEnd],
                  ['right', 'Right', AlignRight],
                ] as const
              ).map(([alignment, label, Icon]) => (
                <button
                  type="button"
                  key={alignment}
                  onClick={() =>
                    onElements(
                      alignLabelElements(
                        elements,
                        element.id,
                        width,
                        height,
                        alignment,
                        reference === 'safe',
                      ),
                    )
                  }
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <details className="studio-position-advanced">
            <summary>Advanced</summary>
            <fieldset disabled={element.locked}>
              <div className="studio-measurements">
                {(['width', 'height', 'x', 'y'] as const).map((key) => (
                  <CompactNumber
                    key={key}
                    label={
                      {
                        width: 'Width',
                        height: 'Height',
                        x: 'X position',
                        y: 'Y position',
                      }[key] + ' (in)'
                    }
                    shortLabel={
                      {
                        width: 'Width',
                        height: 'Height',
                        x: 'X position',
                        y: 'Y position',
                      }[key]
                    }
                    unit="in"
                    value={element[key] / 72}
                    min={key === 'width' || key === 'height' ? 1 / 72 : -1000}
                    onChange={(value) => {
                      const points = value * 72
                      onPatch({
                        [key]: points,
                        ...(aspect && key === 'width'
                          ? {
                              height: (element.height * points) / element.width,
                            }
                          : aspect && key === 'height'
                            ? {
                                width:
                                  (element.width * points) / element.height,
                              }
                            : {}),
                      })
                    }}
                  />
                ))}
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={aspect}
                  onChange={(e) => onAspect(e.target.checked)}
                />
                Lock aspect ratio
              </label>
              <div className="studio-measurements">
                <CompactNumber
                  label="Rotation (°)"
                  shortLabel="Rotation"
                  unit="°"
                  value={elementAngle(element)}
                  min={-360}
                  max={360}
                  onChange={(angle) => onPatch(setElementAngle(element, angle))}
                />
                <CompactNumber
                  label="Opacity"
                  shortLabel="Opacity"
                  unit="%"
                  value={Number((element.opacity * 100).toPrecision(12))}
                  max={100}
                  onChange={(percent) => onPatch({ opacity: percent / 100 })}
                />
              </div>
            </fieldset>
          </details>
        </div>
      ) : (
        <div
          role="tabpanel"
          aria-label="Layers"
          className="studio-position-layers"
        >
          {[...elements].reverse().map((e) => (
            <div key={e.id} className={e.id === element.id ? 'selected' : ''}>
              <button
                type="button"
                aria-pressed={e.id === element.id}
                onClick={() => onSelect(e.id)}
              >
                {e.binding || e.text || e.type}
              </button>
              <button
                type="button"
                aria-label={
                  (e.locked ? 'Unlock ' : 'Lock ') +
                  (e.binding || e.text || e.type)
                }
                onClick={() =>
                  onElements(
                    elements.map((x) =>
                      x.id === e.id ? { ...x, locked: !x.locked } : x,
                    ),
                  )
                }
              >
                {e.locked ? 'Unlock' : 'Lock'}
              </button>
              <button
                type="button"
                aria-label={
                  (e.hidden ? 'Show ' : 'Hide ') +
                  (e.binding || e.text || e.type)
                }
                onClick={() =>
                  onElements(
                    elements.map((x) =>
                      x.id === e.id ? { ...x, hidden: !x.hidden } : x,
                    ),
                  )
                }
              >
                {e.hidden ? 'Show' : 'Hide'}
              </button>
              <button
                type="button"
                aria-label={'Move forward ' + (e.binding || e.text || e.type)}
                disabled={e.locked || elements.at(-1)?.id === e.id}
                onClick={() =>
                  onElements(orderLabelElement(elements, e.id, 'forward'))
                }
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={'Move backward ' + (e.binding || e.text || e.type)}
                disabled={e.locked || elements[0]?.id === e.id}
                onClick={() =>
                  onElements(orderLabelElement(elements, e.id, 'backward'))
                }
              >
                ↓
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
