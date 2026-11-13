import { useId, useRef, useState } from 'react'
import { Camera, MoreHorizontal } from 'lucide-react'
import * as Menu from '@radix-ui/react-dropdown-menu'
import './pantry-cards.css'
import './photo-box.css'

/** Upload controls are siblings: removing a photo never activates the picker. */
export function PhotoBox({
  src,
  alt,
  className = '',
  disabled = false,
  canUpload = true,
  busy = false,
  inputLabel,
  errorId,
  accept = 'image/png,image/jpeg,image/webp',
  onFile,
  onRemove,
  removeLabel = 'Remove photo',
  removeDisabled = disabled || busy,
  choices = [],
  selected = '',
  onSelect,
}: {
  src?: string
  alt: string
  className?: string
  disabled?: boolean
  canUpload?: boolean
  busy?: boolean
  inputLabel?: string
  errorId?: string
  accept?: string
  onFile: (file: File) => void
  onRemove?: () => void
  removeLabel?: string
  removeDisabled?: boolean
  choices?: { id: string; name: string }[]
  selected?: string
  onSelect?: (id: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const pickerButton = useRef<HTMLButtonElement>(null)
  const [failed, setFailed] = useState('')
  const statusId = useId()
  const label = src || selected ? 'Change photo' : 'Add photo'
  return (
    <span className={`pantry-photo photo-box ${className}`} aria-busy={busy}>
      <button
        type="button"
        className="photo-box-picker"
        ref={pickerButton}
        aria-label={label}
        aria-describedby={
          [busy ? statusId : '', errorId].filter(Boolean).join(' ') || undefined
        }
        aria-invalid={!!errorId || undefined}
        disabled={disabled || busy || !canUpload}
        onClick={() => input.current?.click()}
      >
        {src && failed !== src ? (
          <img src={src} alt={alt} onError={() => setFailed(src)} />
        ) : (
          <span className="photo-box-empty">
            <Camera size={24} aria-hidden="true" />
            <span>{label}</span>
          </span>
        )}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        aria-label={inputLabel || label}
        accept={accept}
        disabled={disabled || busy || !canUpload}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) onFile(file)
        }}
      />
      {onSelect && choices.length > 0 && (
        <Menu.Root>
          <Menu.Trigger asChild>
            <button
              type="button"
              className="photo-box-options"
              aria-label="Photo options"
              title="Photo options"
              disabled={disabled || busy}
            >
              <MoreHorizontal size={18} aria-hidden="true" />
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content className="photo-box-menu" sideOffset={5} align="end">
              <Menu.Label className="photo-box-menu-label">
                Choose a saved photo
              </Menu.Label>
              <Menu.RadioGroup value={selected} onValueChange={onSelect}>
                {choices.map((choice) => (
                  <Menu.RadioItem key={choice.id} value={choice.id}>
                    {choice.name}
                    <Menu.ItemIndicator aria-hidden="true">
                      {' '}
                      ✓
                    </Menu.ItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      )}
      {(src || selected) && onRemove && (
        <button
          type="button"
          className="photo-box-remove"
          disabled={removeDisabled}
          onClick={() => {
            onRemove()
            // The Remove button disappears; keep keyboard users at the photo.
            pickerButton.current?.focus()
          }}
        >
          {removeLabel}
        </button>
      )}
      {busy && (
        <span id={statusId} className="photo-box-status" role="status">
          Uploading photo…
        </span>
      )}
    </span>
  )
}
