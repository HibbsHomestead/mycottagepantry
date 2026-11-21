import { useRef, useState } from 'react'
import type { Workspace } from '@/lib/domain'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { LabelStudio } from './label-studio'

/** A child flow leaves Product Details mounted, including its scroll position. */
export function ProductLabelFlow({
  productId,
  labelId,
  workspace,
  onWorkspace,
  ready,
  role,
  close,
}: {
  productId: string
  labelId: string
  workspace: Workspace
  onWorkspace: (workspace: Workspace) => void
  ready: boolean
  role: string
  close: () => void
}) {
  const dirty = useRef(false)
  const [createRequest, setCreateRequest] = useState(labelId ? 0 : 1)
  const dismiss = () => {
    if (!dirty.current || window.confirm('Discard unsaved label changes?'))
      close()
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss()
      }}
    >
      <DialogContent
        className="app-dialog product-label-flow"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>
            {labelId ? 'Edit product label' : 'Create product label'}
          </DialogTitle>
          <DialogDescription>
            Close this editor to return to the open product details.
          </DialogDescription>
        </DialogHeader>
        <button type="button" className="btn secondary" onClick={dismiss}>
          Close label editor
        </button>
        <LabelStudio
          workspace={workspace}
          onWorkspace={onWorkspace}
          ready={ready}
          role={role}
          initialProductId={productId}
          initialLabelId={labelId}
          initialCreateRequest={createRequest}
          onCreateRequestHandled={() => setCreateRequest(0)}
          initialSection={labelId ? 'Editor' : 'Labels'}
          onDirtyChange={(value) => {
            dirty.current = value
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
