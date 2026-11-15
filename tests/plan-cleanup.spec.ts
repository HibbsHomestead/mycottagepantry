import { test, expect } from '@playwright/test'
import { installPublicPlanFixture } from './public-plan-fixture'
import { launchPricing } from '../src/lib/launch-plans'
for (const width of [1440, 390]) {
  test(`compact signup and pricing ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await installPublicPlanFixture(page)
    await page.goto('/pricing')
    const cards = page.locator('.plan-card')
    await expect(cards).toHaveCount(5)
    for (const plan of launchPricing.plans) {
      const card = page.locator(`.plan-card-${plan.id}`)
      await expect(card.locator('.plan-price')).toHaveText(
        `$${plan.monthlyUsd}/month`,
      )
      await expect(card.getByRole('link')).toHaveAttribute(
        'href',
        new RegExp(`plan=${plan.id}`),
      )
    }
    await expect(cards).not.toContainText([
      /LIVE purchases|Included users|verify your email|member administration|checkout after/i,
    ])
    await expect(
      page.getByRole('link', { name: 'Compare all features' }),
    ).toBeVisible()
    await page.screenshot({
      path: `docs/reviews/plan-cleanup/pricing-${width}.png`,
      fullPage: true,
    })
    await page.getByRole('link', { name: 'Compare all features' }).click()
    await expect(
      page.getByRole('heading', { name: 'A closer look at each plan' }),
    ).toBeInViewport()
    await expect(page.locator('.plan-details-table')).toContainText('Partial')
    await expect(page.locator('.plan-details-table')).toContainText(
      'Coming soon',
    )
    await expect(page.locator('.plan-details-table')).toContainText(
      'Not included',
    )
    await page.screenshot({
      path: `docs/reviews/plan-cleanup/comparison-${width}.png`,
    })
    await page.goto('/signup?plan=mixing-bowl')
    for (const plan of launchPricing.plans) {
      await page.getByRole('radio', { name: new RegExp(plan.name) }).check()
      await expect(
        page.getByRole('radio', { name: new RegExp(plan.name) }),
      ).toBeChecked()
      await expect(page).toHaveURL(new RegExp(`plan=${plan.id}`))
    }
    await page.getByRole('radio', { name: /Mixing Bowl/ }).check()
    await expect(
      page.getByText('Payment details are entered securely at checkout.'),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Continue', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Compare plans' }),
    ).toHaveAttribute('href', '/pricing#plan-details-title')
    await expect(page.locator('.registration-paper')).not.toContainText(
      /LIVE|Included users|Proposed record|diagnostic|total users/i,
    )
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: `docs/reviews/plan-cleanup/signup-${width}.png`,
      fullPage: true,
    })
  })
}

test('unavailable checkout stays blocked with one customer notice', async ({
  page,
}) => {
  await installPublicPlanFixture(page, 'bakers-bench')
  await page.goto('/pricing')
  await expect(page.locator('.plan-card-bakers-bench button')).toBeDisabled()
  await expect(page.getByRole('status')).toHaveText(
    /Some paid plans are currently unavailable/,
  )
  await expect(page.locator('.plan-card-mixing-bowl a')).toBeVisible()
  await expect(page.locator('main')).not.toContainText(
    /Price mapping|LIVE purchases|webhook|activation/i,
  )
})
