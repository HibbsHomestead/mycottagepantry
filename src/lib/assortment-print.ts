import {
  assortmentLabelText,
  type AssortmentSnapshot,
} from './assortment-labels'
import { printPlacement } from './label-printers'

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
  const paragraph = (value?: string) =>
    value ? `<p>${escapeText(value)}</p>` : ''
  const layout = snapshot.layout
  if (layout?.version === 1) {
    const { media, matrix } = printPlacement(
      { width, height },
      undefined,
      layout.rotation,
    )
    const fontSize = layout.minimumFontSize
    if (!Number.isFinite(fontSize) || fontSize < 7 || fontSize > 36)
      throw new Error('Choose a valid reviewed minimum text size.')
    const sections = snapshot.sections.map((section) => {
      const heading = component ? '' : `<h2>${escapeText(section.name)}</h2>`
      const lines = [section.declaration, section.contains, ...(section.supplierContains || []), section.advisory, section.storage]
      return `<section>${heading}${lines.map(paragraph).join('')}</section>`
    })
    const contents = component ? '' : paragraph(snapshot.contentsSummary)
    const markup = `<div class="label-page"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${media.width} ${media.height}"><foreignObject width="${width}" height="${height}" transform="matrix(${matrix.join(' ')})"><article xmlns="http://www.w3.org/1999/xhtml"><div class="label-content"><h1>${escapeText(snapshot.name)}</h1>${contents}${sections.join('')}<footer>${snapshot.fields.map(paragraph).join('')}</footer></div></article></foreignObject></svg></div>`
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Assortment labels</title><style>
      @page{size:${media.width}pt ${media.height}pt;margin:0}
      *{box-sizing:border-box}body{margin:0;background:#fff;color:#111}
      .label-page{position:relative;width:${media.width}pt;height:${media.height}pt;break-after:page;break-inside:avoid}
      .label-page:last-child{break-after:auto}
      svg{display:block;width:100%;height:100%}
      article{width:100%;height:100%;padding:8px;overflow-wrap:anywhere;font:${fontSize}px/1.22 Arial,sans-serif}
      .label-content{display:flow-root}
      h1{font-size:${Math.max(13, fontSize)}px;line-height:1.15;margin:0 0 5px}
      h2{font-size:inherit;margin:0 0 2px}
      section:not(:empty),footer:not(:empty){margin-top:5px}
      p{white-space:pre-wrap;margin:0 0 3px}
      @media screen{.label-page{outline:1px solid #a3a093;outline-offset:-1px}svg,foreignObject{overflow:visible}}
    </style></head><body>${markup.repeat(copies)}</body></html>`
  }
  const [name, ...lines] = assortmentLabelText(snapshot, component)
  const markup = `<article><h1>${escapeText(name)}</h1>${lines.map(paragraph).join('')}</article>`
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
    labels.every((label) => {
      const content = label.querySelector<HTMLElement>('.label-content')
      if (!content)
        return (
          label.scrollHeight <= label.clientHeight &&
          label.scrollWidth <= label.clientWidth
        )
      const view = document.defaultView!
      const { height, paddingTop, paddingBottom } = view.getComputedStyle(label)
      return (
        parseFloat(view.getComputedStyle(content).height) <=
          parseFloat(height) -
            parseFloat(paddingTop) -
            parseFloat(paddingBottom) &&
        content.scrollWidth <= content.clientWidth
      )
    })
  )
}
