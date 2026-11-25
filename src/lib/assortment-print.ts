import {
  assortmentLabelText,
  type AssortmentSnapshot,
} from './assortment-labels'

function escapeText(value: string) {
  return value.replace(
    /[&<>]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]!,
  )
}

export function assortmentPrintHtml(
  snapshot: AssortmentSnapshot,
  copies: number,
  component = false,
) {
  const { width, height } = snapshot.stock
  if (
    ![width, height].every(
      (size) => Number.isFinite(size) && size >= 36 && size <= 1440,
    ) ||
    !Number.isInteger(copies) ||
    copies < 1 ||
    copies > 200
  )
    throw new Error('Choose usable label stock and 1–200 copies.')
  const [name, ...lines] = assortmentLabelText(snapshot, component)
  const markup = `<article><h1>${escapeText(name)}</h1>${lines.map((line) => `<p>${escapeText(line)}</p>`).join('')}</article>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Assortment labels</title><style>
    @page{size:${width}pt ${height}pt;margin:0}
    *{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font:10pt/1.22 Arial,sans-serif}
    article{width:${width}pt;height:${height}pt;padding:8pt;break-after:page;overflow-wrap:anywhere}
    article:last-child{break-after:auto}h1{font-size:13pt;line-height:1.15;margin:0 0 5pt}p{white-space:pre-wrap;margin:0 0 3pt}
    @media screen{article{outline:1px solid #a3a093;outline-offset:-1px}}
  </style></head><body>${markup.repeat(copies)}</body></html>`
}

export function assortmentPrintFits(document: Document) {
  const labels = [...document.querySelectorAll('article')]
  return (
    labels.length > 0 &&
    labels.every(
      (label) =>
        label.scrollHeight <= label.clientHeight &&
        label.scrollWidth <= label.clientWidth,
    )
  )
}
