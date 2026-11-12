import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import {
  installSessionJourney,
  signIn,
  appReady,
} from './session-journey-fixture'

test('phone login → oven → deep link → logout cancel/confirm → signed out', async ({
  page,
  context,
}) => {
  const state = await installSessionJourney(context)
  await mkdir('docs/reviews/mobile-session', { recursive: true })
  await page.goto('/oven#Inventory/Counts')
  await expect(page).toHaveURL(/\/login\?/)
  await expect(page.locator('.access-technical')).toHaveCount(0)
  const documents = state.documents
  for (const [label, autocomplete] of [
    ['Email', 'username'],
    ['Password', 'current-password'],
  ]) {
    const field = page.getByLabel(label, { exact: true })
    await expect(field).toHaveAttribute('autocomplete', autocomplete)
    expect(
      await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16)
    await field.focus()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
  }
  await page.screenshot({ path: 'docs/reviews/mobile-session/login-390.png' })
  // Hold business access only until the existing oven is visibly pending.
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/workspace', async (route) => {
    await waiting
    await route.fallback()
  })
  await signIn(page)
  await expect(
    page.getByRole('heading', { name: 'Opening your oven…' }),
  ).toBeVisible()
  await expect(page.locator('.opening-oven')).toBeVisible()
  await page.screenshot({ path: 'docs/reviews/mobile-session/oven-390.png' })
  release()
  await appReady(page)
  await expect(page).toHaveURL(/\/oven\?.*#Inventory\/Counts$/)
  expect(state.documents).toBe(documents) // browser-side auth needs no document reload
  expect(state.passwords).toBe(1)
  await expect(page.locator('.public-header')).toHaveCount(0)
  await page.getByRole('button', { name: 'Profile menu' }).click()
  await page.getByRole('menuitem', { name: 'Account & sign in' }).click()
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('heading', { name: 'Log out of Cottage Pantry?' }),
  ).toBeVisible()
  const b = (await dialog.boundingBox())!
  expect(b.x).toBeGreaterThanOrEqual(0)
  expect(b.x + b.width).toBeLessThanOrEqual(390)
  for (const name of ['Cancel', 'Log out'])
    await expect(
      dialog.getByRole('button', { name, exact: true }),
    ).toBeInViewport({ ratio: 1 })
  await expect(page.locator('.mobile-bottom-nav')).toBeHidden()
  await page.screenshot({ path: 'docs/reviews/mobile-session/logout-390.png' })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.mobile-bottom-nav')).toBeVisible()
  expect(state.signedIn).toBe(true)
  await page.getByRole('button', { name: 'Profile menu' }).click()
  await page.getByRole('menuitem', { name: 'Account & sign in' }).click()
  await page.getByRole('button', { name: 'Log out', exact: true }).click()
  await expect(page).toHaveURL(/\/login\?signedOut=1$/)
  await expect(page.getByText('You’re signed out.')).toBeVisible()
  expect(
    (await context.cookies()).some((c) =>
      ['nf_jwt', 'nf_refresh'].includes(c.name),
    ),
  ).toBe(false)
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Log in', exact: true }),
  ).toBeVisible()
  expect(state.signedIn).toBe(false)
  expect(state.writes).toBe(0)
  const video = page.video()!
  await page.close()
  await video.saveAs('docs/reviews/mobile-session/login-logout-390.webm')
})

test('provider session survives reload, tab reopen without cookies, offline restore and membership failure', async ({
  page,
  context,
}) => {
  const state = await installSessionJourney(context)
  await page.goto('/login')
  await signIn(page)
  await appReady(page)
  await page.reload()
  await appReady(page)
  const passwords = state.passwords
  // Session cookies disappear on browser exit; the SDK's existing storage stays.
  await context.clearCookies({ name: /^nf_(jwt|refresh)$/ })
  await page.close()
  const returning = await context.newPage()
  state.refreshFailure = 503
  await returning.goto('/oven#Recipes')
  await expect(
    returning.getByRole('heading', { name: 'Oven unavailable' }),
  ).toBeVisible()
  expect(state.passwords).toBe(passwords)
  state.refreshFailure = 0
  await returning.getByRole('button', { name: 'Retry oven access' }).click()
  await appReady(returning)
  expect(state.refreshes).toBeGreaterThanOrEqual(2)
  state.membershipFailure = true
  await returning.reload()
  await expect(
    returning.getByRole('heading', { name: 'Oven unavailable' }),
  ).toBeVisible()
  expect((await context.cookies()).some((c) => c.name === 'nf_jwt')).toBe(true)
  state.membershipFailure = false
  await returning.getByRole('button', { name: 'Retry oven access' }).click()
  await appReady(returning)
  // A background return failure retains the mounted workspace and its drafts.
  state.workspaceFailure = true
  await returning.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(returning.getByRole('alert')).toContainText(
    'Connection interrupted',
  )
  await appReady(returning)
  state.workspaceFailure = false
  await returning.getByRole('button', { name: 'Retry connection' }).click()
  await expect(returning.getByRole('alert')).toHaveCount(0)
  expect(state.passwords).toBe(passwords)
})

test('invalid credentials remain inline; revoked provider refresh returns to login', async ({
  page,
  context,
}) => {
  const state = await installSessionJourney(context)
  state.invalid = true
  await page.goto('/login')
  await signIn(page)
  await expect(page.getByRole('alert')).toContainText('couldn’t sign you in')
  await expect(
    page.getByRole('button', { name: 'Log in', exact: true }),
  ).toBeVisible()
  state.invalid = false
  await signIn(page)
  await appReady(page)
  const beforeRefresh = state.refreshes
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('gotrue.user')!)
    const claims = btoa(
      JSON.stringify({
        sub: 'session-fixture',
        exp: Math.floor(Date.now() / 1000) - 60,
      }),
    ).replace(/=/g, '')
    const expired = `synthetic.${claims}.fixture`
    stored.token.access_token = expired
    stored.token.expires_at = Date.now() - 60000
    localStorage.setItem('gotrue.user', JSON.stringify(stored))
    document.cookie = `nf_jwt=${encodeURIComponent(expired)}; path=/; secure; samesite=lax`
  })
  await page.reload()
  await appReady(page)
  await expect.poll(() => state.refreshes).toBe(beforeRefresh + 1)
  await context.clearCookies({ name: /^nf_(jwt|refresh)$/ })
  state.revoked = true
  state.signedIn = false
  await page.goto('/oven')
  await expect(
    page.getByRole('button', { name: 'Log in', exact: true }),
  ).toBeVisible()
})

test('multiple authorized businesses require a choice', async ({
  page,
  context,
}) => {
  const state = await installSessionJourney(context)
  state.selection = true
  await page.goto('/login')
  await signIn(page)
  await expect(
    page.getByRole('heading', { name: 'Choose your oven' }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Second authorized bakery · Owner' })
    .click()
  await appReady(page)
})
