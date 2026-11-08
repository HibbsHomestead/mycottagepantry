import { expect, test } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { blankLabel, newElement } from '../src/lib/label-studio'
import { labelLayout } from '../src/lib/label-sets'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const [width, height] of [
  [1762, 854],
  [1280, 854],
  [1440, 900],
  [1024, 900],
  [768, 900],
  [390, 900],
  [320, 900],
]) {
  test(`product details keep labels and actions below the unchanged photo (${width} × ${height})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const product = workspace.products[0]
    const label = {
      ...blankLabel(),
      id: 'loaf-label',
      name: 'Homestyle White Bread · Front + Back',
      workflowVersion: 1,
      recordKind: 'label',
      revision: 1,
      source: { kind: 'product', id: product.id },
      productId: product.id,
      format: 'front-back',
      elements: [newElement('text', 'Homestyle White Bread')],
      back: labelLayout({
        ...blankLabel(),
        elements: [newElement('text', 'Bread ingredients')],
      }),
    }
    workspace.label_templates = [label]
    let writes = 0
    await page.route('**/api/workspace*', (route) => {
      if (route.request().method() === 'POST') writes++
      return route.fulfill({
        json: { workspace, role: 'Owner', demo: false },
      })
    })
    await page.goto(workspaceFixtureUrl('Products/Food'))
    const card = page.getByRole('article', {
      name: product.name,
      exact: true,
    })
    await card
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    const dialog = page.getByRole('dialog', {
      name: product.name,
      exact: true,
    })
    await expect(
      dialog.getByRole('heading', { name: 'Labels', exact: true }),
    ).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({
      path: `docs/previews/product-details-after-${width}.png`,
      animations: 'disabled',
    })
    const media = dialog.locator('.product-detail-media')
    const labels = media.getByRole('region', { name: 'Product labels' })
    await expect(
      labels.getByRole('button', { name: 'Preview/Print' }),
    ).toHaveCount(1)
    await expect(
      labels.getByRole('button', { name: 'Edit', exact: true }),
    ).toHaveCount(1)
    await expect(
      media.getByRole('button', { name: 'Edit Product' }),
    ).toBeEnabled()
    await expect(
      media.getByRole('button', { name: 'Create label' }),
    ).toBeEnabled()
    await expect(
      media.getByRole('button', { name: 'Open recipe' }),
    ).toBeEnabled()
    await expect(dialog.locator('.product-detail-information')).toContainText(
      'How this is calculated',
    )
    await expect(
      dialog.locator('.product-detail-information').getByRole('button'),
    ).toHaveCount(0)
    const geometry = await dialog.evaluate((panel) => {
      const media = panel.querySelector('.product-detail-media')!
      const photo = media.querySelector('.product-detail-photo')!
      const rect = photo.getBoundingClientRect()
      const layout = panel.querySelector('.product-detail-layout')!
      // Compare the same photo in its original grid slot, with the same CSS.
      media.before(photo)
      media.remove()
      const original = photo.getBoundingClientRect()
      photo.replaceWith(media)
      media.prepend(photo)
      const scrollAreas = [...panel.querySelectorAll('*')].filter((el) => {
        const css = getComputedStyle(el)
        return (
          /(auto|scroll)/.test(css.overflowY) &&
          el.scrollHeight > el.clientHeight + 1
        )
      })
      return {
        photo: { width: rect.width, height: rect.height },
        original: { width: original.width, height: original.height },
        labelTop: media
          .querySelector('.product-linked-labels')!
          .getBoundingClientRect().top,
        photoBottom: rect.bottom,
        photoTop: rect.top,
        infoTop: panel
          .querySelector('.product-detail-information')!
          .getBoundingClientRect().top,
        columns: getComputedStyle(layout).gridTemplateColumns.split(' ').length,
        nestedScrollers: scrollAreas.length,
        overflowX: panel.scrollWidth - panel.clientWidth,
        overflowY: panel.scrollHeight - panel.clientHeight,
      }
    })
    expect(geometry.photo).toEqual(geometry.original)
    expect(geometry.labelTop - geometry.photoBottom).toBeGreaterThanOrEqual(8)
    expect(geometry.labelTop - geometry.photoBottom).toBeLessThanOrEqual(17)
    expect(geometry.nestedScrollers).toBe(0)
    expect(geometry.overflowX).toBeLessThanOrEqual(1)
    if (width >= 768) expect(geometry.overflowY).toBeLessThanOrEqual(1)
    if (width <= 640) {
      expect(geometry.columns).toBe(1)
      expect(geometry.photoTop).toBeLessThan(geometry.infoTop)
    }
    // Scroll the outer dialog as necessary, then check text and control bounds.
    for (const control of await media.getByRole('button').all()) {
      await control.scrollIntoViewIfNeeded()
      await expect(control).toBeInViewport()
      expect(
        await control.evaluate((el) => {
          const panel = el.closest('[role="dialog"]')!
          const outer = panel.getBoundingClientRect()
          const rect = el.getBoundingClientRect()
          return (
            rect.left >= outer.left &&
            rect.right <= outer.right &&
            el.scrollWidth <= el.clientWidth + 1
          )
        }),
      ).toBe(true)
    }
    // Existing navigation actions still reach the correct records and editor.
    await labels.getByRole('button', { name: 'Preview/Print' }).click()
    await expect(
      page.getByRole('dialog', {
        name: `Preview Label · ${product.name}`,
        exact: true,
      }),
    ).toBeVisible()
    await page
      .getByRole('dialog', {
        name: `Preview Label · ${product.name}`,
        exact: true,
      })
      .getByRole('button', { name: 'Close', exact: true })
      .first()
      .click()
    await media.getByRole('button', { name: 'Open recipe' }).click()
    await expect(
      page.getByRole('dialog').getByRole('heading', {
        name: workspace.recipes.find((r) => r.id === product.recipeId)!.name,
        exact: true,
      }),
    ).toBeVisible()
    await page.goto(workspaceFixtureUrl('Products/Food'))
    await card
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    await media
      .getByRole('button', { name: 'Edit Product', exact: true })
      .click()
    await expect(
      page.getByRole('dialog', { name: 'Edit Product', exact: true }),
    ).toBeVisible()
    await page
      .getByRole('dialog', { name: 'Edit Product', exact: true })
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    await page.goto(workspaceFixtureUrl('Products/Food'))
    await card
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    await labels.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.getByLabel('Label name', { exact: true })).toHaveValue(
      label.name,
    )
    await page.goto(workspaceFixtureUrl('Products/Food'))
    await card
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    await media
      .getByRole('button', { name: 'Create label', exact: true })
      .click()
    await expect(page.getByLabel('Label name', { exact: true })).toHaveValue(
      'Untitled label',
    )
    expect(writes).toBe(0)
  })
}

for (const width of [1440, 390]) {
  test(`long label lists retain the saved image and one accessible outer scroll area (${width})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const product = workspace.products[0]
    product.imageAssetId = 'saved-photo'
    workspace.graphic_assets = [
      {
        id: 'saved-photo',
        name: 'Saved product image',
        fileUrl: '/test-product-photo.svg',
      },
    ]
    workspace.label_templates = Array.from({ length: 12 }, (_, index) => ({
      ...blankLabel(),
      id: 'long-label-' + index,
      name:
        `Loaf label ${index + 1} with a long, wrapped description ` +
        'LongName'.repeat(15),
      workflowVersion: 1,
      recordKind: 'label',
      revision: 1,
      productId: product.id,
      source: { kind: 'product', id: product.id },
    }))
    await page.route('**/test-product-photo.svg', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="220"><rect width="100" height="220" fill="#b68b58"/></svg>',
      }),
    )
    await page.route('**/api/workspace*', (route) =>
      route.fulfill({ json: { workspace, role: 'Owner', demo: false } }),
    )
    await page.goto(workspaceFixtureUrl('Products/Food'))
    await page
      .getByRole('article', { name: product.name, exact: true })
      .getByRole('button', { name: 'View details', exact: true })
      .click()
    const dialog = page.getByRole('dialog', { name: product.name, exact: true })
    const media = dialog.locator('.product-detail-media')
    await expect(media.locator('img')).toHaveAttribute(
      'src',
      '/test-product-photo.svg',
    )
    expect(
      await media
        .locator('img')
        .evaluate((el) => getComputedStyle(el).objectFit),
    ).toBe('contain')
    await expect(
      media.getByRole('button', { name: 'Preview/Print', exact: true }),
    ).toHaveCount(12)
    for (const button of await media.getByRole('button').all()) {
      await button.scrollIntoViewIfNeeded()
      await expect(button).toBeInViewport()
      await expect(button).toBeEnabled()
    }
    expect(
      await dialog.evaluate((panel) => {
        const problems: string[] = []
        for (const el of [
          panel,
          ...panel.querySelectorAll(
            '.product-detail-media, .product-linked-labels, .product-linked-label, .product-linked-label > span, .product-detail-media button',
          ),
        ]) {
          const css = getComputedStyle(el)
          if (el.scrollWidth > el.clientWidth + 1)
            problems.push('horizontal overflow')
          if (
            el !== panel &&
            /(auto|scroll|hidden|clip)/.test(css.overflowY) &&
            el.scrollHeight > el.clientHeight + 1
          )
            problems.push('nested scroll or clipping')
        }
        return problems
      }),
    ).toEqual([])
    await expect(
      media.getByRole('button', { name: 'Open recipe', exact: true }),
    ).toBeInViewport()
  })
}
