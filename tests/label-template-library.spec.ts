import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  blankLabel,
  newElement,
  systemLabelTemplates,
  type LabelDocument,
} from '../src/lib/label-studio'
import { labelContent } from '../src/lib/label-persistence'
import { copyLabelDesign } from '../src/lib/label-library'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390]) {
  test(`stock template removal is confirmed and preserves its saved label at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    const starter = systemLabelTemplates[0]
    const saved = {
      ...copyLabelDesign(starter, 'label', 'Saved before removal'),
      revision: 1,
    }
    workspace.label_templates = [saved]
    workspace.settings[0].labelEditorScope = 'stock-removal-scope'
    workspace.label_recovery_drafts = []
    let removals = 0
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const { action, data } = route.request().postDataJSON()
        expect(action).toBe('labelDelete')
        expect(data).toMatchObject({
          ids: [starter.id],
          recordKind: 'template',
        })
        removals++
        workspace.label_templates.push({
          ...starter,
          recordKind: 'template',
          deletedAt: new Date().toISOString(),
          revision: 1,
        })
      }
      await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Labels'))
    const studio = page.locator('.label-studio')
    await studio.getByRole('button', { name: 'Templates', exact: true }).click()
    await studio
      .getByRole('button', { name: 'Delete ' + starter.name, exact: true })
      .click()
    const modal = page.getByRole('dialog')
    await expect(modal).toContainText('Delete “Homestead bold”?')
    await expect(modal).toContainText('only from this oven')
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(removals).toBe(0)
    await expect(
      studio.getByRole('button', {
        name: 'Preview ' + starter.name,
        exact: true,
      }),
    ).toBeVisible()
    await studio
      .getByRole('button', { name: 'Delete ' + starter.name, exact: true })
      .click()
    await modal
      .getByRole('button', { name: 'Delete template', exact: true })
      .click()
    await expect(modal).toHaveCount(0)
    await expect(
      studio.getByRole('button', {
        name: 'Preview ' + starter.name,
        exact: true,
      }),
    ).toHaveCount(0)
    await page.reload()
    await studio.getByRole('button', { name: 'Templates', exact: true }).click()
    await expect(
      studio.getByRole('button', {
        name: 'Preview ' + starter.name,
        exact: true,
      }),
    ).toHaveCount(0)
    await studio
      .getByRole('button', { name: 'Saved Labels', exact: true })
      .click()
    await studio
      .getByRole('button', { name: 'Open label', exact: true })
      .click()
    await expect(studio.getByLabel('Label name', { exact: true })).toHaveValue(
      saved.name,
    )
    expect(
      workspace.label_templates.find((t) => t.id === saved.id)?.elements,
    ).toEqual(saved.elements)
    expect(removals).toBe(1)
  })
}

// Real UI with synthetic API responses. Database persistence is covered separately
// by label-recovery-database.test.ts; no customer records are written here.
for (const width of [1440, 390, 320]) {
  test(`template save/update and confirmed label deletion at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 })
    await installWorkspaceFixture(page)
    const workspace = demoData()
    workspace.settings[0].labelEditorScope = 'synthetic-library-scope'
    workspace.label_recovery_drafts = []
    workspace.label_templates = [
      'Bread one',
      'Bread two',
      'Cookies',
      'Muffins',
    ].map((name, index) => ({
      ...blankLabel(),
      id: `saved-label-${index}`,
      name,
      revision: 1,
      tags: [],
      elements: [
        { ...newElement('text', 'Bread'), font: 'Lora', rotation: 180 },
        { ...newElement('text', '', 'recipe.ingredients'), y: 80 },
        {
          ...newElement('image'),
          binding: 'business.logo',
          width: 50,
          height: 40,
        },
      ],
    }))
    const source = structuredClone(
      workspace.label_templates[0],
    ) as LabelDocument
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const { action, data } = route.request().postDataJSON()
        if (action === 'labelSave') {
          const previous = workspace.label_templates.find(
            (t) => t.id === data.document.id,
          )
          if (previous?.lastSaveOperationId !== data.operationId)
            workspace.label_templates = [
              ...workspace.label_templates.filter(
                (t) => t.id !== data.document.id,
              ),
              {
                ...data.document,
                revision: (previous?.revision || 0) + 1,
                savedAt: new Date().toISOString(),
                lastSaveOperationId: data.operationId,
              },
            ]
        }
        if (action === 'labelDelete')
          workspace.label_templates = workspace.label_templates.map((t) =>
            data.ids.includes(t.id)
              ? {
                  ...t,
                  revision: t.revision + 1,
                  deletedAt: new Date().toISOString(),
                }
              : t,
          )
      }
      await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
    })
    await page.goto(workspaceFixtureUrl('Labels'))
    const studio = page.locator('.label-studio')
    await studio
      .getByRole('button', { name: 'Saved Labels', exact: true })
      .click()
    const bread = studio.getByRole('article').filter({
      has: page.getByRole('heading', { name: 'Bread one', exact: true }),
    })
    await bread.getByRole('button', { name: 'Open label', exact: true }).click()
    await studio
      .getByRole('button', { name: 'Save as New Template', exact: true })
      .click()
    const modal = page.getByRole('dialog')
    await modal.getByLabel('Template name').fill('Market bread master')
    await modal
      .getByRole('button', { name: 'Save template', exact: true })
      .click()
    await expect(modal).toHaveCount(0)
    await expect(studio.getByLabel('Template name')).toHaveValue(
      'Market bread master',
    )
    const template = workspace.label_templates.find(
      (t) => t.recordKind === 'template',
    )!
    expect(template.elements).toEqual(source.elements)
    await studio.getByLabel('Template name').fill('Market bread reusable')
    await studio
      .getByRole('button', { name: 'Update Template', exact: true })
      .click()
    await expect(studio.getByText(/updated in your oven/)).toBeVisible()
    expect(
      workspace.label_templates.filter((t) => t.recordKind === 'template'),
    ).toHaveLength(1)
    expect(
      workspace.label_templates.find((t) => t.id === template.id)?.revision,
    ).toBe(2)
    await studio
      .getByRole('button', { name: 'Template library', exact: true })
      .click()
    expect(
      workspace.label_templates.filter((t) => t.recordKind !== 'template'),
    ).toHaveLength(4)
    expect(
      labelContent(
        workspace.label_templates.find(
          (t) => t.id === source.id,
        ) as LabelDocument,
      ),
    ).toBe(labelContent(source))
    await studio
      .getByRole('button', { name: 'Saved Labels', exact: true })
      .click()
    const cookies = studio
      .getByRole('article')
      .filter({
        has: page.getByRole('heading', { name: 'Cookies', exact: true }),
      })
    await cookies
      .getByRole('button', { name: 'Open label', exact: true })
      .click()
    await studio
      .getByRole('button', { name: 'Saved Labels', exact: true })
      .click()
    await studio
      .getByRole('button', { name: 'Delete Cookies', exact: true })
      .click()
    await expect(modal).toContainText('Delete “Cookies”?')
    await expect(modal).toContainText('The open design is included')
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      studio.getByRole('heading', { name: 'Cookies', exact: true }),
    ).toBeVisible()
    await studio
      .getByRole('button', { name: 'Delete Cookies', exact: true })
      .click()
    await modal
      .getByRole('button', { name: 'Delete label', exact: true })
      .click()
    await expect(modal).toHaveCount(0)
    await expect(studio.getByRole('button', { name: /^Editor/ })).toHaveCount(0)
    await studio.getByPlaceholder('Find your style…').fill('Bread')
    await studio
      .getByRole('checkbox', { name: 'Select All filtered labels' })
      .check()
    await expect(
      studio.getByText('2 selected · 2 matching labels'),
    ).toBeVisible()
    await studio
      .getByRole('button', { name: 'Delete Selected', exact: true })
      .click()
    await expect(modal).toContainText('Delete these 2 selected labels?')
    expect(
      await modal.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await modal
      .getByRole('button', { name: 'Delete 2 labels', exact: true })
      .click()
    await expect(modal).toHaveCount(0)
    await expect(
      studio.getByText('0 selected · 0 matching labels'),
    ).toBeVisible()
    await page.reload()
    await expect(
      studio.getByRole('button', { name: 'Saved Labels', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await studio.getByRole('button', { name: 'Templates', exact: true }).click()
    await expect(
      studio.getByRole('heading', { name: 'Market bread reusable' }),
    ).toBeVisible()
    await studio
      .getByRole('button', { name: 'Saved Labels', exact: true })
      .click()
    await expect(
      studio.getByRole('heading', { name: 'Muffins', exact: true }),
    ).toBeVisible()
    await expect(studio.getByRole('article')).toHaveCount(1)
    expect(
      await studio.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: `/tmp/label-library-${width}.png`,
      fullPage: true,
    })
    await studio.getByRole('button', { name: 'Templates', exact: true }).click()
    expect(
      await studio.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: `/tmp/template-library-${width}.png`,
      fullPage: true,
    })
  })
}
