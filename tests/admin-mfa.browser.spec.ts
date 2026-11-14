import { expect, test } from '@playwright/test'

// Fail any attempted public-key ceremony, even if its button is not visible.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { credentialPrompts: number }
    state.credentialPrompts = 0
    for (const operation of ['get', 'create']) {
      Object.defineProperty(navigator.credentials, operation, {
        configurable: true,
        value: () => {
          state.credentialPrompts++
          throw new Error('Device credential prompt is forbidden')
        },
      })
    }
  })
})
test.afterEach(async ({ page }) => {
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { credentialPrompts: number }).credentialPrompts,
    ),
  ).toBe(0)
})

// UI compatibility only. All API responses are fixtures; this does not test a
// production password or claim owner acceptance.
test.describe('admin password sign-in UI', () => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
  ]) {
    test(`password retry, dashboard and logout at ${viewport.width}px`, async ({
      page,
      browser,
      browserName,
    }) => {
      console.log(
        `UI fixture browser: ${browserName} ${browser.version()}, runner OS: ${process.platform}`,
      )
      await page.setViewportSize(viewport)
      let stage = 'signed_out',
        attempts = 0
      await page.route('**/api/admin*', async (route) => {
        const url = new URL(route.request().url()),
          action = url.searchParams.get('action')
        const json = (data: unknown, status = 200) =>
          route.fulfill({ status, json: data })
        if (action === 'session')
          return stage === 'signed_out'
            ? json({ error: 'Sign in required' }, 401)
            : json({
                stage,
                totpEnabled: true,
                totpAvailable: true,
                identityId: 'fixture-owner',
                role: 'owner',
                credentials: [
                  {
                    transports: ['internal', 'hybrid'],
                    createdAt: '2026-01-01T00:00:00Z',
                  },
                ],
                expiresAt: '2027-01-01T00:00:00Z',
              })
        if (action === 'login') {
          attempts++
          if (attempts === 1)
            return json(
              {
                error:
                  'Sign-in failed. Check your email, password, and administrator access.',
              },
              401,
            )
          stage = 'authenticated'
          return json({ stage })
        }
        if (action === 'logout') {
          stage = 'signed_out'
          return json({ stage })
        }
        if (action)
          throw new Error('Unexpected authentication request: ' + action)
        return json({
          totals: { customer_accounts: 0, ovens: 0, recent_accounts: 0 },
          definitions: {},
          subscriptions: [],
          recent: [],
          activity: [],
          asOf: '2026-11-05T00:00:00Z',
        })
      })
      await page.goto('/admin')
      await page
        .getByLabel('Email address', { exact: true })
        .fill('fixture@example.invalid')
      await page
        .getByLabel('Password', { exact: true })
        .fill('fixture-password')
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('Sign-in failed')
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue('')
      await page
        .getByLabel('Password', { exact: true })
        .fill('fixture-password')
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await expect(
        page.getByText('Customer accounts', { exact: true }),
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Prepare passkey options' }),
      ).toHaveCount(0)
      await expect(
        page.getByLabel('Authenticator code', { exact: true }),
      ).toHaveCount(0)
      await expect(
        page.getByText('Admin sign-in security', { exact: true }),
      ).toHaveCount(0)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true)
      await page.getByRole('button', { name: 'Sign out', exact: true }).click()
      await expect(
        page.getByRole('button', { name: 'Sign in', exact: true }),
      ).toBeVisible()
      await expect(
        page.getByText('Customer accounts', { exact: true }),
      ).toHaveCount(0)
    })
  }
})

// These responses exercise the UI only. The database suite checks real authorization.
for (const width of [390, 820, 1440]) {
  test(`password reverification rejects and retries without a device prompt at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    let verified = false,
      attempts = 0
    await page.route('**/api/admin*', async (route) => {
      const action = new URL(route.request().url()).searchParams.get('action')
      if (action === 'session')
        return route.fulfill({
          json: {
            stage: 'authenticated',
            role: 'owner',
            identityId: 'fixture-admin',
            expiresAt: '2027-01-01',
            totpEnabled: false,
            totpAvailable: false,
            verificationCurrent: verified,
            verificationMethod: verified ? 'password' : null,
          },
        })
      if (action === 'password-verify') {
        attempts++
        if (attempts === 1)
          return route.fulfill({
            status: 401,
            json: { error: 'Password verification failed.' },
          })
        verified = true
        return route.fulfill({ json: { stage: 'authenticated' } })
      }
      if (action) throw new Error('Unexpected authentication action: ' + action)
      return route.fulfill({
        json: {
          totals: { customer_accounts: 0, ovens: 0, recent_accounts: 0 },
          definitions: {},
          subscriptions: [],
          recent: [],
          activity: [],
          asOf: '2026-11-14',
        },
      })
    })
    await page.goto('/admin')
    await page
      .getByText('Verify existing admin authentication for sensitive actions', {
        exact: true,
      })
      .click()
    await page
      .getByRole('button', { name: 'Check verification methods' })
      .click()
    const password = page.getByLabel('Current administrator password')
    await password.fill('fixture-wrong-password')
    await page
      .getByRole('button', { name: 'Verify password', exact: true })
      .click()
    await expect(page.getByRole('status')).toHaveText(
      'Password verification failed.',
    )
    await expect(password).toHaveValue('')
    await password.fill('fixture-password')
    await Promise.all([
      page.waitForEvent('load'),
      page
        .getByRole('button', { name: 'Verify password', exact: true })
        .click(),
    ])
    expect(verified).toBe(true)
    await page
      .getByText('Verify existing admin authentication for sensitive actions', {
        exact: true,
      })
      .click()
    await page
      .getByRole('button', { name: 'Check verification methods' })
      .click()
    await expect(
      page.getByText('Current verification: password', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /passkey|security.key/i }),
    ).toHaveCount(0)
  })
}
