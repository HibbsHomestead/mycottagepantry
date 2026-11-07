import { expect, test, type Locator } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  blankLabel,
  newElement,
  systemLabelTemplates,
  type LabelDocument,
} from '../src/lib/label-studio'
import { labelLayout } from '../src/lib/label-sets'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

// Screenshot-equivalent names, dimensions, and formats, with synthetic content.
// The real app and stylesheet render here; no customer data or API is changed.
function template(name: string, width: number, height: number): LabelDocument {
  return {
    ...blankLabel(),
    id: name,
    name,
    width,
    height,
    recordKind: 'template',
    revision: 2,
    savedAt: '2026-11-07T12:58:41Z',
    elements: [
      {
        ...newElement('text', 'HIBBS HOMESTEAD MARKET'),
        x: 12,
        y: 12,
        width: width - 24,
        fontSize: 12,
      },
      {
        ...newElement('image'),
        assetId: 'pantry-art-v1:cookie-butter',
        x: 30,
        y: 45,
        width: width - 60,
        height: 80,
      },
      {
        ...newElement('text', 'Classic Chocolate Chip Cookies'),
        x: 12,
        y: 130,
        height: 40,
        width: width - 24,
        fontSize: 14,
      },
      {
        ...newElement('text', 'Net Wt. 5 oz (142g)'),
        x: 12,
        y: 174,
        width: width - 24,
        fontSize: 8,
      },
    ],
  }
}

async function expectContentFits(root: Locator) {
  const overflow = await root.evaluate((panel) => {
    const boundary = panel.getBoundingClientRect()
    const contentRight = boundary.left + panel.clientLeft + panel.clientWidth
    const problems: string[] = []
    // Check actual text boxes as well as scroll widths: hidden overflow cannot
    // make this pass. Native option popups and SVG design text are excluded.
    for (const el of panel.querySelectorAll<HTMLElement>(
      'button, button span, h3, p, .studio-field, .studio-small-note',
    )) {
      if (!el.getClientRects().length) continue
      const rect = el.getBoundingClientRect()
      if (
        el.scrollWidth > el.clientWidth + 1 ||
        rect.left < boundary.left - 1 ||
        rect.right > contentRight + 1
      )
        problems.push(el.textContent || el.tagName)
      for (const child of el.childNodes) {
        if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim())
          continue
        const range = document.createRange()
        range.selectNodeContents(child)
        for (const text of range.getClientRects())
          if (text.left < rect.left - 1 || text.right > rect.right + 1)
            problems.push('clipped text: ' + child.textContent)
      }
    }
    if (panel.scrollWidth > panel.clientWidth + 1)
      problems.push('horizontal panel scroll')
    return problems
  })
  expect(overflow).toEqual([])
}

