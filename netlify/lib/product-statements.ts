import { load } from 'cheerio'

type Statements = Partial<
  Record<'subingredients' | 'sourceContains' | 'sourceMayContain', string>
>
const keyFor = (label: string): keyof Statements | undefined => {
  const clean = label
    .toLowerCase()
    .replace(/[:\s]+$/g, '')
    .trim()
  if (
    /^(ingredients?|ingredient (?:statement|list)|ingredients and subingredients)$/.test(
      clean,
    )
  )
    return 'subingredients'
  if (/^(contains|allergen contains|contains statement)$/.test(clean))
    return 'sourceContains'
  if (
    /^(may contain|cross[- ]contact(?: statement)?|facility statement)$/.test(
      clean,
    )
  )
    return 'sourceMayContain'
}
function text(value: unknown): string {
  if (Array.isArray(value))
    return value.map(text).filter(Boolean).join('\n').slice(0, 6000)
  if (value && typeof value === 'object')
    return text((value as any).value ?? (value as any).text)
  if (typeof value !== 'string') return ''
  const $ = load(value)
  $('script,style').remove()
  $('br').replaceWith('\n')
  $('p,li,div').append('\n')
  return $.root()
    .text()
    .replace(/[\t\r ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 6000)
}
/** Read explicit statements only. Descriptions and product names never supply ingredients. */
export function productStatements(
  product: any,
  html: string,
  sourceUrl: string,
  allowPage: boolean,
  document?: ReturnType<typeof load>,
): Statements {
  const result: Statements = {}
  const add = (key: keyof Statements, value: unknown) => {
    const wording = text(value)
    if (!wording) return
    const markers = [
      ...wording.matchAll(
        /(?:^|\n|(?<=\.)\s+)(Contains\b|May contain\b|(?:Made|Manufactured|Processed|Packed) in (?:a |the )?(?:facility|factory)\b)/gi,
      ),
    ]
    if (markers.length && key !== 'sourceMayContain') {
      const first = markers[0].index! + markers[0][0].indexOf(markers[0][1])
      if (first > 0 && !result[key])
        result[key] = wording.slice(0, first).trim()
      const parts: Partial<Record<keyof Statements, string[]>> = {}
      for (let i = 0; i < markers.length; i++) {
        const start = markers[i].index! + markers[i][0].indexOf(markers[i][1])
        const end = markers[i + 1]?.index ?? wording.length
        const target = /^Contains\b/i.test(markers[i][1])
          ? 'sourceContains'
          : 'sourceMayContain'
        ;(parts[target] ||= []).push(wording.slice(start, end).trim())
      }
      for (const target of ['sourceContains', 'sourceMayContain'] as const)
        if (!result[target] && parts[target])
          result[target] = parts[target]!.join(' ')
      return
    }
    if (!result[key]) result[key] = wording
    else if (key === 'sourceMayContain' && !result[key]!.includes(wording))
      result[key] += '\n' + wording
  }
  const labeled = (label: string, value: unknown) => {
    const key = keyFor(label)
    if (key) add(key, value)
  }
  add('subingredients', product.ingredients)
  add('sourceContains', product.allergenContains)
  add('sourceMayContain', product.allergenMayContain)
  for (const property of [product.additionalProperty].flat().filter(Boolean))
    labeled(String(property.name || ''), property.value)
  const $ = document || load(html)
  const labeledMarkup = (markup: string) => {
    const section = load(markup)
    section('strong,b').each((_, el) => {
      const label = section(el).text().trim()
      const key = keyFor(label)
      if (!key) return
      let content = ''
      let node = el.nextSibling
      while (node) {
        const next = section(node)
        if (next.is('strong,b') && keyFor(next.text().trim())) break
        content += section.html(node)
        node = node.nextSibling
      }
      if (content.trim())
        add(key, key === 'subingredients' ? content : `${label} ${content}`)
    })
  }
  // Primary Sam’s Club hydration is accepted only when both product IDs match.
  const url = new URL(sourceUrl)
  const id = url.pathname.match(/\/ip\/[^/]+\/(\d+)\/?$/)?.[1]
  if (
    ['samsclub.com', 'www.samsclub.com'].includes(url.hostname) &&
    id &&
    String(product.sku) === id
  ) {
    try {
      const data = JSON.parse($('#__NEXT_DATA__').text())?.props?.pageProps
        ?.initialData?.data
      const primary = data?.product
      if (String(primary?.usItemId) === id) {
        add(
          'subingredients',
          typeof primary.ingredients === 'string'
            ? primary.ingredients
            : primary.ingredients?.ingredients,
        )
        add('sourceContains', primary.allergenContains)
        add('sourceMayContain', primary.allergenMayContain)
        for (const group of primary.productDetails?.specifications ||
          primary.specifications ||
          [])
          labeled(String(group.name || group.title || ''), group.value)
        for (const component of primary.idml?.components || [])
          if (Array.isArray(component.specifications))
            for (const spec of component.specifications)
              labeled(String(spec.name || ''), spec.value)
        add(
          'subingredients',
          data.idml?.ingredients?.ingredients || data.idml?.ingredients,
        )
        for (const spec of data.idml?.specifications || []) {
          labeled(String(spec.name || ''), spec.value)
          if (typeof spec.value === 'string') labeledMarkup(spec.value)
        }
      }
    } catch {
      /* Unsupported hydration leaves the accessible page path available. */
    }
  }
  if (!allowPage) return result
  // Avoid recommendation/review content and ambiguous page text on multi-product pages.
  $('[itemprop="ingredients"]').each((_, el) =>
    add('subingredients', $(el).attr('content') || $(el).html()),
  )
  $('h2,h3,h4,h5,h6,dt,summary').each((_, el) => {
    const key = keyFor($(el).text())
    if (
      !key ||
      $(el).closest(
        'aside,nav,[data-testid*="recommend"],[id*="recommend"],[class*="recommend"]',
      ).length
    )
      return
    const sibling = $(el).next()
    if (sibling.length && !sibling.is('h1,h2,h3,h4,h5,h6,dt,summary'))
      add(key, sibling.html())
  })
  $('p,dd').each((_, el) => {
    if (
      $(el).closest(
        'aside,nav,[data-testid*="recommend"],[id*="recommend"],[class*="recommend"],[itemprop="review"]',
      ).length
    )
      return
    if (
      $(el)
        .children('strong,b')
        .toArray()
        .some((child) => keyFor($(child).text()))
    )
      labeledMarkup($(el).html() || '')
  })
  return result
}
