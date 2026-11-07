import { useEffect, useRef, useState } from 'react'
import { Star, Search, Check } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import {
  labelFonts,
  bundledLabelFonts,
  fontFileUrl,
  fontFaceKey,
  type LabelFont,
} from '@/lib/label-font-catalog'
export const fontCss = (names?: string[], customFonts: LabelFont[] = []) =>
  (names
    ? [...labelFonts, ...customFonts].filter((f) => names.includes(f.name))
    : bundledLabelFonts
  )
    .map((f) =>
      f.weights
        .map(
          (w) =>
            `@font-face{font-family:${JSON.stringify(f.name)};src:url("${fontFileUrl(fontFaceKey(f, w === 700))}") format('${f.browserFormat || 'truetype'}');font-weight:${w};font-display:swap}`,
        )
        .join(''),
    )
    .join('')
export type FontPreferences = { favorites: string[]; recent: string[] }
const filters = [
  'All fonts',
  'Uploaded fonts',
  'Google Fonts online',
  'Bundled & offline',
  'Favorites',
  'Recently used',
  'Sans serif',
  'Serif',
  'Display',
  'Script & handwritten',
  'Rustic & farmhouse',
  'Bold & condensed',
  'Typewriter',
  'Minimal',
  'Seasonal',
  'Print-safe body fonts',
]
function FontRow({
  font,
  children,
}: {
  font: (typeof labelFonts)[number]
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '60px' },
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      className="font-library-row"
      style={visible ? { fontFamily: JSON.stringify(font.name) } : undefined}
    >
      {visible && <style>{fontCss([font.name], [font])}</style>}
      {children}
    </div>
  )
}
export function FontPicker({
  value,
  customFonts = [],
  onChange,
  onUploadRequest,
  preview = 'Banana Bread',
  preferences: savedPreferences = { favorites: [], recent: [] },
  onPreferences,
  disabled = false,
}: {
  value: string
  customFonts?: LabelFont[]
  onChange: (font: string) => void
  onUploadRequest?: () => void
  preview?: string
  preferences?: FontPreferences
  onPreferences?: (p: FontPreferences) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('All fonts'),
    [candidate, setCandidate] = useState(value),
    [limit, setLimit] = useState(40),
    [fontError, setFontError] = useState(''),
    [fontLoading, setFontLoading] = useState(false)
  useEffect(() => setLimit(40), [query, filter])
  const [preferences, setPreferences] = useState(savedPreferences)
  const savedSignature = JSON.stringify(savedPreferences)
  useEffect(() => setPreferences(savedPreferences), [savedSignature])
  function updatePreferences(next: FontPreferences) {
    setPreferences(next)
    onPreferences?.(next)
  }
  const availableFonts = [...labelFonts, ...customFonts]
  const font = availableFonts.find((f) => f.name === candidate)
  useEffect(() => {
    setFontError('')
    if (!open || !['google', 'custom'].includes(font?.source || '')) {
      setFontLoading(false)
      return
    }
    let active = true
    setFontLoading(true)
    document.fonts
      .load(`16px ${JSON.stringify(font!.name)}`)
      .then((faces) => {
        if (!faces.length) throw new Error('Font unavailable')
      })
      .catch(() => {
        if (active)
          setFontError(
            'This font could not load. Try again or choose a bundled font. No substitute is exported.',
          )
      })
      .finally(() => {
        if (active) setFontLoading(false)
      })
    return () => {
      active = false
    }
  }, [candidate, open])
  const fonts = availableFonts
    .filter(
      (f) =>
        f.name.toLowerCase().includes(query.toLowerCase()) &&
        (filter === 'All fonts' ||
          (filter === 'Uploaded fonts' && f.source === 'custom') ||
          (filter === 'Google Fonts online' && f.source === 'google') ||
          (filter === 'Bundled & offline' && f.source === 'bundled') ||
          (filter === 'Favorites' && preferences.favorites.includes(f.name)) ||
          (filter === 'Recently used' && preferences.recent.includes(f.name)) ||
          f.tags.includes(filter)),
    )
    .sort((a, b) =>
      a.name === value
        ? -1
        : b.name === value
          ? 1
          : filter === 'Recently used'
            ? preferences.recent.indexOf(a.name) -
              preferences.recent.indexOf(b.name)
            : 0,
    )
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) setCandidate(value)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="font-picker-trigger"
          disabled={disabled}
          aria-label={`Font: ${value}`}
        >
          {value}
          <span>Browse fonts</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="font-library"
        align="end"
        aria-label="Font library"
      >
        <style>{fontCss([candidate], customFonts)}</style>
        <small>
          Google Fonts · {labelFonts.length.toLocaleString()} families · loaded
          on demand
        </small>
        <div className="font-search">
          <Search size={18} />
          <input
            aria-label="Search fonts"
            placeholder="Search fonts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="font-filters" aria-label="Font categories">
          {filters.map((f) => (
            <button
              type="button"
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="font-preview">
          <small>Preview · {candidate}</small>
          <p style={{ fontFamily: JSON.stringify(candidate) }}>
            {preview.slice(0, 120) || 'Banana Bread'}
          </p>
          <small>
            {['google', 'custom'].includes(font?.source || '')
              ? 'Review readability for small print'
              : font?.smallPrint
                ? 'Good for small print'
                : 'Best for headings'}{' '}
            · Recommended {font?.minimumPt} pt+ ·{' '}
            {font?.source === 'google'
              ? 'Google font · embedding checked at export'
              : font?.source === 'custom'
                ? 'Uploaded · PDF embedding verified'
                : 'Bundled PDF font'}
          </small>
          {font && font.source !== 'custom' && (
            <a
              href={
                'https://fonts.google.com/specimen/' +
                encodeURIComponent(font.name).replace(/%20/g, '+')
              }
              target="_blank"
              rel="noreferrer"
              className="font-license-link"
            >
              Font details & license on Google Fonts
            </a>
          )}
        </div>
        <div className="font-library-list" aria-label="Fonts">
          {fonts.slice(0, limit).map((f) => (
            <FontRow key={f.name} font={f}>
              <button
                type="button"
                className="font-option"
                aria-label={`Preview ${f.name}`}
                aria-pressed={candidate === f.name}
                onClick={() => setCandidate(f.name)}
              >
                <span>
                  {f.name}
                  {value === f.name && <Check size={14} />}
                </span>
                <span className="font-sample">
                  {preview.slice(0, 40) || 'Banana Bread'}
                </span>
                <small>
                  {f.smallPrint ? 'Good for small print' : 'Best for headings'}{' '}
                  · {f.weights.join(', ')}
                </small>
              </button>
              <button
                type="button"
                className="font-favorite"
                aria-label={`Favorite ${f.name}`}
                aria-pressed={preferences.favorites.includes(f.name)}
                disabled={!onPreferences}
                onClick={() =>
                  updatePreferences({
                    ...preferences,
                    favorites: preferences.favorites.includes(f.name)
                      ? preferences.favorites.filter((n) => n !== f.name)
                      : [...preferences.favorites, f.name],
                  })
                }
              >
                <Star
                  size={18}
                  fill={
                    preferences.favorites.includes(f.name)
                      ? 'currentColor'
                      : 'none'
                  }
                />
              </button>
            </FontRow>
          ))}
          {fonts.length > limit && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => setLimit((n) => n + 40)}
            >
              Show more fonts ({fonts.length - limit} remaining)
            </button>
          )}
          {!fonts.length && (
            <p>No fonts match. Try another category or search.</p>
          )}
        </div>
        {onUploadRequest && (
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              setOpen(false)
              onUploadRequest()
            }}
          >
            Upload font file
          </button>
        )}
        {fontError && <p role="alert">{fontError}</p>}
        {fontLoading && <small role="status">Loading font preview…</small>}
        <button
          type="button"
          disabled={fontLoading || !!fontError}
          className="btn primary"
          onClick={() => {
            onChange(candidate)
            updatePreferences({
              ...preferences,
              recent: [
                candidate,
                ...preferences.recent.filter((n) => n !== candidate),
              ].slice(0, 16),
            })
            setOpen(false)
          }}
        >
          Apply {candidate}
        </button>
      </PopoverContent>
    </Popover>
  )
}
