// Development-only browser review fixture, with synthetic API responses supplied by Playwright.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { ProductMockups } from '../components/product-mockup'
import type { Workspace } from '../lib/domain'
import '../styles.css'
import '../workspace.css'
import '../interface-typography.css'
function Review() {
  const [w, setW] = useState<Workspace>({ graphic_assets: [] })
  return (
    <main style={{ padding: '1rem' }}>
      <h1>Handmade tote</h1>
      <ProductMockups
        productId="review-tote"
        assets={w.graphic_assets}
        canEdit
        onWorkspace={setW}
      />
    </main>
  )
}
export function mountMockupReview() {
  const host = document.createElement('div')
  document.body.replaceChildren(host)
  createRoot(host).render(<Review />)
}
