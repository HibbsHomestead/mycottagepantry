import { test, expect } from '@playwright/test'
import { installWorkspaceFixture } from './workspace-fixture'
test.beforeEach(async ({ page }) => {
  await installWorkspaceFixture(page)
  await page.route('**/calendar-review*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import("/src/test/capture-events.tsx").then(m=>m.mountEventsFixture())</script></body></html>',
    }),
  )
})
test('calendar works on desktop and phones, preserving dates and filters', async ({
  page,
}) => {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/calendar-review#Events/Month')
    const date = await page.getByLabel('Go to date').inputValue()
    await expect(page.locator('.calendar-cell.is-selected')).toHaveCount(1)
    await page.screenshot({
      path: `docs/reviews/events/calendar-month-${width}.png`,
      fullPage: true,
    })
    if (width > 650)
      await page
        .getByRole('button', { name: `Create event on ${date}`, exact: true })
        .click()
    else
      await page
        .locator('.calendar-agenda')
        .getByRole('button', { name: '+ Event', exact: true })
        .click()
    await expect(page.getByLabel('Start date')).toHaveValue(date)
    await page.getByLabel('Event name').fill('New market')
    await page.getByRole('button', { name: 'Save event', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveAccessibleName('New market')
    await page.keyboard.press('Escape')
    await page.getByLabel('Search events').fill('Afternoon')
    for (const view of ['Week', 'Day', 'List', 'Month']) {
      await page.getByRole('link', { name: view, exact: true }).click()
      await expect(
        page.getByRole('link', { name: view, exact: true }),
      ).toHaveAttribute('aria-current', 'page')
      await expect(page.getByLabel('Go to date')).toHaveValue(date)
      await expect(page.getByLabel('Search events')).toHaveValue('Afternoon')
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    }
    await page.getByLabel('Search events').fill('')
    await page.getByRole('link', { name: 'Week', exact: true }).click()
    await expect(
      page.getByRole('link', { name: 'Week', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await page.screenshot({
      path: `docs/reviews/events/calendar-week-${width}.png`,
      fullPage: true,
    })
  }
})
test('drag reschedules only the event', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/calendar-review#Events/Month')
  const date = await page.getByLabel('Go to date').inputValue()
  const next = new Date(date + 'T12:00:00Z')
  next.setUTCDate(next.getUTCDate() + 1)
  const target = next.toISOString().slice(0, 10)
  await page
    .locator('.calendar-cell')
    .filter({
      has: page.getByRole('button', { name: `Select ${date}`, exact: true }),
    })
    .getByRole('button', { name: /Harvest market/ })
    .dragTo(
      page.locator('.calendar-cell').filter({
        has: page.getByRole('button', {
          name: `Select ${target}`,
          exact: true,
        }),
      }),
    )
  await expect(
    page.getByRole('status').filter({ hasText: 'Event rescheduled' }),
  ).toBeVisible()
  await page.getByLabel('Go to date').fill(target)
  await page
    .locator('.calendar-agenda')
    .getByRole('button', { name: /^Harvest market/ })
    .click()
  await page.getByRole('button', { name: 'Edit event', exact: true }).click()
  await expect(page.getByLabel('Start date')).toHaveValue(target)
})

test('failed drag restores the original schedule', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/calendar-review?failSave=1#Events/Month')
  const date = await page.getByLabel('Go to date').inputValue()
  const source = page.locator('.calendar-cell').filter({
    has: page.getByRole('button', { name: `Select ${date}`, exact: true }),
  })
  const target = page
    .locator('.calendar-cell')
    .filter({
      hasNot: page.getByRole('button', { name: `Select ${date}`, exact: true }),
    })
    .first()
  await source.getByRole('button', { name: /Harvest market/ }).dragTo(target)
  await expect(page.getByRole('alert')).toContainText(
    'original schedule is unchanged',
  )
  await expect(
    source.getByRole('button', { name: /Harvest market/ }),
  ).toBeVisible()
})

test('timed slots, overlapping events, resize, and accessible editing share the schedule', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/calendar-review?theme=orchard&mode=dark#Events/Day')
  const date = await page.getByLabel('Go to date').inputValue()
  await expect(page.locator('.calendar-positioned-event')).toHaveCount(2)
  const positions = await page
    .locator('.calendar-positioned-event')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).style.width))
  expect(positions).toEqual(['50%', '50%'])
  await expect(page.locator('.calendar-now')).toHaveCount(1)
  await page
    .getByRole('button', { name: `Create event ${date} 10:30`, exact: true })
    .evaluate((node: HTMLButtonElement) => node.click())
  await expect(page.getByLabel('Start time')).toHaveValue('10:30')
  await expect(page.getByLabel('End time')).toHaveValue('11:30')
  page.once('dialog', (d) => d.accept())
  await page.keyboard.press('Escape')
  const handle = page.getByRole('button', { name: /Resize Harvest/ })
  await handle.evaluate((node) =>
    node.dispatchEvent(
      new DragEvent('dragstart', {
        bubbles: true,
        dataTransfer: new DataTransfer(),
      }),
    ),
  )
  await page.locator('.calendar-time-day').evaluate((node) => {
    const box = node.getBoundingClientRect()
    node.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientY: box.top + 15 * 60,
        dataTransfer: new DataTransfer(),
      }),
    )
  })
  await expect(
    page.getByRole('status').filter({ hasText: 'Event rescheduled' }),
  ).toBeVisible()
  await page
    .locator('.calendar-positioned-event')
    .getByRole('button', { name: /^Harvest market/ })
    .click()
  await page.getByRole('button', { name: 'Edit event', exact: true }).click()
  await expect(page.getByLabel('End time')).toHaveValue('15:00')
  page.once('dialog', (d) => d.accept())
  await page.keyboard.press('Escape')
  await page.screenshot({
    path: 'docs/reviews/events/calendar-day-dark-1440.png',
    fullPage: true,
  })
})
