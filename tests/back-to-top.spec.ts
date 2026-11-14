import { test, expect } from '@playwright/test'
import { installWorkspaceFixture } from './workspace-fixture'
for (const width of [390, 820, 1440])
  test(`shared nested page and popup scrolling at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await installWorkspaceFixture(page)
    await page.route('**/capture-scroll*', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import("/src/test/capture-workspace.tsx").then(m=>m.mountScrollFixture())</script></body></html>',
      }),
    )
    await page.goto('/capture-scroll')
    const main = page.locator('[data-page-scroll]'),
      back = page.getByRole('button', { name: 'Back to top', exact: true })
    await expect(main).toBeVisible()
    await expect(back).toHaveCount(0)
    await main.evaluate((el) => (el.scrollTop = 2000))
    await expect(back).toHaveCount(1)
    await page.getByRole('button', { name: 'Open long form' }).click()
    const popup = page.getByRole('dialog')
    await expect(popup).toHaveAttribute('data-forwarded-ref', 'true')
    await expect(back).toHaveCount(0)
    await popup
      .getByRole('textbox', { name: 'Popup draft' })
      .fill('Keep the current popup draft')
    const body = popup.locator('[data-popup-scroll]')
    await body.evaluate((el) => (el.scrollTop = el.scrollHeight))
    await expect(back).toHaveCount(1)
    const arrow = (await back.boundingBox())!
    for (const name of ['Save draft', 'Cancel draft']) {
      const box = (await popup
        .getByRole('button', { name, exact: true })
        .boundingBox())!
      expect(
        arrow.x + arrow.width <= box.x ||
          arrow.x >= box.x + box.width ||
          arrow.y + arrow.height <= box.y ||
          arrow.y >= box.y + box.height,
      ).toBe(true)
    }
    const background = await main.evaluate((el) => el.scrollTop)
    await back.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(0)
    expect(await main.evaluate((el) => el.scrollTop)).toBe(background)
    await expect(
      popup.getByRole('textbox', { name: 'Popup draft' }),
    ).toHaveValue('Keep the current popup draft')
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)
    await expect(back).toHaveCount(1)
    await back.click()
    await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBe(0)
    await expect(page.getByLabel('Page draft')).toHaveValue(
      'Preserved page draft',
    )
  })
