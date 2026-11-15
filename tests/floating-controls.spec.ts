import { demoData } from '../src/lib/demo'
import { test, expect } from '@playwright/test'
import {
  installWorkspaceFixture,
  workspaceFixtureUrl,
} from './workspace-fixture'

for (const width of [1440, 390])
  test(`fixed assistant dock at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await installWorkspaceFixture(page)
    await page.route('**/api/workspace*', (r) =>
      r.fulfill({
        json: { workspace: demoData(), role: 'Owner', demo: false },
      }),
    )
    await page.route('**/api/support*', (r) =>
      r.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'AI is unavailable right now. Please contact support.',
        }),
      }),
    )
    await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
    const bubble = page.getByRole('button', {
      name: 'Open assistant',
      exact: true,
    })
    const top = page.getByRole('button', { name: 'Back to top', exact: true })
    await expect(bubble).toBeVisible()
    await expect(top).toBeHidden()
    // Extend the actual page to exercise a long viewport without provider requests.
    await page.evaluate(() => {
      const content = document.createElement('div')
      content.style.height = '2200px'
      document.querySelector('main')?.append(content)
      window.scrollTo(0, 750)
    })
    await expect(top).toBeVisible()
    const initial = await top.boundingBox()
    const bubbleInitial = await bubble.boundingBox()
    await page.evaluate(() => window.scrollTo(0, 900))
    expect(await top.boundingBox()).toEqual(initial)
    expect(await bubble.boundingBox()).toEqual(bubbleInitial)
    await page.screenshot({
      path: `docs/screenshots/floating-controls-${width}.png`,
    })
    await bubble.focus()
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('button', { name: 'Minimize assistant' }),
    ).toBeVisible()
    await expect(top).toBeHidden()
    await expect(
      page.getByRole('link', { name: 'Contact support without AI' }),
    ).toBeVisible()
    await page.screenshot({
      path: `docs/screenshots/assistant-open-${width}.png`,
    })
    await page.getByRole('button', { name: 'Minimize assistant' }).click()
    await expect(top).toBeVisible()
    expect(await top.boundingBox()).toEqual(initial)
    await bubble.click()
    await page.keyboard.press('Escape')
    await expect(bubble).toBeFocused()
    await top.click()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await expect(top).toBeHidden()
    expect(await bubble.boundingBox()).toEqual(bubbleInitial)
    // Blocking dialogs hide the dock without unmounting the assistant.
    await page.evaluate(() => {
      const modal = document.createElement('div')
      modal.role = 'dialog'
      modal.dataset.state = 'open'
      modal.id = 'blocking-fixture'
      document.body.append(modal)
    })
    await expect(bubble).toBeHidden()
    await page.evaluate(() =>
      document.getElementById('blocking-fixture')?.remove(),
    )
    await expect(bubble).toBeVisible()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })

test('preserves a draft when minimized and through navigation and a small keyboard viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 850 })
  await installWorkspaceFixture(page)
  await page.route('**/api/workspace*', (r) =>
    r.fulfill({ json: { workspace: demoData(), role: 'Owner', demo: false } }),
  )
  await page.route('**/api/support*', (r) =>
    r.fulfill({
      json: {
        conversations: [],
        policy: {
          enabled: false,
          retentionDays: 30,
          userDaily: 20,
          businessDaily: 60,
          cooldownSeconds: 10,
        },
      },
    }),
  )
  await page.goto(workspaceFixtureUrl('Inventory/Ingredients'))
  const bubble = page.getByRole('button', {
    name: 'Open assistant',
    exact: true,
  })
  await bubble.click()
  const question = page.getByRole('textbox', { name: 'Your app question' })
  await question.fill('Help me check my saved timezone')
  await page.getByRole('button', { name: 'Minimize assistant' }).click()
  await page.evaluate(() => {
    location.hash = 'Dashboard'
  })
  await expect(bubble).toHaveAttribute('aria-expanded', 'false')
  await bubble.click()
  await expect(question).toHaveValue('Help me check my saved timezone')
  await page.setViewportSize({ width: 390, height: 440 })
  await question.focus()
  const close = page.getByRole('button', { name: 'Close assistant' })
  await expect(close).toBeInViewport()
  await close.click()
  await expect(bubble).toBeFocused()
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
