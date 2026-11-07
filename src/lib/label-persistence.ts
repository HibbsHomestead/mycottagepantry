import type { LabelDocument } from './label-studio'
import type { Workspace } from './domain'

export function mergeLabelWorkspace(
  current: Workspace,
  incoming: Workspace,
): Workspace {
  if (
    current.settings[0]?.labelEditorScope !==
    incoming.settings[0]?.labelEditorScope
  )
    return incoming
  const templates = new Map(
    (current.label_templates || []).map((item) => [item.id, item]),
  )
  for (const item of incoming.label_templates || [])
    if (
      !templates.has(item.id) ||
      (!templates.get(item.id)?.deletedAt &&
        (item.deletedAt ||
          Number(item.revision) >= Number(templates.get(item.id)?.revision)))
    )
      templates.set(item.id, item)
  const versions = new Map(
    [...(current.label_versions || []), ...(incoming.label_versions || [])].map(
      (item) => [item.id, item],
    ),
  )
  return {
    ...incoming,
    label_templates: [...templates.values()],
    label_versions: [...versions.values()],
  }
}

// Compare the complete editable payload, independently of server bookkeeping.
export function labelContent(document: LabelDocument): string {
  const bookkeeping = new Set([
    'revision',
    'isSystem',
    'createdBy',
    'updatedBy',
    'updatedAt',
    'savedAt',
    'lastSaveOperationId',
    'lastSaveHash',
    'lastSaveSessionId',
    'lastSaveSequence',
  ])
  const editable = Object.fromEntries(
    Object.entries(document).filter(([key]) => !bookkeeping.has(key)),
  )
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .filter(([, item]) => item !== undefined)
              .map(([key, item]) => [key, stable(item)]),
          )
        : value
  return JSON.stringify(stable(editable))
}

export function confirmLabelSave(
  workspace: Workspace,
  document: LabelDocument,
  operationId: string,
): LabelDocument & { savedAt: string } {
  const saved = (
    Array.isArray(workspace?.label_templates) ? workspace.label_templates : []
  ).find((item) => item.id === document.id)
  if (
    !saved ||
    saved.deletedAt ||
    !Number.isInteger(saved.revision) ||
    saved.revision < 1 ||
    saved.lastSaveOperationId !== operationId ||
    !Number.isFinite(Date.parse(saved.savedAt)) ||
    labelContent(saved as LabelDocument) !== labelContent(document)
  )
    throw new Error(
      'The server did not confirm the complete editable label. Keep this editor open, export a recovery file, and retry.',
    )
  return saved as LabelDocument & { savedAt: string }
}
