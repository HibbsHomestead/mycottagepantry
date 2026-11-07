import { expect, test } from '@playwright/test'

// UI compatibility only. All API responses are fixtures; this does not test a
// production password or claim owner acceptance.
test.describe('admin password sign-in UI', () => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
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
