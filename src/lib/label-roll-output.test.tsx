// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { createCanvas } from '@napi-rs/canvas'
import { toBuffer } from 'bwip-js/node'
import {
  chromium,
  devices,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import ts from 'typescript'
import { PDFDocument } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { LabelCanvas } from '../components/label-canvas'
import { RollArtworkPreview } from '../components/label-print-media'
import { printerSelection } from '../components/label-print-workflow'
import {
  exportCalibrationPdf,
  exportSvgLabelPdf,
} from '../../netlify/lib/label-svg-output'
import { calibrationMarkup } from './label-calibration'
import { assortmentFixture } from '../test/fixtures/label-assortments'
import { assortmentReview } from './label-assortments'
import { demoData } from './demo'
import { exportLabelPdf } from './label-export'
import { defaultSheet } from './label-print-layout'
import {
  checkPrinterSize,
  qzPrintOptions,
  validatePrinterProfile,
  type PrintRotation,
} from './label-printers'
import { blankLabel, newElement, type LabelData } from './label-studio'

const markers = [
  { x: 14, y: 14, color: '#ff0000', rgb: [255, 0, 0] },
  { x: 202, y: 14, color: '#00ff00', rgb: [0, 255, 0] },
  { x: 14, y: 274, color: '#0000ff', rgb: [0, 0, 255] },
  { x: 202, y: 274, color: '#ff00ff', rgb: [255, 0, 255] },
]
const doc = {
  ...blankLabel(),
  width: 216,
  height: 288,
  elements: [
    { ...newElement('border'), x: 2, y: 2, width: 212, height: 284 },
    ...markers.map(({ x, y, color }) => ({
      ...newElement('shape'),
      x: x - 5,
      y: y - 5,
      width: 10,
      height: 10,
      fill: color,
    })),
    { ...newElement('text', 'TOP OF DESIGN'), x: 30, y: 25 },
    {
      ...newElement('image'),
      assetId: 'barcode',
      x: 40,
      y: 90,
      width: 136,
      height: 55,
    },
  ],
}
const data: LabelData = {
  values: {},
  warnings: [],
  allergens: [],
  weightsVerified: true,
  ingredientParts: [],
}
const layout = { ...defaultSheet, mode: 'roll' as const }

async function installPrintFixture(context: BrowserContext) {
  const modules = new Map<string, string>()
  const contents = new Map<string, string>()
  await context.route('https://print-fixture.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/' || contents.has(path))
      return route.fulfill({
        contentType: 'text/html',
        body:
          contents.get(path) ||
          '<!doctype html><title>Print fixture</title><script type="importmap">{"imports":{"zod":"/deps/zod/index.js"}}</script>',
      })
    if (/^\/deps\/zod\/(?:[\w-]+\/)*[\w.-]+\.js$/.test(path))
      return route.fulfill({
        contentType: 'text/javascript',
        body: await readFile(`node_modules/${path.slice('/deps/'.length)}`),
      })
    if (/^\/src\/lib\/[\w-]+(?:\.ts)?$/.test(path)) {
      const file = path.endsWith('.ts') ? path : `${path}.ts`
      if (!modules.has(file)) {
        const source = await readFile(`.${file}`, 'utf8')
        const compiled = ts.transpileModule(source, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        })
        modules.set(file, compiled.outputText)
      }
      return route.fulfill({
        contentType: 'text/javascript',
        body: modules.get(file)!,
      })
    }
    if (/^\/label-fonts\/[\w-]+\.ttf$/.test(path))
      return route.fulfill({
        contentType: 'font/ttf',
        body: await readFile(`public${path}`),
      })
    if (path === '/failed.png') return route.fulfill({ status: 404 })
    return route.abort()
  })
  return contents
}

