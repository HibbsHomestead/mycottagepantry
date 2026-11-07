import type { LabelDocument } from './label-studio'

// Existing documents predate the library and remain saved labels.
export const labelRecordKind = (document: LabelDocument) =>
  document.isSystem || document.recordKind === 'template' ? 'template' : 'label'

export const templateNameKey = (name: string) =>
  name.trim().normalize('NFKC').toLocaleLowerCase('en-US')

export function copyLabelDesign(
  document: LabelDocument,
  kind: 'label' | 'template',
  name = document.name,
): LabelDocument {
  const copy = structuredClone(document)
  for (const key of [
    'createdBy',
    'updatedBy',
    'updatedAt',
    'savedAt',
    'deletedAt',
    'lastSaveOperationId',
    'lastSaveHash',
    'lastSaveSessionId',
    'lastSaveSequence',
  ])
    delete (copy as unknown as Record<string, unknown>)[key]
  copy.id = crypto.randomUUID()
  copy.revision = 0
  copy.isSystem = false
  copy.recordKind = kind
  copy.name = name.trim()
  if (kind === 'label' && labelRecordKind(document) === 'template')
    copy.sourceTemplateId = document.id
  if (kind === 'template') delete copy.sourceTemplateId
  return copy
}
