import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LabelCanvas } from '@/components/label-studio'
import { blankLabel, newElement, resolveLabelData } from '@/lib/label-studio'
import { demoData } from '@/lib/demo'
import { formatNetWeight } from '@/lib/net-weight'
import banana from '../../docs/artwork-samples/bananas.svg?raw'
import orange from '../../docs/artwork-samples/spiced-orange.svg?raw'
import roll from '../../docs/artwork-samples/cinnamon-roll.svg?raw'
import cranberry from '../../docs/artwork-samples/cranberry-orange.svg?raw'

const samples = [
  {
    id: 'bananas',
    name: 'Bananas',
    aliases: 'banana bread fruit',
    svg: banana,
    product: 'Banana Bread',
  },
  {
    id: 'spiced-orange',
    name: 'Spiced orange',
    aliases: 'citrus cinnamon clove',
    svg: orange,
    product: 'Spiced Orange Sugar',
  },
  {
    id: 'cinnamon-roll',
    name: 'Cinnamon roll',
    aliases: 'bun swirl pastry',
    svg: roll,
    product: 'Cinnamon Rolls',
  },
  {
    id: 'cranberry-orange',
    name: 'Cranberry orange',
    aliases: 'cranberries citrus berry',
    svg: cranberry,
    product: 'Cranberry Orange Bread',
  },
].map((sample) => ({
  ...sample,
  fileUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sample.svg)}`,
}))

/** Isolated visual checkpoint, never imported by production routes. */
export function ArtworkStyleReview() {
  const [selected, select] = useState(samples[0].id)
  const [query, search] = useState('')
  const workspace = demoData()
  const template = {
    ...blankLabel(),
    id: 'artwork-review-only',
    name: 'Artwork style sample',
    width: 216,
    height: 144,
    elements: [
      {
        ...newElement('text', 'COTTAGE PANTRY'),
        x: 12,
        y: 9,
        width: 192,
        height: 13,
        fontSize: 8,
        align: 'center' as const,
      },
      {
        ...newElement('image', '', 'product.graphic'),
        x: 72,
        y: 27,
        width: 72,
        height: 58,
      },
      {
        ...newElement('text', '', 'product.name'),
        x: 9,
        y: 92,
        width: 198,
        height: 20,
        fontSize: 11,
        align: 'center' as const,
      },
      {
        ...newElement('text', '', 'product.netQuantity'),
        x: 12,
        y: 119,
        width: 192,
        height: 12,
        fontSize: 8,
        align: 'center' as const,
      },
    ],
  }
  return (
    <main className="review-page">
      <style>{`
        *{box-sizing:border-box}body{margin:0;background:#f7f5f0;color:#282b22;font:14px Georgia,serif}
        .review-page{max-width:1080px;margin:auto;padding:32px}.review-page h1{font-size:26px;margin:8px 0}.review-page p{line-height:1.5}.review-kicker{font:11px sans-serif;letter-spacing:.14em;text-transform:uppercase}
        .review-picker{background:white;border:1px solid #d8dbd1;border-radius:10px;padding:16px;max-width:650px;margin:24px 0}.review-picker h2{font-size:16px;margin:0 0 12px}.review-picker input{width:100%;padding:8px;border:1px solid #bfc6b5;border-radius:5px;margin:5px 0 12px;font:13px sans-serif}.review-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.review-grid button{padding:8px 4px;border:1px solid #d8dbd1;border-radius:6px;background:white;cursor:pointer;font:12px sans-serif}.review-grid button[aria-pressed=true]{border:2px solid #66744c;background:#f5f7ef}.review-grid img{width:100%;height:74px;object-fit:contain;display:block;margin-bottom:5px}.review-grid button:focus-visible{outline:3px solid #66744c;outline-offset:2px}
        .review-labels{display:grid;grid-template-columns:repeat(2,1fr);gap:24px}.review-labels figure{margin:0}.review-labels figcaption{font-size:13px;margin-bottom:8px}.review-paper{width:3in;height:2in;background:white;outline:1px solid #d8dbd1}.review-paper svg{width:100%;height:100%;display:block}.review-foot{font:12px sans-serif;color:#5e6456;margin-top:24px}.review-preview img{width:72px;height:58px;object-fit:contain;vertical-align:middle}.review-preview{font:12px sans-serif;margin-top:12px}
        @media(max-width:600px){.review-page{padding:18px}.review-grid{grid-template-columns:repeat(2,1fr)}.review-labels{grid-template-columns:1fr}.review-paper{max-width:100%}}
        @media print{body{background:white}.review-page{padding:0}.review-picker,.review-page>header,.review-foot{display:none}.review-labels{display:block}.review-labels figure{break-inside:avoid;margin-bottom:24px}.review-paper{outline:none}}
      `}</style>
      <header>
        <span className="review-kicker">Artwork · first style checkpoint</span>
        <h1>Four original food-label illustrations</h1>
        <p>
          Black outlines, clear silhouettes and white negative space. These are
          review samples; product-library selection remains pending approval.
        </p>
      </header>
      <section className="review-picker" aria-label="Sample artwork picker">
        <h2>Choose artwork</h2>
        <label>
          Search artwork
          <input
            value={query}
            onChange={(e) => search(e.target.value)}
            placeholder="Name or alias"
          />
        </label>
        <div className="review-grid">
          {samples
            .filter((s) =>
              `${s.name} ${s.aliases}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((sample) => (
              <button
                type="button"
                key={sample.id}
                aria-pressed={sample.id === selected}
                onClick={() => select(sample.id)}
              >
                <img src={sample.fileUrl} alt="" />
                {sample.name}
              </button>
            ))}
        </div>
        <div className="review-preview">
          Selected:{' '}
          <img
            src={samples.find((s) => s.id === selected)!.fileUrl}
            alt="Selected artwork"
          />{' '}
          {samples.find((s) => s.id === selected)!.name}
        </div>
      </section>
      <p>
        Sample labels: 3 × 2 inches at 100% print scale. The artwork occupies 1
        × 0.81 inches. The same template and real label renderer supply all four
        previews.
      </p>
      <section
        className="review-labels"
        aria-label="Sample labels at print size"
      >
        {samples.map((sample) => {
          const product = {
            ...workspace.products[0],
            id: sample.id,
            name: sample.product,
            graphicAssetId: sample.id,
            netWeightOz: 9.5,
          }
          return (
            <figure key={sample.id}>
              <figcaption>{sample.name}</figcaption>
              <div className="review-paper">
                <LabelCanvas
                  document={template}
                  data={resolveLabelData(
                    { ...workspace, products: [product] },
                    { kind: 'product', id: product.id },
                  )}
                  assets={samples.map((s) => ({
                    ...s,
                    widthPx: 120,
                    heightPx: 96,
                  }))}
                />
              </div>
            </figure>
          )
        })}
      </section>
      <p className="review-foot">
        Original SVG samples · no paid generation · CC0 commercial use ·{' '}
        {formatNetWeight(9.5)}. Print dimensions are physical CSS dimensions;
        screen size depends on device scaling. This sheet does not assign, save
        or alter any product or template.
      </p>
    </main>
  )
}

export function mountArtworkReview() {
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <ArtworkStyleReview />,
  )
}
