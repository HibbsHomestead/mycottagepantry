import { useRef, useState } from 'react'
import { Upload, Check, FileType } from 'lucide-react'
import type { Workspace } from '@/lib/domain'
import { workspaceFonts } from '@/lib/label-font-catalog'
import { fontCss } from './label-font-picker'
export function FontUploadPanel({
  workspace,
  onWorkspace,
  canEdit,
}: {
  workspace: Workspace
  onWorkspace: (w: Workspace) => void
  canEdit: boolean
}) {
  const [file, setFile] = useState<File | null>(null),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [previewFont, setPreviewFont] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const fonts = workspaceFonts(workspace.font_assets)
  async function upload() {
    if (!file || !consent || !canEdit) return
    setBusy(true)
    setError('')
    setStatus('Validating font and PDF embedding…')
    try {
      const body = new FormData()
      body.set('file', file)
      body.set('licenseConsent', 'true')
      const response = await fetch('/api/workspace?fontUpload=1', {
        method: 'POST',
        body,
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || 'Font upload failed. Try again.')
      onWorkspace(result.workspace)
      setPreviewFont(result.asset.font.name)
      setFile(null)
      setConsent(false)
      if (input.current) input.current.value = ''
      setStatus('Font uploaded and ready for labels.')
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Font upload failed. Try again.',
      )
      setStatus('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="studio-panel font-upload-panel"
      aria-label="Upload oven fonts"
    >
      <h3>
        <FileType size={20} /> Your fonts
      </h3>
      <p>
        Upload a font for your oven. It becomes available in label designs and
        Brand Kit typography.
      </p>
      <label className="studio-field">
        <span>Font file</span>
        <input
          ref={input}
          type="file"
          accept=".ttf,.otf,.woff,.woff2"
          disabled={!canEdit || busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] || null)
            setError('')
            setStatus('')
          }}
        />
      </label>
      <small>
        TTF, OTF, WOFF, or WOFF2 · up to 4 MB. Upload each style as a separate
        file.
      </small>
      <label className="font-upload-consent">
        <input
          type="checkbox"
          checked={consent}
          disabled={!canEdit || busy}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>
          I confirm I have the right to use and embed this font in printed and
          exported labels.
        </span>
      </label>
      <button
        type="button"
        className="btn primary"
        disabled={!canEdit || !file || !consent || busy}
        onClick={upload}
      >
        <Upload size={17} />
        {busy ? 'Validating…' : 'Upload font'}
      </button>
      {!canEdit && <p>Connect as an Owner or Manager to upload fonts.</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      {previewFont && (
        <div className="uploaded-font-row">
          <style>{fontCss([previewFont], fonts)}</style>
          <span style={{ fontFamily: JSON.stringify(previewFont) }}>
            Banana Bread
          </span>
          <small>{previewFont}</small>
        </div>
      )}
      {fonts.map((font) => (
        <div className="uploaded-font-row" key={font.file}>
          <button
            type="button"
            className="text-button"
            onClick={() => setPreviewFont(font.name)}
            aria-label={`Preview uploaded ${font.name}`}
          >
            Preview font
          </button>
          <small>
            <Check size={14} /> {font.name} · PDF ready
          </small>
        </div>
      ))}
    </section>
  )
}
