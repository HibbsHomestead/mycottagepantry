import { supportAiDefaults } from '../src/lib/support-ai'
import { test, expect } from '@playwright/test'
// Browser-only transport fixture: API privacy and persistence are tested separately against PostgreSQL.
test('requester can submit, reopen and reply at desktop and phone sizes without business API requests', async ({
  page,
}) => {
  let workspaceCalls = 0
  await page.route('**/api/workspace*', (route) => {
    workspaceCalls++
    return route.abort()
  })
  const id = '20000000-0000-4000-8000-000000000001'
  const ticket = {
    id,
    number: 17,
    subject: 'Help with recipe Method',
    category: 'Question',
    status: 'new',
    createdAt: '2026-10-31T10:00:00Z',
    updatedAt: '2026-10-31T10:00:00Z',
  }
  const messages: any[] = []
  let creations = 0
  await page.route('**/api/support**', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (request.method() === 'GET')
      return route.fulfill({
        json: url.searchParams.has('ticket')
          ? { ticket, messages }
          : { staff: false, admin: false },
      })
    const { action, data } = request.postDataJSON()
    if (action === 'list')
      return route.fulfill({
        json: { tickets: messages.length ? [ticket] : [], hasMore: false },
      })
    if (action === 'create') {
      creations++
      messages.push({
        id: '30000000-0000-4000-8000-000000000001',
        kind: 'customer',
        body: data.message,
        own: true,
        createdAt: ticket.createdAt,
        attachments: [],
      })
    }
    if (action === 'reply')
      messages.push({
        id: crypto.randomUUID(),
        kind: 'customer',
        body: data.message,
        own: true,
        createdAt: ticket.createdAt,
        attachments: [],
      })
    if (action === 'status') ticket.status = data.status
    return route.fulfill({ json: { ticket, messages } })
  })
  await page.goto('/support', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'New ticket' }).click()
  await expect(page.getByText(/Do not submit passwords/)).toBeVisible()
  await page.getByLabel('Subject').fill(ticket.subject)
  await page
    .getByLabel('Message', { exact: true })
    .fill('Where can I edit the Method?')
  await page.getByRole('button', { name: 'Submit ticket' }).click()
  await expect(page.getByText('Where can I edit the Method?')).toBeVisible()
  await expect(page.getByText(/Ticket #17/)).toBeVisible()
  await expect(page.getByText(/Private internal note/)).toHaveCount(0)
  await page
    .getByLabel('Reply in Cottage Pantry', { exact: true })
    .fill('I found the review section.')
  await page.getByRole('button', { name: 'Send reply' }).click()
  await expect(page.getByText('I found the review section.')).toBeVisible()
  await page
    .getByRole('button', { name: 'Resolve ticket', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Reopen ticket' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Reopen ticket' }).click()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByText('Where can I edit the Method?')).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: `/tmp/cottage-support-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  }
  expect(creations).toBe(1)
  expect(workspaceCalls).toBe(0)
})
test('platform inbox exposes private notes only through its authorized API view', async ({
  page,
}) => {
  await page.route('**/api/admin?action=session', (route) =>
    route.fulfill({
      json: {
        stage: 'authenticated',
        role: 'admin',
        identityId: 'fixture-admin',
      },
    }),
  )
  const id = '20000000-0000-4000-8000-000000000001'
  const ticket = {
    id,
    number: 17,
    subject: 'Recipe question',
    category: 'Question',
    status: 'in_progress',
    requesterEmail: 'maker@example.test',
    createdAt: '2026-10-31T10:00:00Z',
    updatedAt: '2026-10-31T10:00:00Z',
  }
  const messages = [
    {
      id: 'note-id',
      kind: 'internal',
      body: 'Private troubleshooting note',
      own: false,
      createdAt: ticket.createdAt,
      attachments: [],
    },
  ]
  await page.route('**/api/support**', (route) => {
    const request = route.request(),
      url = new URL(request.url())
    expect(url.searchParams.get('view')).toBe('staff')
    if (url.searchParams.has('ai'))
      return route.fulfill({
        json: {
          policy: supportAiDefaults,
          usage: [],
          conversations: [],
          actions: [],
        },
      })
    if (request.method() === 'GET')
      return route.fulfill({
        json: url.searchParams.has('ticket')
          ? {
              ticket,
              messages,
              notifications: [
                {
                  id: 'notice',
                  kind: 'acknowledgment',
                  status: 'blocked_setup',
                  attempts: 0,
                },
              ],
            }
          : { staff: true, admin: false },
      })
    return route.fulfill({ json: { tickets: [ticket], hasMore: false } })
  })
  await page.goto('/platform-support#ticket=' + id, {
    waitUntil: 'networkidle',
  })
  await expect(page.getByText('Private troubleshooting note')).toBeVisible()
  await expect(
    page.getByText('Private internal note', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Notification settings' }),
  ).toHaveCount(0)
  await page.getByLabel(/Private internal note —/).check()
  await expect(
    page.getByRole('button', { name: 'Save private note' }),
  ).toBeVisible()
  await page.screenshot({
    path: '/tmp/cottage-platform-support.png',
    fullPage: true,
    animations: 'disabled',
  })
})
test('signed-out requests to the real support function reveal no tickets or configuration', async ({
  page,
  request,
}) => {
  for (const query of [
    '',
    '?view=staff',
    '?settings=1',
    '?attachment=20000000-0000-4000-8000-000000000001',
  ]) {
    const response = await request.get('/api/support' + query)
    expect(response.status()).toBe(
      query.includes('staff') || query.includes('settings') ? 404 : 401,
    )
    if (response.status() === 401) {
      expect(response.headers()['cache-control']).toBe('private, no-store')
      expect(Object.keys(await response.json())).toEqual(['error'])
    } else {
      // Local Netlify dev falls through off-host admin 404s to the framework page.
      expect(await response.text()).not.toContain(
        'Private troubleshooting note',
      )
    }
  }
  await page.goto('/support', { waitUntil: 'networkidle' })
  await expect(page.getByRole('alert')).toContainText(
    'Log in to Cottage Pantry',
  )
  await expect(page.getByRole('button', { name: 'New ticket' })).toHaveCount(0)
  await expect(
    page.getByRole('link', { name: 'Cannot sign in? Help & contact' }),
  ).toBeVisible()
})
