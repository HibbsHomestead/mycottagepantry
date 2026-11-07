import type { Page } from '@playwright/test'
import { demoData } from '../src/lib/demo'
import { handleAddItem } from '../netlify/lib/add-item-handler'
import { installWorkspaceFixture } from './workspace-fixture'

/** Browser-only synthetic records; the durable transaction has separate DB tests. */
export async function installInventoryPackageFixture(page: Page) {
  await installWorkspaceFixture(page)
  await page.route(
    /^http:\/\/localhost:8889\/(?:@|src\/|node_modules\/)/,
    async (route) => {
      const url = new URL(route.request().url())
      url.port = '3000'
      await route.fulfill({ response: await route.fetch({ url: url.href }) })
    },
  )
  const workspace = demoData()
  workspace.journals = []
  await page.route('**/api/workspace*', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      if (body.action === 'save') {
        await handleAddItem(body.action, body.table, body.data, {
          state: workspace,
          today: '2026-11-06',
          save: async (table, item) => {
            const rows = workspace[table]
            const index = rows.findIndex((i) => i.id === item.id)
            if (index < 0) rows.push(item)
            else rows[index] = item
          },
          audit: async () => {},
        })
      }
    }
    await route.fulfill({ json: { workspace, role: 'Owner', demo: false } })
  })
  return workspace
}
