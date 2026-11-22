import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { blankLabel, newElement } from '../src/lib/label-studio'
import { labelLayout } from '../src/lib/label-sets'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1920, 1280, 1000, 390]) {
  test(`saved label cards and confirmed deletion at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    page.on('dialog', (dialog) => dialog.accept())
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const original = {
      ...blankLabel(),
      id: 'shared-preserved',
      name: 'Preserved market loaf',
      elements: [newElement('text', 'Market loaf')],
      format: 'front-back',
      back: labelLayout({
        ...blankLabel(),
        width: 144,
        height: 216,
        elements: [newElement('text', 'Ingredients on the back')],
      }),
    }
    workspace.label_templates = [
      original,
      ...Array.from({ length: 5 }, (_, i) => ({
        ...blankLabel(),
        id: `label-${i}`,
        name: `Saved loaf label ${i + 1}`,
        workflowVersion: 1,
        recordKind: 'label',
        revision: 1,
        elements: [newElement('text', `Loaf ${i + 1}`)],
      })),
    ]
    workspace.products
      .slice(0, 2)
      .forEach((p) => (p.labelDesignId = original.id))
    workspace.settings[0].labelEditorScope = 'grid-fixture'
    workspace.label_recovery_drafts = [
      {
        id: 'checkpoint',
        name: 'Morning checkpoint',
        savedAt: '2026-11-22T00:00:00Z',
        document: original,
      },
    ]
    let deletions = 0
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const { action, data } = route.request().postDataJSON()
        if (action === 'labelDelete') {
          deletions++
          workspace.label_templates = workspace.label_templates.map((d) =>
            data.ids.includes(d.id)
              ? {
                  ...d,
                  deletedAt: new Date().toISOString(),
                  revision: Number(d.revision || 0) + 1,
                }
              : d,
          )
          workspace.products.forEach((p) => {
            if (data.ids.includes(p.labelDesignId)) delete p.labelDesignId
          })
        }
      }
      await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Labels'))
    const studio = page.locator('.studio-label-library')
    await expect(studio.locator('.studio-label-row')).toHaveCount(6, {
      timeout: 30000,
    })
    const recovery = studio.locator('details.studio-recovery-panel')
    await expect(recovery).not.toHaveAttribute('open', '')
    await expect(
      studio.getByRole('button', { name: 'Delete Selected' }),
    ).toHaveCount(0)
    const geometry = await studio.evaluate((el) => {
      const grid = el.querySelector('.studio-label-list')!,
        toolbar = el.querySelector('.studio-selection-toolbar')!
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        width: grid.clientWidth,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        gap:
          grid.getBoundingClientRect().top -
          toolbar.getBoundingClientRect().bottom,
      }
    })
    expect(geometry.columns).toBe(
      geometry.width >= 1160
        ? 4
        : geometry.width >= 870
          ? 3
          : geometry.width >= 580
            ? 2
            : 1,
    )
    expect(geometry.overflow).toBe(false)
    expect(geometry.gap).toBeLessThan(24)
    await page.screenshot({
      path: `docs/reviews/label-library/labels-${width}.png`,
      fullPage: true,
    })
    if (width === 1920) {
      await studio
        .getByRole('button', {
          name: 'Preview/Print Saved loaf label 1',
          exact: true,
        })
        .click()
      await expect(
        page.getByRole('button', { name: 'Print labels', exact: true }),
      ).toBeVisible()
      await page
        .locator('.label-studio')
        .getByRole('button', { name: 'Labels', exact: true })
        .click()
      await page
        .locator('.studio-label-library')
        .getByRole('button', {
          name: 'Edit Preserved market loaf',
          exact: true,
        })
        .click()
      await expect(page.getByLabel('Label name')).toHaveValue(
        'Preserved market loaf — Copy',
      )
      await page
        .locator('.label-studio')
        .getByRole('button', { name: 'Labels', exact: true })
        .click()
      await page
        .locator('.studio-label-library')
        .getByRole('button', {
          name: 'Duplicate Saved loaf label 1',
          exact: true,
        })
        .click()
      await expect(page.getByLabel('Label name')).toHaveValue(
        'Saved loaf label 1 — Copy',
      )
      await page
        .locator('.label-studio')
        .getByRole('button', { name: 'Labels', exact: true })
        .click()
      await expect(studio.locator('.studio-label-row')).toHaveCount(6)
    }

    await studio
      .getByRole('button', {
        name: 'Delete Preserved market loaf',
        exact: true,
      })
      .click()
    let dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('2 products')
    await expect(dialog).toContainText(workspace.products[0].name)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(deletions).toBe(0)
    await studio
      .getByRole('button', {
        name: 'Delete Preserved market loaf',
        exact: true,
      })
      .click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete label', exact: true })
      .click()
    await expect(studio.locator('.studio-label-row')).toHaveCount(5)
    await page.reload()
    await expect(page.locator('.studio-label-row')).toHaveCount(5)
    expect(workspace.products).toHaveLength(3)
    expect(
      workspace.products.some((p) => p.labelDesignId === original.id),
    ).toBe(false)
    expect(workspace.label_recovery_drafts).toHaveLength(1)
    await page
      .getByRole('checkbox', { name: 'Select All filtered labels' })
      .check()
    await page.getByRole('button', { name: 'Delete Selected' }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete 5 labels', exact: true })
      .click()
    await expect(page.locator('.studio-label-row')).toHaveCount(0)
  })
}