for (const width of [1762, 1280]) {
  test(`gallery and all editor panels fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 854 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const paired: LabelDocument = {
      ...template('Front/Back Template', 216, 216),
      format: 'front-back',
      back: labelLayout(template('Back', 216, 216)),
    }
    paired.elements.push({
      ...newElement(
        'text',
        'Long field name with package, recipe, and product details across multiple wrapped lines',
      ),
      hidden: true,
    })
    const designs = [
      paired,
      template('Food Label', 216, 288),
      template('BreadLabelTemplate', 216, 288),
    ]
    const longAssetName =
      'Hibbs Homestead Market secondary business logo with decorative lettering and transparent background'
    workspace.settings[0].labelEditorScope = 'layout-fixture'
    workspace.label_recovery_drafts = []
    workspace.label_templates = [
      ...designs,
      ...systemLabelTemplates.map((t) => ({
        ...t,
        deletedAt: '2026-11-07T00:00:00Z',
      })),
    ]
    workspace.graphic_assets = [
      {
        id: 'long-asset-name',
        name: longAssetName,
        fileUrl: '/artwork/cookie-butter.svg',
        widthPx: 1200,
        heightPx: 960,
      },
    ]
    await page.route('**/api/workspace*', async (route) => {
      await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Labels'))
    const studio = page.locator('.label-studio')
    await studio.getByRole('button', { name: 'Templates', exact: true }).click()
    const gallery = studio.locator('.studio-template-grid')
    const cards = gallery.locator('.studio-template-card')
    await expect(cards).toHaveCount(3)
    await page.evaluate(() => document.fonts.ready)
    await gallery.screenshot({
      path: `docs/previews/label-gallery-${width}.png`,
    })
    await expectContentFits(gallery)
    const geometry = await cards.evaluateAll((elements) =>
      elements.map((el) => {
        const rect = el.getBoundingClientRect()
        const preview = el.querySelector('.studio-template-preview')!
        const previewRect = preview.getBoundingClientRect()
        return {
          width: rect.width,
          height: rect.height,
          top: rect.top,
          previewHeight: previewRect.height,
          sides: [...preview.querySelectorAll('svg.studio-label-svg')].map(
            (svg) => {
              const box = svg.getBoundingClientRect()
              return {
                box: {
                  x: box.x,
                  y: box.y,
                  width: box.width,
                  height: box.height,
                },
                preview: {
                  x: previewRect.x,
                  y: previewRect.y,
                  width: previewRect.width,
                  height: previewRect.height,
                },
                fits:
                  box.left >= previewRect.left &&
                  box.right <= previewRect.right &&
                  box.top >= previewRect.top &&
                  box.bottom <= previewRect.bottom,
                preserveAspectRatio: svg.getAttribute('preserveAspectRatio'),
              }
            },
          ),
        }
      }),
    )
    await test.info().attach('layout-measurements', {
      body: JSON.stringify({ width, geometry }),
      contentType: 'application/json',
    })
    for (const card of geometry) {
      expect(card.width).toBeGreaterThanOrEqual(320)
      expect(card.height).toBeLessThan(510)
      expect(card.previewHeight).toBe(230)
      expect(card.sides.every((side) => side.fits)).toBe(true)
      expect(
        card.sides.every((side) => side.preserveAspectRatio !== 'none'),
      ).toBe(true)
    }
    expect(geometry[0].sides).toHaveLength(2)
    expect(geometry[1].top).toBe(geometry[0].top)
    if (width === 1762) expect(geometry[2].top).toBe(geometry[0].top)
    const card = cards.filter({
      has: page.getByRole('heading', { name: paired.name }),
    })
    await expect(card.locator('figcaption').nth(0)).toContainText('Front')
    await expect(card.locator('figcaption').nth(1)).toContainText('Back')
    for (const action of ['Open template', 'Assign to products'])
      await expect(
        card.getByRole('button', { name: action, exact: true }),
      ).toBeVisible()

    // Exercise existing actions through their unchanged dialogs/handlers.
    await card.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect(
      page.getByRole('dialog').getByLabel('Template name'),
    ).toHaveValue(paired.name)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await card
      .getByRole('button', { name: 'Assign to products', exact: true })
      .click()
    await expect(studio.locator('.template-assignments')).toBeVisible()

    const sidebar = studio.locator('.studio-left')
    const editor = studio.locator('.studio-editor')
    const layout = await editor.evaluate((el) => {
      const panel = el.querySelector('.studio-left')!
      const stage = el.querySelector('.studio-stage-area')!
      const settings = el.querySelector('.studio-inspector')!
      return {
        sidebar: panel.getBoundingClientRect().width,
        canvas: stage.getBoundingClientRect().width,
        settings: settings.getBoundingClientRect().width,
        fits: el.scrollWidth <= el.clientWidth + 1,
      }
    })
    expect(layout.sidebar).toBeGreaterThanOrEqual(280)
    expect(layout.canvas).toBeGreaterThanOrEqual(300)
    expect(layout.settings).toBeGreaterThanOrEqual(245)
    expect(layout.fits).toBe(true)
    for (const tab of ['Elements', 'Assets', 'Layers']) {
      await sidebar.getByRole('button', { name: tab, exact: true }).click()
      if (tab === 'Elements') {
        await sidebar
          .getByText('Original bakery illustrations', { exact: true })
          .click()
      }
      if (tab === 'Assets') {
        const asset = sidebar.getByRole('button', {
          name: longAssetName,
          exact: true,
        })
        await asset.scrollIntoViewIfNeeded()
        await expect(asset).toBeVisible()
        expect(
          await asset
            .locator('img')
            .evaluate((img) => img.getBoundingClientRect().width),
        ).toBe(38)
        await expectContentFits(sidebar)
        const lastAsset = sidebar.locator('.studio-asset-row').last()
        await lastAsset.scrollIntoViewIfNeeded()
        await expect(lastAsset).toBeInViewport()
        const lastBox = await lastAsset.boundingBox()
        const sidebarBox = await sidebar.boundingBox()
        expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(
          sidebarBox!.y + sidebarBox!.height,
        )
        await asset.click()
        await sidebar.evaluate((el) => {
          el.scrollTop = 0
        })
      }
      await expectContentFits(sidebar)
      expect(
        await sidebar.evaluate((el) => getComputedStyle(el).overflowY),
      ).toBe('auto')
      expect(
        await sidebar.evaluate((el) => el.scrollHeight > el.clientHeight),
      ).toBe(tab !== 'Layers')
      await sidebar.evaluate((el) => {
        el.scrollTop = 0
      })
      await editor.scrollIntoViewIfNeeded()
      await page.screenshot({
        path: `docs/previews/label-editor-${tab.toLowerCase()}-${width}.png`,
      })
    }
    page.on('dialog', (dialog) => dialog.accept())
    await studio
      .getByRole('button', { name: 'Template library', exact: true })
      .click()
    const single = cards.filter({
      has: page.getByRole('heading', { name: 'Food Label', exact: true }),
    })
    await single
      .getByRole('button', { name: 'Create front/back copy', exact: true })
      .click()
    await expect(studio.getByLabel('Template format')).toHaveValue('front-back')
    await expect(studio.getByText(/Blank back/)).toBeVisible()
  })
}
