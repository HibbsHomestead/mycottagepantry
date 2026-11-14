import { test, expect } from '@playwright/test'
import { installInventoryPackageFixture } from './inventory-package-fixture'
import { workspaceFixtureUrl } from './workspace-fixture'
import { supportAiDefaults } from '../src/lib/support-ai'
for (const width of [390, 820, 1440]) {
  test(`compact table, support and active-scroll Back to top at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const w = await installInventoryPackageFixture(page)
    const longName =
      'Long demonstration ingredient ' + 'DescriptionWithoutSpaces'.repeat(10)
    w.ingredients[0].name = longName
    for (let i = 0; i < 45; i++)
      w.ingredients.push({
        ...w.ingredients[0],
        id: 'scroll-' + i,
        name: `Test ingredient ${i}`,
      })
    const conversations: any[] = []
    const writes: any[] = []
    await page.route('**/api/support*', async (route) => {
      const body =
        route.request().method() === 'POST'
          ? route.request().postDataJSON()
          : null
      if (body) writes.push(body)
      if (body?.action === 'chat') {
        const chat = {
          id: '10000000-0000-4000-8000-000000000001',
          messages: [
            ...Array.from({ length: 10 }, (_, i) => ({
              role: i % 2 ? 'assistant' : 'user',
              text:
                'Previous troubleshooting context. ' +
                'A reviewed practical step. '.repeat(8),
              at: new Date().toISOString(),
            })),
            { role: 'user', text: body.message, at: new Date().toISOString() },
            {
              role: 'assistant',
              text: 'I cannot determine the cause. Contact support.',
              at: new Date().toISOString(),
            },
          ],
          expiresAt: '2026-12-14T00:00:00Z',
          diagnostics: body.diagnostics || null,
        }
        conversations.splice(0, 1, chat)
        return route.fulfill({
          json: { conversation: chat, providerFailed: true },
        })
      }
      if (body?.action === 'escalate')
        return route.fulfill({
          json: { ticketId: '20000000-0000-4000-8000-000000000001' },
        })
      await route.fulfill({
        json: { conversations, policy: supportAiDefaults },
      })
    })
    await page.goto(workspaceFixtureUrl('Pantry'))
    const inventory = page.locator('.pantry-v2')
    await inventory.getByRole('button', { name: 'Table', exact: true }).click()
    const table = inventory.locator('table')
    await expect(table.locator('thead')).toBeVisible()
    const item = table
      .getByRole('button', { name: longName, exact: false })
      .first()
    await expect(item).toBeVisible()
    expect((await item.boundingBox())!.width).toBeLessThan(325)
    const cell = item.locator('..')
    expect((await cell.boundingBox())!.width).toBeLessThan(345)
    expect(await table.locator('.item-name small').count()).toBe(0)
    if (width === 1440)
      expect(
        await inventory
          .locator('.table-wrap')
          .evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `/tmp/compact-table-${width}.png` })
    await page.evaluate(() => window.scrollTo(0, 1200))
    const back = page.getByRole('button', { name: 'Back to top', exact: true })
    await expect(back).toHaveCount(1)
    await back.click()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    const help = page.getByRole('button', { name: 'Help and guides' })
    if (await help.isVisible()) await help.click()
    else {
      await page.getByRole('button', { name: 'Open navigation' }).click()
      await page
        .getByRole('button', { name: 'Help & support', exact: true })
        .click()
    }
    const popup = page.getByRole('dialog').last()
    await expect(
      popup.getByRole('heading', { name: 'AI support helper' }),
    ).toBeVisible()
    await popup
      .getByLabel('Your app question')
      .fill('My inventory has an error')
    await popup.getByLabel(/I agree to send/).check()
    await popup
      .getByLabel('Attach sanitized error details for support review')
      .check()
    // Expand the real retained conversation with synthetic long text to exercise scrolling.
    await popup.getByRole('button', { name: 'Send to AI', exact: true }).click()
    await expect(
      popup.getByText('I cannot determine the cause. Contact support.'),
    ).toBeVisible()
    await popup.getByLabel('Your app question').fill('Unsaved follow-up draft')
    await popup
      .getByRole('button', { name: 'Contact support', exact: true })
      .click()
    await popup
      .getByLabel('Issue summary for support')
      .fill('Reviewed mobile issue')
    expect(writes.filter((v) => v.action === 'escalate')).toHaveLength(0)
    await popup.getByRole('button', { name: 'Create support request' }).click()
    expect(writes.filter((v) => v.action === 'escalate')).toHaveLength(1)
    await popup
      .locator('details')
      .first()
      .evaluate((el: HTMLDetailsElement) => (el.open = true))
    const scroll = await popup.evaluateHandle((el) =>
      [el, ...el.querySelectorAll('*')].find(
        (e) =>
          e.scrollHeight > e.clientHeight + 100 &&
          /auto|scroll/.test(getComputedStyle(e).overflowY),
      ),
    )
    for (const position of [0.4, 0.7, 1]) {
      await scroll.evaluate(
        (el: any, fraction) =>
          (el.scrollTop = Math.min(
            el.scrollHeight - el.clientHeight,
            Math.max(
              el.clientHeight * 1.1,
              (el.scrollHeight - el.clientHeight) * fraction,
            ),
          )),
        position,
      )
      await expect(back).toHaveCount(1)
      await expect(
        popup.getByRole('button', { name: 'Back to top' }),
      ).toBeVisible()
      await expect
        .poll(() =>
          popup.evaluate((root) => {
            const button = root.querySelector<HTMLElement>('.back-to-top')
            if (!button) return -1
            const arrow = button.getBoundingClientRect()
            return Array.from(
              root.querySelectorAll<HTMLElement>(
                'button,a,input,select,textarea,summary,[role="button"]',
              ),
            )
              .filter(
                (control) =>
                  control !== button &&
                  getComputedStyle(control).visibility !== 'hidden',
              )
              .map((control) => control.getBoundingClientRect())
              .filter(
                (box) =>
                  box.width > 0 &&
                  box.height > 0 &&
                  arrow.left < box.right &&
                  arrow.right > box.left &&
                  arrow.top < box.bottom &&
                  arrow.bottom > box.top,
              ).length
          }),
        )
        .toBe(0)
    }
    const bounds = (await back.boundingBox())!
    expect(bounds.x).toBeGreaterThan(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(800)
    const before = await page.evaluate(() => window.scrollY)
    await back.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => scroll.evaluate((el: any) => el.scrollTop)).toBe(0)
    expect(await page.evaluate(() => window.scrollY)).toBe(before)
    await expect(popup.getByLabel('Your app question')).toHaveValue(
      'Unsaved follow-up draft',
    )
    await expect(
      popup.getByRole('button', { name: 'Close', exact: true }).last(),
    ).toBeEnabled()
    await popup.screenshot({ path: `/tmp/compact-helper-${width}.png` })
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)
  })
}

for (const width of [390, 820, 1440]) {
  test(`bounded table across inventory tabs at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const w = await installInventoryPackageFixture(page)
    w.settings[0].currentPantryView = 'table'
    for (const [usedAs, name] of [
      ['ingredient', 'ingredient'],
      ['packaging', 'package'],
      ['supply', 'supply'],
      ['material', 'material'],
    ])
      w.ingredients.push({
        ...w.ingredients[0],
        id: 'bounded-' + usedAs,
        usedAs,
        name: 'Bounded ' + name + ' ' + 'LongName'.repeat(24),
        category: 'Verified test category',
        materialType: usedAs === 'material' ? 'other' : undefined,
      })
    for (const tab of [
      'Ingredients',
      'Packaging',
      'Supplies',
      'Craft Materials',
    ]) {
      await page.goto(workspaceFixtureUrl('Inventory/' + tab))
      const inventory = page.locator('.pantry-v2')
      await expect(inventory).toBeVisible()
      await inventory
        .getByRole('button', { name: 'Table', exact: true })
        .click()
      const table = inventory.locator('table')
      await expect(table.locator('thead')).toBeVisible()
      const button = table.getByRole('button', { name: /Bounded/ }).first()
      expect((await button.boundingBox())!.width).toBeLessThan(325)
      expect(await table.locator('.item-name small').count()).toBe(0)
      const row = button.locator('xpath=ancestor::tr')
      await row.getByRole('button', { name: /Actions for/ }).click()
      await expect(
        page.getByRole('menuitem', { name: 'Receive stock', exact: true }),
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await inventory
        .getByRole('button', { name: 'Cards', exact: true })
        .click()
      await expect(inventory.locator('.pantry-card').first()).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1)
    }
  })
}
