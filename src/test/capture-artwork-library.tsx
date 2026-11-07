import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ItemImagesPanel } from '@/components/item-images-panel'
import { LabelCanvas } from '@/components/label-studio'
import { artworkLibrary } from '@/lib/artwork-library'
import { blankLabel, newElement, resolveLabelData } from '@/lib/label-studio'
import { demoData } from '@/lib/demo'
import '@/styles.css'
import '@/workspace.css'
import '@/surface-layout.css'
import '@/components/product-editor.css'

/** Synthetic browser fixture for the production shared picker and label renderer. */
function LibraryReview() {
  const [product, setProduct] = useState({
    ...demoData().products[0],
    graphicAssetId: artworkLibrary[0].id,
    labelArtworkVersion: 2,
  })
  const w = demoData()
  const template = {
    ...blankLabel(),
    id: 'shared-review',
    name: 'Shared artwork template',
    width: 216,
    height: 144,
    elements: [
      {
        ...newElement('image', '', 'product.graphic'),
        x: 72,
        y: 15,
        width: 72,
        height: 58,
      },
      {
        ...newElement('text', '', 'product.name'),
        x: 9,
        y: 85,
        width: 198,
        height: 22,
        fontSize: 11,
        align: 'center' as const,
      },
      {
        ...newElement('text', '', 'product.netQuantity'),
        x: 9,
        y: 119,
        width: 198,
        height: 12,
        fontSize: 8,
        align: 'center' as const,
      },
    ],
  }
  const items = [
    product,
    ...artworkLibrary.map((a) => ({
      ...product,
      id: a.id,
      name: a.name,
      graphicAssetId: a.id,
    })),
  ]
  return (
    <main className="library-review">
      <style>{`.library-review{max-width:1040px;margin:auto;padding:24px}.sample-labels{display:flex;flex-wrap:wrap;gap:24px;margin-top:24px}.sample-labels figure{margin:0}.sample-labels figcaption{font-size:12px;margin-bottom:6px}.sample-label{width:3in;height:2in;background:white;border:1px solid #ddd}.sample-label>svg{width:100%;height:100%;display:block}@media(max-width:480px){.library-review{padding:12px}.sample-labels{justify-content:center}}@media print{.item-images,.library-review>h1{display:none}.sample-labels figure{break-inside:avoid}.sample-label{border:0}.library-review{padding:0}}`}</style>
      <h1>Label artwork library</h1>
      <ItemImagesPanel
        value={product}
        assets={[]}
        canUpload={false}
        disabled={false}
        onChange={(key, value) => setProduct((p) => ({ ...p, [key]: value }))}
        onWorkspace={() => {}}
        onBusy={() => {}}
      />
      <div className="sample-labels">
        {items.map((p, index) => {
          const data = resolveLabelData(
            { ...w, products: [{ ...p, netWeightOz: 9.5 }] },
            { kind: 'product', id: p.id },
          )
          return (
            <figure key={index}>
              <figcaption>
                {index === 0 ? 'Selected product artwork' : p.name} · 3 × 2 in
              </figcaption>
              <div className="sample-label">
                <LabelCanvas document={template} data={data} assets={[]} />
              </div>
            </figure>
          )
        })}
      </div>
    </main>
  )
}
export function mountArtworkLibrary() {
  createRoot(document.getElementById('root') || document.body).render(
    <LibraryReview />,
  )
}