async function prepareBrowserFixture(
  page: Page,
  entries: { markup: string; document: typeof doc }[],
  assets: { id: string; name: string; fileUrl: string }[],
  copies: number,
  profile?: ReturnType<typeof profileFor>,
) {
  return page.evaluate(
    async ({ entries, assets, copies, profile, layout, entry }) => {
      const load = new Function('path', 'return import(path)') as (
        path: string,
      ) => Promise<typeof import('./label-browser-print')>
      const { browserPrint } = await load(entry)
      const getter = Object.getOwnPropertyDescriptor(
        HTMLIFrameElement.prototype,
        'contentWindow',
      )!
      let output:
        | {
            html: string
            fonts: string[]
            imageUrl: string | null
            text: string
            pages: number
          }
        | undefined
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        configurable: true,
        get(this: HTMLIFrameElement) {
          const frame = getter.get!.call(this) as Window
          if (frame && this.dataset.labelPrint)
            frame.print = () => {
              output = {
                html: this.srcdoc,
                fonts: [...frame.document.fonts].map(
                  (font) => `${font.family}:${font.status}`,
                ),
                imageUrl:
                  frame.document
                    .querySelector('svg image')
                    ?.getAttribute('href') || null,
                text: frame.document.body.textContent || '',
                pages: frame.document.querySelectorAll('.page').length,
              }
            }
          return frame
        },
      })
      try {
        const designs = entries.map(({ markup, document }) => ({
          document,
          svg: new DOMParser().parseFromString(markup, 'image/svg+xml')
            .documentElement as unknown as SVGSVGElement,
        }))
        await browserPrint(
          designs[0].svg,
          designs[0].document,
          assets,
          [],
          copies,
          layout,
          profile,
          designs.length > 1 ? designs : undefined,
        )
        if (!output) throw new Error('Print was not called')
        return output
      } finally {
        Object.defineProperty(
          HTMLIFrameElement.prototype,
          'contentWindow',
          getter,
        )
      }
    },
    {
      entries,
      assets,
      copies,
      profile,
      layout,
      entry: '/src/lib/label-browser-print.ts',
    },
  )
}

function profileFor(rotation: PrintRotation) {
  const swapped = rotation === 90 || rotation === 270
  return validatePrinterProfile({
    id: `roll-${rotation}`,
    name: 'Roll printer',
    method: 'qz',
    unit: 'in',
    width: swapped ? 4 : 3,
    height: swapped ? 3 : 4,
    orientation: 'landscape',
    rotation,
    designWidth: doc.width,
    designHeight: doc.height,
    offsetX: 0,
    offsetY: 0,
    preferred: true,
  })
}

async function artwork() {
  const png = await toBuffer({
    bcid: 'code128',
    text: 'CP12345',
    scale: 2,
    height: 9,
  })
  return {
    assets: [
      {
        id: 'barcode',
        name: 'Synthetic barcode',
        fileUrl: `data:image/png;base64,${png.toString('base64')}`,
      },
    ],
    loaders: {
      fonts: [],
      font: (key: string) => readFile(`public/label-fonts/${key}.ttf`),
      image: async () => png,
    },
  }
}

function expectedPoint(rotation: PrintRotation, x: number, y: number) {
  switch (rotation) {
    case 90:
      return [288 - y, x]
    case 180:
      return [216 - x, 288 - y]
    case 270:
      return [y, 216 - x]
    default:
      return [x, y]
  }
}

async function inspectPdf(
  bytes: Uint8Array,
  count: number,
  rotation: PrintRotation,
) {
  const pdf = await PDFDocument.load(bytes)
  expect(pdf.getPageCount()).toBe(count)
  const profile = profileFor(rotation)
  const task = getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: true,
  })
  try {
    const rendered = await task.promise
    for (const [index, page] of pdf.getPages().entries()) {
      expect(page.getWidth()).toBeCloseTo(profile.width * 72, 0)
      expect(page.getHeight()).toBeCloseTo(profile.height * 72, 0)
      expect(page.getRotation().angle).toBe(0)
      const pdfPage = await rendered.getPage(index + 1)
      const viewport = pdfPage.getViewport({ scale: 2 })
      const canvas = createCanvas(viewport.width, viewport.height)
      await pdfPage.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        viewport,
      }).promise
      const context = canvas.getContext('2d')
      const pixel = (x: number, y: number) => {
        const [px, py] = expectedPoint(rotation, x, y)
        return [...context.getImageData(px * 2, py * 2, 1, 1).data].slice(
          0,
          3,
        )
      }
      for (const { x, y, rgb } of markers) expect(pixel(x, y)).toEqual(rgb)
      expect(pixel(97, 200)).toEqual([255, 255, 255])
      const darkness = (x: number, y: number) => pixel(x, y)[0] < 100
      const textInk = Array.from({ length: 100 }, (_, x) =>
        Array.from({ length: 20 }, (_, y) => darkness(30 + x, 25 + y)).some(
          Boolean,
        ),
      ).filter(Boolean)
      expect(textInk.length).toBeGreaterThan(20)
      const barcode = Array.from({ length: 120 }, (_, x) =>
        darkness(48 + x, 117),
      )
      expect(
        barcode.filter(
          (black, index) => index && black !== barcode[index - 1],
        ).length,
      ).toBeGreaterThan(18)
    }
  } finally {
    await task.destroy()
  }
}

