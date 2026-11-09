import '../styles.css'
import '../workspace.css'
import '../surface-layout.css'
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
