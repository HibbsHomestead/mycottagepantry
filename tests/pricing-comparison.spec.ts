import { test, expect } from '@playwright/test'

for (const [id, name] of [
  ['free', 'Free'],
  ['mixing-bowl', 'Mixing Bowl'],
  ['bakers-bench', 'Baker’s Bench'],
  ['cottage-kitchen', 'Cottage Kitchen'],
  ['cottage-mercantile', 'Cottage Mercantile'],
]) {
  test(`pricing continues to registration and sign-in with ${id} selected`, async ({
    page,
  }) => {
    await page.goto('/pricing')
    await page
      .getByRole('link', {
        name: id === 'free' ? 'Get Started Free' : `Choose ${name}`,
        exact: true,
      })
      .click()
    await expect(page).toHaveURL(new RegExp(`/signup\\?plan=${id}$`))
    await expect(
      page.locator(`input[name="plan-choice"][value="${id}"]`),
    ).toBeChecked()
    await expect(
      page.getByRole('link', { name: 'Already have an account? Log in.' }),
    ).toHaveAttribute('href', `/login?plan=${id}`)
    await expect(
      page
        .getByText('Paid activation is not yet available.', { exact: false })
        .first(),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /subscribe|checkout|buy/i }),
    ).toHaveCount(0)
  })
}

for (const width of [1440, 1190, 1024, 768, 390, 320]) {
  test(`five pricing tiers, visible limits and safe CTAs at ${width}px`, async ({
    page,
  }) => {
    let workspaceRequests = 0
    await page.route('**/api/workspace*', (route) => {
      workspaceRequests++
      return route.abort()
    })
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/pricing', { waitUntil: 'networkidle' })
    const cards = page.locator('.plan-card')
    await expect(cards).toHaveCount(5)
    for (const card of await cards.all()) {
      await expect(card.locator('li')).toHaveCount(6)
      await expect(card.locator('.plan-limits')).toBeVisible()
      await expect(card.locator('.plan-card-footer a')).toHaveAttribute(
        'href',
        /\/signup\?plan=/,
      )
      expect(
        await card.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true)
    }
    await expect(page.locator('.plan-card-cottage-kitchen')).toContainText(
      '2 total users, including the owner',
    )
    await expect(page.locator('.plan-card-cottage-kitchen')).toContainText(
      'Excludes resale and consignment',
    )
    await expect(page.locator('.plan-card-cottage-mercantile')).toContainText(
      '$40',
    )
    await expect(page.locator('.plan-card-cottage-mercantile')).toContainText(
      'Team user limit awaiting confirmation',
    )
    await expect(
      page.locator('.plan-card-cottage-mercantile'),
    ).not.toContainText(/5 total|unlimited users/)
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.locator('a[href*="checkout"]')).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
    if (width === 1440) {
      const boxes = await cards.evaluateAll((nodes) =>
        nodes.map((node) => ({
          top: node.getBoundingClientRect().top,
          width: node.getBoundingClientRect().width,
        })),
      )
      expect(new Set(boxes.map((b) => Math.round(b.top))).size).toBe(1)
      expect(Math.min(...boxes.map((b) => b.width))).toBeGreaterThan(220)
    }
    if (width <= 390) {
      const region = page.locator('.plan-table-scroll')
      expect(
        await region.evaluate((node) => node.scrollWidth > node.clientWidth),
      ).toBe(true)
      await region.evaluate((node) => {
        node.scrollLeft = node.scrollWidth
      })
      await page
        .getByRole('columnheader', { name: /Cottage Mercantile/ })
        .scrollIntoViewIfNeeded()
      await expect(
        page.getByRole('columnheader', { name: /Cottage Mercantile/ }),
      ).toBeInViewport()
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({
      path: `/tmp/cottage-pricing-approved-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
    expect(workspaceRequests).toBe(0)
  })
}

test('signup displays both upper tiers without enabling paid activation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 960 })
  await page.goto('/signup', { waitUntil: 'networkidle' })
  await expect(page.locator('input[name="plan-choice"]')).toHaveCount(5)
  for (const plan of [
    'mixing-bowl',
    'bakers-bench',
    'cottage-kitchen',
    'cottage-mercantile',
  ])
    await expect(page.locator(`input[value="${plan}"]`)).toBeEnabled()
  await expect(page.locator('input[value="free"]')).toBeChecked()
  await expect(page.locator('.signup-plan-choice')).toContainText(
    '2 total users, including the owner',
  )
  await expect(page.locator('.signup-plan-choice')).toContainText(
    'Team user limit awaiting confirmation',
  )
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1)
})
