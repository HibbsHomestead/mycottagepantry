import { BackToTop } from '@/components/back-to-top'
import '../styles.css'
import '../workspace.css'
import '../surface-layout.css'
import '../interface-typography.css'
/** Development-only screenshot fixture. Not a route or production entry point.
 * Browser tests intercept /api/workspace with deterministic demonstration records. */
import { createRoot } from 'react-dom/client'
import { WorkspaceApp } from '@/components/workspace-app'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
export async function decodeFixtureBarcode(source: string) {
  const { BrowserMultiFormatReader } = await import('@zxing/browser')
  return (
    await new BrowserMultiFormatReader().decodeFromImageUrl(source)
  ).getText()
}
export function mountScreenshotWorkspace() {
  const host = document.createElement('div')
  document.body.replaceChildren(host)
  createRoot(host).render(
    <TooltipProvider>
      <WorkspaceApp />
      <BackToTop />
      <Toaster />
    </TooltipProvider>,
  )
}

/** Camera lifecycle harness; only imported by browser tests. */
export async function mountScannerFixture() {
  const { BarcodeScanner } = await import('@/components/barcode-scanner')
  const host = document.createElement('div')
  document.body.replaceChildren(host)
  const root = createRoot(host)
  root.render(
    <BarcodeScanner
      onCode={(code) => {
        document.body.dataset.scanned = code
        root.unmount()
      }}
      onClose={() => root.unmount()}
    />,
  )
}

export async function mountSupportInboxFixture() {
  const { SupportPage } = await import('@/components/support-page')
  const host = document.createElement('div')
  document.body.replaceChildren(host)
  createRoot(host).render(
    <>
      <SupportPage staff />
      <BackToTop />
    </>,
  )
}
export async function mountAdminAccessFixture() {
  const { AdminBusinessAccess } =
    await import('@/components/admin-business-access')
  const data = await (await fetch('/api/admin?action=fixture-business')).json()
  const host = document.createElement('div')
  document.body.replaceChildren(host)
  createRoot(host).render(
    <div className="cp-admin">
      <AdminBusinessAccess data={data} />
    </div>,
  )
}

/** Exercises the shared scroll control with independent page/body scrollers. */
export async function mountScrollFixture() {
  const { useState, useRef } = await import('react')
  const { Dialog, DialogContent, DialogTitle, DialogDescription } =
    await import('@/components/ui/dialog')
  function ScrollFixture() {
    const dialogRef = useRef<HTMLDivElement>(null)
    const [open, setOpen] = useState(false),
      [draft, setDraft] = useState('')
    return (
      <>
        <button onClick={() => setOpen(true)}>Open long form</button>
        <main data-page-scroll style={{ height: '55vh', overflowY: 'auto' }}>
          <label>
            Page draft
            <input defaultValue="Preserved page draft" />
          </label>
          {Array.from({ length: 45 }, (_, i) => (
            <p key={i}>Page section {i}</p>
          ))}
        </main>
        <BackToTop />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            ref={dialogRef}
            onOpenAutoFocus={() => {
              if (dialogRef.current)
                dialogRef.current.dataset.forwardedRef = 'true'
            }}
            positioning="css"
            presentation="detail"
            style={{
              top: 20,
              left: 20,
              width: 'calc(100vw - 40px)',
              height: 'calc(100dvh - 40px)',
              maxHeight: 'none',
              overflow: 'hidden',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <DialogTitle>Long form</DialogTitle>
            <DialogDescription>
              Independent popup body with a fixed footer.
            </DialogDescription>
            <div
              data-popup-scroll
              style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}
            >
              <label>
                Popup draft
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </label>
              {Array.from({ length: 90 }, (_, i) => (
                <p key={i}>Form section {i}</p>
              ))}
            </div>
            <footer
              style={{
                padding: 12,
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 12,
              }}
            >
              <button type="button">Cancel draft</button>
              <button type="button">Save draft</button>
            </footer>
          </DialogContent>
        </Dialog>
      </>
    )
  }
  const host = document.createElement('div')
  document.body.replaceChildren(host)
  createRoot(host).render(<ScrollFixture />)
}
