import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
for (const width of [1440, 390]) {
  test(`main navigation keeps input stock tabs local and preserves legacy links (${width})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    await installWorkspaceFixture(page)
    const writes: unknown[] = []
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST')
        writes.push(route.request().postDataJSON())
      return route.fulfill({
        json: {
          workspace: demoData(),
          role: 'Read-only Accountant',
          demo: false,
        },
      })
    })
    await page.goto(workspaceFixtureUrl('Pantry/Packaging'))
    await expect(page).toHaveURL(/#Inventory\/Packaging$/)
    await expect(
      page
        .getByRole('navigation', { name: 'Inventory tabs' })
        .getByRole('link', { name: 'Packaging', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    const nav = page.getByRole('navigation', {
      name: 'Primary navigation',
      exact: true,
    })
    if (width < 1025)
      await page
        .getByRole('button', { name: 'Open navigation', exact: true })
        .click()
    await expect(nav.getByRole('link')).toHaveText([
      'Dashboard',
      'Inventory',
      'Recipes',
      'Products',
      'Production',
      'Sales',
      'Purchasing',
      'Labels',
      'Finance',
      'Settings',
    ])
    await expect(nav.locator('details')).toHaveCount(0)
    await expect(
      nav.getByRole('link', { name: 'Inventory', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await nav.getByRole('link', { name: 'Production', exact: true }).click()
    await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/)
    await page
      .getByRole('navigation', { name: 'Production tabs' })
      .getByRole('link', { name: 'Recipes & Designs' })
      .click()
    await expect(page).toHaveURL(/#Production\/Recipes%20%26%20Designs$/)
    await expect(
      nav.getByRole('link', { name: 'Recipes', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await expect(
      nav.getByRole('link', { name: 'Production', exact: true }),
    ).not.toHaveAttribute('aria-current')
    await expect(
      page.getByRole('textbox', { name: 'Search recipes' }),
    ).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.goBack()
    await expect(page).toHaveURL(/#Production\/Overview$/)
    await page.goBack()
    await expect(page).toHaveURL(/#Inventory\/Packaging$/)
    await expect(
      page
        .getByRole('navigation', { name: 'Inventory tabs' })
        .getByRole('link', { name: 'Packaging', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    if (width < 1025) {
      const mobileNav = page.getByRole('navigation', {
        name: 'Mobile navigation',
      })
      await expect(mobileNav.getByRole('button')).toHaveText([
        'Dashboard',
        'Inventory',
        'Recipes',
        'Products',
        'More',
      ])
      await mobileNav
        .getByRole('button', { name: 'Recipes', exact: true })
        .click()
      await expect(
        mobileNav.getByRole('button', { name: 'Recipes', exact: true }),
      ).toHaveAttribute('aria-current', 'page')
    } else {
      await nav.getByRole('link', { name: 'Recipes', exact: true }).click()
    }
    await expect(page).toHaveURL(/#Production\/Recipes%20%26%20Designs$/)
    await expect(
      page.getByRole('textbox', { name: 'Search recipes' }),
    ).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(writes).toEqual([])
  })
}
