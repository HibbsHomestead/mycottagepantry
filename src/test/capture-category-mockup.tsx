// Disposable browser review harness; all API requests are intercepted by Playwright.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import type { Workspace } from '../lib/domain'
import { demoData } from '../lib/demo'
import { ProductMockups } from '../components/product-mockup'
import { ScopedCategorySelect } from '../components/section-categories'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog'
import '../styles.css'
import '../workspace.css'
const render = {
  id: 'disposable-render',
  name: 'Disposable front view',
  productId: 'disposable-product',
  category: 'product-mockup',
  mockup: { version: 1, baseId: 'shared-base', artworkId: 'shared-art' },
}
function Review() {
  const [workspace, setWorkspace] = useState<Workspace>(() => ({
    ...demoData(),
    graphic_assets: [render],
  }))
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({
    id: 'draft',
    name: '',
    recipeCategoryId: '',
  })
  return (
    <main>
      <ProductMockups
        productId="disposable-product"
        assets={workspace.graphic_assets}
        primaryImageAssetId="disposable-render"
        canEdit
        onWorkspace={setWorkspace}
      />
      <button onClick={() => setOpen(true)}>Edit recipe</button>
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="app-dialog">
            <DialogTitle>Edit recipe</DialogTitle>
            <DialogDescription>Unsaved disposable recipe</DialogDescription>
            <label>
              Recipe name
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <div className="form-grid">
              <ScopedCategorySelect
                workspace={workspace}
                scope="recipes"
                item={draft}
                canManage
                onSettings={(patch) =>
                  setWorkspace((w) => ({
                    ...w,
                    settings: [{ ...w.settings[0], ...patch }],
                  }))
                }
                onChange={(key, value) =>
                  setDraft((d) => ({ ...d, [key]: value }))
                }
              />
              <label className="field">
                Description
                <input />
              </label>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </main>
  )
}
export function mountReview() {
  createRoot(document.getElementById('root')!).render(<Review />)
}