it.each([0, 90, 180, 270] as const)(
  'renders both PDF engines at %i degrees without changing the source label',
  async (rotation) => {
    const before = structuredClone(doc)
    const { assets, loaders } = await artwork()
    const profile = profileFor(rotation)
    await inspectPdf(
      await exportLabelPdf(doc, data, assets, 2, layout, loaders, profile),
      2,
      rotation,
    )
    await inspectPdf(
      await exportSvgLabelPdf(
        [doc, doc],
        data,
        assets,
        layout,
        loaders,
        profile,
      ),
      2,
      rotation,
    )
    expect(doc).toEqual(before)
    expect(qzPrintOptions(profile)).toMatchObject({
      orientation: 'portrait',
      rotation: 0,
      copies: 1,
      scaleContent: false,
    })
  },
)

it.runIf(process.env.RUN_LABEL_CHROMIUM === '1')(
  'renders the artwork preview and one label per physical print page in Chromium',
  async () => {
    const browser = await chromium.launch()
    try {
      const context = await browser.newContext()
      const contents = await installPrintFixture(context)
      const page = await context.newPage()
      const rendered = await context.newPage()
      await page.goto('https://print-fixture.test/')
      const { assets } = await artwork()
      const styles = await readFile(
        'src/components/label-studio.css',
        'utf8',
      )
      const markup = renderToStaticMarkup(
        <LabelCanvas document={doc} data={data} assets={assets} />,
      )
      for (const rotation of [0, 90, 180, 270] as const) {
        const profile = profileFor(rotation)
        const preview = renderToStaticMarkup(
          <RollArtworkPreview design={doc} profile={profile}>
            <LabelCanvas document={doc} data={data} assets={assets} />
          </RollArtworkPreview>,
        )
        await page.setContent(`<style>${styles}</style>${preview}`)
        const artwork = page.getByRole('img', {
          name: /artwork on loaded media/i,
        })
        expect(await artwork.getAttribute('viewBox')).toBe(
          `0 0 ${profile.width * 72} ${profile.height * 72}`,
        )
        for (const [index, marker] of markers.entries()) {
          const position = await artwork.evaluate(
            (outer, markerId) => {
              const markerGroup = outer.querySelector<SVGGElement>(
                `[data-element="${markerId}"]`,
              )!
              const toScreen = markerGroup.getScreenCTM()!
              const toPage = (outer as SVGSVGElement)
                .getScreenCTM()!
                .inverse()
              const point = new DOMPoint(5, 5)
                .matrixTransform(toScreen)
                .matrixTransform(toPage)
              return [point.x, point.y]
            },
            doc.elements[index + 1].id,
          )
          const [expectedX, expectedY] = expectedPoint(
            rotation,
            marker.x,
            marker.y,
          )
          expect(position[0]).toBeCloseTo(expectedX)
          expect(position[1]).toBeCloseTo(expectedY)
        }
        const output = await prepareBrowserFixture(
          page,
          [{ markup, document: doc }],
          assets,
          3,
          profile,
        )
        expect(output.pages).toBe(3)
        expect(output.fonts).toContain('DM Sans:loaded')
        expect(output.imageUrl).toMatch(/^blob:/)
        contents.set('/output', output.html)
        await rendered.goto('https://print-fixture.test/output')
        await inspectPdf(
          await rendered.pdf({
            preferCSSPageSize: true,
            printBackground: true,
          }),
          3,
          rotation,
        )
      }
    } finally {
      await browser.close()
    }
  },
  30000,
)

