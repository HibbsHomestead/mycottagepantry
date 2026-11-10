import { test, expect } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { launchPricing } from '../src/lib/launch-plans'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'
import { mkdir } from 'node:fs/promises'

for (const width of [1440, 390]) {
  test(`kit definition save and details at ${width}px`, async ({ page }) => {
    await mkdir('.netlify/screenshots', { recursive: true })
    await page.setViewportSize({ width, height: 950 })
    await installWorkspaceFixture(page)
    const w = demoData()
    const stock = JSON.stringify(w.products.map((p) => [p.id, p.quantity]))
    let saved = false
    await page.route('**/api/workspace*', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        expect(body.action).toBe('save')
        expect(body.table).toBe('products')
        expect(body.data.workflow).toBe('kit')
        const index = w.products.findIndex((p) => p.id === body.data.id)
        if (index < 0) w.products.push(body.data)
        else w.products[index] = body.data
        saved = true
      }
      return route.fulfill({
        json: { workspace: w, role: 'Owner', demo: false },
      })
    })
    await page.goto(workspaceFixtureUrl('Products & Pricing'), {
      waitUntil: 'networkidle',
    })
    await page.getByRole('button', { name: 'Create kit', exact: true }).click()
    await page.getByLabel('Kit name', { exact: true }).fill('Holiday bake drop')
    await page.getByLabel('Add existing product').selectOption(w.products[0].id)
    await page.getByLabel('Add existing product').selectOption(w.products[1].id)
    await page.getByLabel('Whole selling packages').first().fill('2')
    await page
      .getByLabel('Description', { exact: true })
      .fill(
        'Fixed holiday selection. Component products retain their own source statements.',
      )
    await page.getByRole('tab', { name: 'Packaging & cost' }).click()
    const packaging = w.ingredients.find((i) => i.usedAs === 'packaging')!
    await page.getByLabel('Add kit packaging').selectOption(packaging.id)
    await page.getByLabel('Additional assembly minutes').fill('12')
    await page.getByLabel('Assembly hourly rate').fill('18')
    await page.getByLabel('Kit selling price').fill('45')
    await expect(
      page.getByText('Total / sellable kit:', { exact: false }).first(),
    ).toBeVisible()
    await page.screenshot({
      path: `.netlify/screenshots/kit-editor-${width}.png`,
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Save kit', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(saved).toBe(true)
    expect(
      JSON.stringify(
        w.products
          .filter((p) => p.workflow !== 'kit')
          .map((p) => [p.id, p.quantity]),
      ),
    ).toBe(stock)
    await page
      .getByRole('button', { name: 'Holiday bake drop', exact: true })
      .click()
    await expect(page.getByLabel('Whole selling packages').first()).toHaveValue(
      '2',
    )
    await expect(
      page.getByText('Individual unpackaged contents are unavailable', {
        exact: false,
      }),
    ).toBeVisible()
    await page.screenshot({
      path: `.netlify/screenshots/kit-details-${width}.png`,
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  })
  test(`operational business admin at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 })
    const business = {
      id: '10000000-0000-4000-8000-000000000001',
      business_name: 'Disposable acceptance bakery',
      identity_owner: 'fixture-owner',
      created_at: '2026-11-01',
    }
    const effective = {
      plan: null,
      source: 'unassigned',
      assigned: null,
      legacy: true,
      suspended: false,
      manualValid: false,
      access: null,
    }
    let previewed = false
    await page.route('**/api/admin*', async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get('action') === 'session')
        return route.fulfill({
          json: {
            stage: 'authenticated',
            identityId: 'fixture-admin',
            role: 'owner',
            expiresAt: '2027-01-01',
          },
        })
      if (url.searchParams.get('action') === 'business-access') {
        const body = route.request().postDataJSON()
        expect(body.reason).toBe('Disposable test assignment')
        previewed = true
        return route.fulfill({
          json: {
            confirmation: 'fixture-review',
            preview: {
              business,
              current: effective,
              after: {
                ...effective,
                plan: 'cottage-kitchen',
                source: 'test',
                legacy: false,
              },
              source: 'test',
              expiresAt: null,
              billingContinues: false,
              billingNotice:
                'Manual/internal access — no billing subscription. This action creates no payment, invoice or charge.',
            },
          },
        })
      }
      return route.fulfill({
        json: {
          oven: business,
          effective,
          billing: null,
          manualGrant: null,
          manualHistory: [],
          tierCatalog: launchPricing.plans.map((p) => ({
            ...p,
            issue:
              p.id === 'cottage-mercantile'
                ? 'Team allowance needs configuration'
                : null,
          })),
          memberships: [],
          accessAudit: [],
          activity: [],
          accountStatus:
            'One active owner membership. No global suspension field is recorded.',
          billingNotice: 'Billing remains separate.',
        },
      })
    })
    await page.goto('/admin?section=customers&id=' + business.id, {
      waitUntil: 'networkidle',
    })
    await expect(
      page.getByRole('heading', { name: 'Manage internal access' }),
    ).toBeVisible()
    await page.getByLabel('Internal tier').selectOption('cottage-kitchen')
    await page
      .getByLabel('Reason', { exact: true })
      .fill('Disposable test assignment')
    await page.getByRole('button', { name: 'Preview access change' }).click()
    await expect(
      page.getByRole('heading', { name: 'Confirm resolved business' }),
    ).toBeVisible()
    expect(previewed).toBe(true)
    await page.screenshot({
      path: `.netlify/screenshots/operational-admin-${width}.png`,
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  })
}
