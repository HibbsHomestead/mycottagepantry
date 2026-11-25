import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LabelCanvas } from '../components/label-canvas'
import { assortmentFixture } from '../test/fixtures/label-assortments'
import { artworkLibrary } from './artwork-library'
import { assortmentReview } from './label-assortments'
import { browserPrint } from './label-browser-print'
import { defaultSheet } from './label-print-layout'
import { blankLabel, newElement } from './label-studio'

afterEach(() => vi.restoreAllMocks())

it('measures browser print preparation with isolated assets and dialog boundaries', async () => {
  const artwork = artworkLibrary[0]
  const cache = new Set<string>()
  let requests = 0,
    decodes = 0,
    calls = 0,
    bytes = 0
  const delay = (duration: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, duration))
  const body = new Uint8Array(64 * 1024)
  let fail = false
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL() {
        return 'blob:https://test.invalid/label-artwork'
      }
      static revokeObjectURL() {}
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests++
      const warm = cache.has(url)
      await delay(warm ? 3 : 18)
      cache.add(url)
      return new Response(body, { status: fail ? 404 : 200 })
    }),
  )
  vi.stubGlobal(
    'Image',
    class {
      async decode() {
        decodes++
        await delay(2)
      }
    },
  )
  vi.spyOn(document.body, 'append').mockImplementation((node) => {
    const frame = node as HTMLIFrameElement
    bytes = frame.srcdoc.length
    const printDoc = new DOMParser().parseFromString(
      frame.srcdoc,
      'text/html',
    )
    Object.defineProperty(printDoc, 'fonts', {
      value: {
        load: async () => {
          await delay(2)
          return [{}]
        },
        ready: Promise.resolve(),
        [Symbol.iterator]: function* () {},
      },
    })
    Object.defineProperty(frame, 'contentWindow', {
      value: {
        document: printDoc,
        requestAnimationFrame: (paint: () => void) => setTimeout(paint, 16),
        addEventListener: vi.fn(),
        focus: vi.fn(),
        print: () => {
          calls++
        },
      },
    })
    queueMicrotask(() => frame.onload?.(new Event('load')))
  })
  const make = (image: boolean, copy: number) => ({
    document: {
      ...blankLabel(),
      elements: [newElement('text', `Flavour ${copy}`)],
    },
    svg: new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg"><text>Flavour ${copy}</text>${image ? `<image href="${artwork.fileUrl}"/>` : ''}</svg>`,
      'image/svg+xml',
    ).documentElement as unknown as SVGSVGElement,
  })
  try {
    for (const [name, image, copies, distinct] of [
      ['simple', false, 1, false],
      ['artwork', true, 1, false],
      ['copies', true, 24, false],
      ['distinct', true, 3, true],
      ['mixed', false, 2, true],
    ] as const) {
      const { workspace, plan } = assortmentFixture()
      const lines = plan.groups[0].lines
      plan.mode = 'variable'
      plan.groups = [
        { name: 'Morning', count: 1, lines: lines.slice(0, 2) },
        { name: 'Afternoon', count: 1, lines: lines.slice(1) },
      ]
      const sequence =
        name === 'mixed'
          ? plan.groups.map((_, group) => {
              const review = assortmentReview(workspace, plan, {
                group,
                component: -1,
              })
              const markup = renderToStaticMarkup(
                createElement(LabelCanvas, {
                  document: review.document,
                  data: review.data,
                }),
              )
              return {
                document: review.document,
                svg: new DOMParser().parseFromString(
                  markup,
                  'image/svg+xml',
                ).documentElement as unknown as SVGSVGElement,
              }
            })
          : distinct
            ? [make(image, 1), make(image, 2), make(image, 3)]
            : undefined
      const entry = sequence?.[0] || make(image, 1)
      const observations = []
      for (
        let run = 0;
        run < (process.env.LABEL_PRINT_BENCH === '1' ? 10 : 1);
        run++
      ) {
        if (run % 2 === 0) cache.clear()
        requests = decodes = bytes = 0
        const before = performance.now()
        const stages: Record<string, number> = {}
        await browserPrint(
          entry.svg,
          entry.document,
          [],
          [],
          copies,
          defaultSheet,
          undefined,
          sequence,
          {
            timing: (stage, duration) => {
              stages[stage] = Math.round(duration)
            },
          },
        )
        observations.push({
          mode: run % 2 ? 'repeat' : 'cold',
          ms: Math.round(performance.now() - before),
          requests,
          decodes,
          bytes,
          ...(run < 2 && { stages }),
        })
      }
      expect(bytes).toBeGreaterThan(0)
      if (process.env.LABEL_PRINT_BENCH === '1')
        console.info(name, JSON.stringify(observations))
    }
    const entry = make(true, 1),
      completed = calls
    fail = true
    await expect(
      browserPrint(entry.svg, entry.document, [], [], 1, defaultSheet),
    ).rejects.toThrow()
    expect(calls).toBe(completed)
    fail = false
    const controller = new AbortController()
    const pending = browserPrint(
      entry.svg,
      entry.document,
      [],
      [],
      1,
      defaultSheet,
      undefined,
      undefined,
      { signal: controller.signal },
    )
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await browserPrint(entry.svg, entry.document, [], [], 1, defaultSheet)
    expect(calls).toBe(completed + 1)
  } finally {
    vi.unstubAllGlobals()
  }
}, 45000)
