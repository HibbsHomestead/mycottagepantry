import type { Page } from '@playwright/test'
import type { Workspace } from '../src/lib/domain'

/** Real photographs in a synthetic workspace; no customer data or network APIs. */
export async function installMarketingPhotos(page: Page, workspace: Workspace) {
  const photos = [
    ['bread', 'src/test/fixtures/photos/bread.jpg'],
    ['cookies', 'src/test/fixtures/photos/cookies.jpg'],
    ['eggs', 'src/test/fixtures/eggs-unsplash.jpg'],
  ] as const
  workspace.graphic_assets ||= []
  for (const [id, path] of photos) {
    workspace.graphic_assets.push({
      id: `demo-photo-${id}`,
      name: `${id} demonstration photo`,
      fileUrl: `/demo-photo-${id}.jpg`,
    })
    await page.route(`**/demo-photo-${id}.jpg`, (route) =>
      route.fulfill({ path, contentType: 'image/jpeg' }),
    )
  }
  for (const item of workspace.products) {
    if (/bread/i.test(item.name)) item.imageAssetId = 'demo-photo-bread'
    if (/cookie/i.test(item.name)) item.imageAssetId = 'demo-photo-cookies'
  }
  for (const item of workspace.ingredients) {
    if (/egg/i.test(item.name)) item.imageAssetId = 'demo-photo-eggs'
  }
}
