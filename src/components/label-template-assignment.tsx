import { useState } from 'react'
import type { Item, Workspace } from '@/lib/domain'
import type { LabelDocument } from '@/lib/label-studio'
import { labelRecordKind } from '@/lib/label-library'
import { resolveLabelData } from '@/lib/label-studio'
import { PairedLabelPreview } from './label-set-controls'

export function ProductTemplateField({
  value,
  workspace,
  change,
}: {
  value: Item
  workspace: Workspace
  change: (key: string, value: Item[string]) => void
}) {
  const templates = (
    (workspace.label_templates as LabelDocument[]) || []
  ).filter((t) => !t.deletedAt && labelRecordKind(t) === 'template')
  const assigned = ((workspace.label_templates as LabelDocument[]) || []).find(
    (t) => t.id === value.labelDesignId,
  )
  const data = resolveLabelData(
    {
      ...workspace,
      products: [value, ...workspace.products.filter((p) => p.id !== value.id)],
    },
    { kind: 'product', id: value.id },
    workspace.brand_kits?.[0],
  )
  return (
    <section className="product-template-field">
      <label className="field">
        <span>Label template</span>
        <select
          aria-label="Label template"
          value={value.labelDesignId || ''}
          onChange={(e) => {
            change('labelDesignId', e.target.value)
            change('labelAssignmentEdited', true)
          }}
        >
          <option value="">Choose a label template</option>
          {assigned &&
            (labelRecordKind(assigned) !== 'template' ||
              assigned.deletedAt) && (
              <option value={assigned.id}>
                Legacy design · {assigned.name} (preserved)
              </option>
            )}
          {value.labelDesignId && !assigned && (
            <option value={value.labelDesignId}>
              Unavailable assigned design (preserved)
            </option>
          )}
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.format === 'front-back' ? ' · Front + Back' : ''}
            </option>
          ))}
        </select>
      </label>
      {assigned && !assigned.deletedAt && (
        <PairedLabelPreview
          document={assigned}
          data={data}
          assets={workspace.graphic_assets || []}
        />
      )}
    </section>
  )
}

export function TemplateAssignments({
  document,
  workspace,
  canEdit,
  request,
}: {
  document: LabelDocument
  workspace: Workspace
  canEdit: boolean
  request: (action: string, data: Record<string, unknown>) => Promise<Workspace>
}) {
  const current = workspace.products.filter(
    (p) => p.labelDesignId === document.id,
  )
  const [selected, setSelected] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const ids = selected || current.map((p) => p.id)
  return (
    <details className="template-assignments">
      <summary>Assigned products · {current.length}</summary>
      <p>
        Shared template: edits affect future labels for assigned products.
        Selecting another template replaces that product’s active assignment.
      </p>
      {workspace.products.map((p) => (
        <label className="check-label" key={p.id}>
          <input
            type="checkbox"
            checked={ids.includes(p.id)}
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? [...ids, p.id]
                  : ids.filter((id) => id !== p.id),
              )
            }
          />
          {p.name}
          {p.labelDesignId && p.labelDesignId !== document.id
            ? ' · replaces current assignment'
            : ''}
        </label>
      ))}
      <button
        type="button"
        className="btn secondary"
        disabled={!canEdit || busy || selected === null || !document.revision}
        onClick={async () => {
          setBusy(true)
          try {
            await request('templateAssignments', {
              templateId: document.id,
              productIds: ids,
            })
            setSelected(null)
            setStatus('Assignments saved.')
          } catch (error) {
            setStatus((error as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        Save product assignments
      </button>
      {!document.revision && (
        <p>Save the template before assigning products.</p>
      )}
      <p role="status">{status}</p>
    </details>
  )
}
