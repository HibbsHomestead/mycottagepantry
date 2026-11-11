import { load } from 'cheerio'
import { diagnosticUrl } from '../../src/lib/product-import-diagnostics'

/** Describe documents without recording raw HTML, cookies, tokens, or script text. */
export function pageEvidence(
  html: string,
  source: URL,
  document?: ReturnType<typeof load>,
) {
  const $ = document || load(html)
  const title = $('title').text().trim()
  const challenge =
    /captcha|robot check|robot or human|human verification|access denied|verify (?:that )?you|confirm (?:that )?you/i.test(
      title + ' ' + $('h1, h2').text(),
    ) || $('form[action*="captcha" i], input#captchacharacters').length > 0
  const refresh = $('meta[http-equiv="refresh" i]').attr('content')
  const target =
    refresh?.match(/(?:^|;)\s*url\s*=\s*["']?([^"']+)/i)?.[1]?.trim() ||
    html.match(
      /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    )?.[1] ||
    html.match(
      /(?:window\.)?location\.(?:replace|assign)\(\s*["']([^"']+)["']/i,
    )?.[1]
  let browserRedirect:
    | { url: string; kind: 'error' | 'challenge' | 'product' | 'unsupported' }
    | undefined
  if (target) {
    try {
      const url = new URL(target, source)
      const safe =
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        url.origin === source.origin
      browserRedirect = {
        // Untrusted destinations are never exposed or requested.
        url: safe ? diagnosticUrl(url.href) : '[unsupported destination]',
        kind: challenge
          ? 'challenge'
          : safe && /^\/(?:error|errors)(?:\/|$)/i.test(url.pathname)
            ? 'error'
            : safe &&
                /\/(?:dp|gp\/product)\/[a-z0-9]{10}(?:\/|$)/i.test(url.pathname)
              ? 'product'
              : 'unsupported',
      }
    } catch {
      /* Not a usable destination. */
    }
  }
  return { challenge, browserRedirect }
}