it.runIf(process.env.RUN_LABEL_CHROMIUM === '1')(
  'renders distinct assortment combinations in mobile Chromium and blocks failed artwork',
  async () => {
    const browser = await chromium.launch()
    try {
      const context = await browser.newContext(devices['Pixel 7'])
      const contents = await installPrintFixture(context)
      const page = await context.newPage()
      await page.goto('https://print-fixture.test/')
      const { workspace, plan } = assortmentFixture()
      plan.mode = 'variable'
      const lines = plan.groups[0].lines
      plan.groups = [
        { name: 'Morning', count: 1, lines: lines.slice(0, 2) },
        { name: 'Afternoon', count: 1, lines: lines.slice(1) },
      ]
      const entries = plan.groups.map((_, group) => {
        const review = assortmentReview(workspace, plan, {
          group,
          component: -1,
        })
        expect(review.warnings).toEqual([])
        return {
          document: review.document,
          markup: renderToStaticMarkup(
            <LabelCanvas document={review.document} data={review.data} />,
          ),
        }
      })
      const output = await prepareBrowserFixture(page, entries, [], 2)
      expect(output.pages).toBe(2)
      expect(output.fonts).toEqual(['DM Sans:loaded', 'DM Sans:loaded'])
      contents.set('/output', output.html)
      const rendered = await context.newPage()
      await rendered.goto('https://print-fixture.test/output')
      const bytes = await rendered.pdf({
        preferCSSPageSize: true,
        printBackground: true,
      })
      const physical = await PDFDocument.load(bytes)
      expect(physical.getPages().map((sheet) => sheet.getSize())).toEqual([
        { width: 288, height: 432 },
        { width: 288, height: 432 },
      ])
      const task = getDocument({ data: Uint8Array.from(bytes) })
      const renderedPdf = await task.promise
      const readText = async (number: number) =>
        (await (await renderedPdf.getPage(number)).getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
      try {
        const morning = await readText(1)
        const afternoon = await readText(2)
        expect(morning).toMatch(
          /Blueberry[\s\S]*Chocolate[\s\S]*CONTAINS: MILK[\s\S]*May contain soy/i,
        )
        expect(morning).not.toContain('Lemon')
        expect(afternoon).toMatch(/Chocolate[\s\S]*Lemon[\s\S]*tree nuts/i)
        expect(afternoon).not.toContain('Blueberry')
      } finally {
        await task.destroy()
      }
      const assets = [
        { id: 'barcode', name: 'Failed barcode', fileUrl: '/failed.png' },
      ]
      const markup = renderToStaticMarkup(
        <LabelCanvas document={doc} data={data} assets={assets} />,
      )
      await expect(
        prepareBrowserFixture(page, [{ markup, document: doc }], assets, 1),
      ).rejects.toThrow(/Cannot load Failed barcode/)
      expect(
        (await prepareBrowserFixture(page, entries, [], 2)).pages,
      ).toBe(2)
    } finally {
      await browser.close()
    }
  },
  30000,
)

it('keeps rotation on the selected profile and validates the saved design size', () => {
  const workspace = demoData()
  const turned = profileFor(90)
  const other = { ...profileFor(0), preferred: false }
  workspace.settings[0].currentPrinterProfiles = [turned, other]
  expect(
    printerSelection(workspace, '', doc).selectedPrinter?.rotation,
  ).toBe(90)
  expect(
    printerSelection(workspace, other.id, doc).selectedPrinter?.rotation,
  ).toBe(0)
  expect(
    printerSelection(workspace, '', { ...doc, width: 288, height: 216 })
      .selectedPrinter,
  ).toBeUndefined()
  expect(() =>
    checkPrinterSize({ width: 288, height: 216 }, turned),
  ).toThrow(/sizes differ/)
  expect(() => validatePrinterProfile({ ...turned, rotation: 0 })).toThrow(
    /sizes differ/,
  )
  expect(() => validatePrinterProfile({ ...turned, rotation: 45 })).toThrow(
    /valid design size and output rotation/,
  )
})

it('generates one media-sized calibration page and shows the marks in the SVG preview', async () => {
  const profile = profileFor(270)
  const markup = calibrationMarkup(profile)
  expect(markup).toMatch(/TOP[\s\S]*BOTTOM[\s\S]*1 inch/)
  expect(markup).toContain('matrix(0 -1 1 0 0 216)')
  const pdf = await PDFDocument.load(await exportCalibrationPdf(profile))
  expect(pdf.getPageCount()).toBe(1)
  expect(pdf.getPage(0).getSize()).toEqual({ width: 288, height: 216 })
})
