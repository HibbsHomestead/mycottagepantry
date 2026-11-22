import { createRoot } from 'react-dom/client'
import { useRef, useState } from 'react'
import {
  ItemEditorShell,
  invalidEditorTabs,
} from '@/components/item-editor-shell'
import { SubmissionForm } from '@/components/submission-form'
import { FormErrorNotice } from '@/components/form-error-notice'
import '../styles.css'
import '../workspace.css'

function ReviewForm({ sticky }: { sticky: boolean }) {
  const [name, setName] = useState('Isolated review record')
  const [notes, setNotes] = useState('Unsaved review notes')
  const [tab, setTab] = useState('details')
  const [errorTabs, setErrorTabs] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const lock = useRef(false)
  async function submit(form: HTMLFormElement) {
    if (lock.current) return
    const invalid = invalidEditorTabs(form, 'details')
    setErrorTabs(invalid)
    if (invalid.length) {
      setTab(invalid[0])
      setError('Enter a record name in Identification before saving.')
      return
    }
    setError('')
    setSaved(false)
    setBusy(true)
    lock.current = true
    try {
      const response = await fetch('/api/review-submit', {
        method: 'POST',
        body: JSON.stringify({ name, notes }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setSaved(true)
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
      lock.current = false
    }
  }
  const fields = (
    <>
      <label>
        Record name
        <input
          required
          aria-label="Record name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Notes
        <textarea
          aria-label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
    </>
  )
  if (saved) return <p role="status">Saved successfully.</p>
  if (sticky)
    return (
      <ItemEditorShell
        title="Isolated form review"
        description="Synthetic fields and mocked requests only."
        tabs={[
          {
            id: 'details',
            label: 'Details',
            content: <p>Submission errors stay above the action row.</p>,
          },
          { id: 'identification', label: 'Identification', content: fields },
        ]}
        tab={tab}
        onTab={setTab}
        errorTabs={errorTabs}
        disabled={busy}
        error={error}
        busy={busy}
        submitDisabled={busy}
        submitLabel="Save changes"
        cancel={() => {
          document.querySelector('form')?.reset()
          setErrorTabs([])
          setError('')
          setName('Different review record')
          setNotes('')
          setTab('details')
        }}
        onSubmit={(form) => void submit(form)}
      />
    )
  return (
    <SubmissionForm
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void submit(e.currentTarget)
      }}
      style={{ maxWidth: 600, margin: '24px auto', padding: 16 }}
    >
      {fields}
      <FormErrorNotice message={error} />
      <div className="button-row">
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            setError('')
            setName('Different review record')
            setNotes('')
          }}
        >
          Cancel
        </button>
        <button className="btn" disabled={busy}>
          Save changes
        </button>
      </div>
    </SubmissionForm>
  )
}
export function mountFormNoticeReview(sticky: boolean) {
  const host = document.createElement('div')
  document.body.replaceChildren(host)
  createRoot(host).render(<ReviewForm key={String(sticky)} sticky={sticky} />)
}
