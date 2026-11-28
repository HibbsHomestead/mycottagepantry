import { expect, test, type Page } from '@playwright/test'
import type {
  BoardCommand,
  BoardListing,
  BoardRequest,
} from '../src/lib/feature-requests'

const boardPath = '/feature-requests'
const fixtureRows: BoardRequest[] = [
  {
    id: '924cce00-1b18-41da-a771-9e68aaacbdea',
    title: 'Save a print preset for each label roll',
    useCase:
      'I switch between two label rolls on market mornings. I’d like to pick the right dimensions and rotation without setting them up again.',
    status: 'Planned',
    category: 'Labels',
    votes: 24,
    voted: false,
    following: false,
    displayName: 'Anonymous baker',
  },
  {
    id: 'e7004a92-ddbf-4cc2-9215-9ecfd398a9b2',
    title: 'Count stock from the packing table',
    useCase:
      'A short mobile list would help me count boxes and bags without moving back and forth between the stockroom and my laptop.',
    status: 'Under review',
    category: 'Inventory',
    votes: 17,
    voted: false,
    following: false,
    displayName: 'Fern',
  },
  {
    id: 'd16a5bd2-102b-4129-b6ce-e146c61accc5',
    title: 'Scale two flavors in one production run',
    useCase:
      'For the six-pack, I need to plan enough blueberry and cranberry batter without combining the two recipes into one.',
    status: 'New',
    category: 'Recipes',
    votes: 9,
    voted: false,
    following: false,
    displayName: 'Juniper',
  },
].map(
  (row) =>
    ({
      ...row,
      editable: false,
      own: false,
      createdAt: '2026-09-17T18:00:00Z',
      tags: [],
      releaseUrl: null,
      hasImage: false,
    }) as BoardRequest,
)

async function installBoardFixture(page: Page) {
  const rows = structuredClone(fixtureRows)
  const writes: BoardCommand[] = []
  await page.route('**/api/feature-requests?**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'POST') {
      const command = request.postDataJSON() as BoardCommand
      writes.push(command)
      if (command.action === 'vote') {
        const row = rows.find((item) => item.id === command.id)!
        row.votes += command.enabled ? 1 : -1
        row.voted = command.enabled
        return route.fulfill({ json: { id: command.id } })
      }
      if (command.action === 'submit') {
        const id = 'f85f8272-ebd6-4a86-968e-65c5a574c997'
        rows.unshift({
          ...rows[0],
          ...command,
          id,
          displayName: 'Anonymous baker',
          status: 'New',
          own: true,
          editable: true,
          votes: 0,
          voted: false,
        })
        return route.fulfill({ json: { id } })
      }
      if (command.action === 'status') {
        const row = rows.find((item) => item.id === command.id)!
        row.status = command.status
        return route.fulfill({ json: { id: command.id } })
      }
      throw new Error(`Unexpected fixture action: ${command.action}`)
    }
    const id = url.searchParams.get('id')
    if (id) {
      const row = rows.find((item) => item.id === id)!
      return route.fulfill({
        json: {
          request: row,
          comments: [],
          history: [
            {
              id: 'draft-history',
              status: row.status,
              createdAt: row.createdAt,
              note: null,
            },
          ],
          redirected: false,
        },
      })
    }
    const search = url.searchParams.get('q')?.toLowerCase() || ''
    const status = url.searchParams.get('status')
    const data: BoardListing = {
      notifications: false,
      voteLimit: null,
      inbox: [],
      hasMore: false,
      requests: rows.filter(
        (row) =>
          row.title.toLowerCase().includes(search) &&
          (!status || status === row.status),
      ),
    }
    await route.fulfill({ json: data })
  })
  return writes
}

for (const width of [1440, 390]) {
  test(`renders and votes with the keyboard at ${width}px`, async ({
    page,
  }) => {
    const writes = await installBoardFixture(page)
    await page.setViewportSize({ width, height: 950 })
    await page.goto(boardPath)
    await expect(
      page.getByRole('heading', { name: 'Feature requests' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: fixtureRows[0].title }),
    ).toBeVisible()
    expect(
      await page
        .locator('main.feature-board')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    await page.screenshot({
      path: `docs/reviews/feature-requests/board-${width}.png`,
      fullPage: true,
    })
    const vote = page.getByRole('button', {
      name: `Vote for ${fixtureRows[0].title}`,
    })
    await vote.focus()
    await page.keyboard.press('Enter')
    await expect(vote).toHaveAttribute('aria-pressed', 'true')
    await expect(vote).toContainText('25')
    await page.getByRole('button', { name: 'Suggest an idea' }).click()
    await page.getByLabel('Title', { exact: true }).fill('Save a print')
    await page.getByRole('button', { name: 'Voted', exact: true }).waitFor()
    await page
      .getByLabel('Title', { exact: true })
      .fill('Remember market stall layouts')
    await page
      .getByLabel('What are you trying to do?')
      .fill('I set up the stall the same way every Saturday morning.')
    await page.getByRole('button', { name: 'Submit request' }).click()
    await expect(
      page.getByRole('region', { name: 'Request details' }),
    ).toContainText('Remember market stall layouts')
    expect(writes.map((command) => command.action)).toEqual(['vote', 'submit'])
  })
}

test('moderation queue requires a decline reason and renders history', async ({
  page,
}) => {
  const writes = await installBoardFixture(page)
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.goto(`${boardPath}?admin=1#${fixtureRows[2].id}`)
  await expect(
    page.getByRole('heading', { name: 'Review queue' }),
  ).toBeVisible()
  const detail = page.getByRole('region', { name: 'Request details' })
  await detail
    .getByRole('combobox', { name: 'Status', exact: true })
    .selectOption('Not planned')
  await detail.getByRole('button', { name: 'Publish status' }).click()
  expect(writes).toEqual([])
  await detail
    .getByLabel('Public reason (required)')
    .fill('The production planner already supports this workflow.')
  await page.screenshot({
    path: 'docs/reviews/feature-requests/moderation-1440.png',
    fullPage: true,
  })
  await detail.getByRole('button', { name: 'Publish status' }).click()
  await expect(detail.locator('.board-status')).toHaveText('Not planned')
  expect(writes).toMatchObject([{ action: 'status', status: 'Not planned' }])
})
