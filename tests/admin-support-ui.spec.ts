import { test, expect, type Page } from '@playwright/test'
import { installWorkspaceFixture } from './workspace-fixture'
import { launchPricing } from '../src/lib/launch-plans'
import { assignableTierIssue } from '../netlify/lib/manual-access'
import { supportAiDefaults } from '../src/lib/support-ai'
async function mount(page: Page, method: string) {
  await installWorkspaceFixture(page)
  await page.route('**/capture-admin-fixture*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>(type)=>type;window.__vite_plugin_react_preamble_installed__=true;import("/src/test/capture-workspace.tsx").then(m=>m.${method}())</script></body></html>`,
    }),
  )
}
for (const width of [390, 820, 1440]) {
  test(`Mercantile preview, confirm, reload and history at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 })
    await mount(page, 'mountAdminAccessFixture')
    const data: any = {
      oven: {
        id: '10000000-0000-4000-8000-000000000001',
        business_name: 'Disposable test oven',
        identity_owner: 'owner',
      },
      effective: { plan: null, source: 'unassigned' },
      memberships: [],
      manualHistory: [],
      tierCatalog: launchPricing.plans.map((p) => ({
        ...p,
        issue: assignableTierIssue(p.id),
      })),
    }
    let applied = 0
    await page.route('**/api/admin*', async (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: data })
      expect(route.request().headers()['x-cp-admin']).toBe('1')
      const body = route.request().postDataJSON()
      const preview = {
        business: data.oven,
        current: data.effective,
        after: {
          plan: 'cottage-mercantile',
          assigned: 'cottage-mercantile',
          source: body.source,
        },
        memberLimit: 6,
        activeMembers: 1,
        billingNotice: 'Manual access creates no payment or charge.',
      }
      if (body.confirmation) {
        expect(body.confirmation).toBe('reviewed-fixture')
        data.effective = preview.after
        data.manualHistory.push({
          id: 'grant',
          operation: 'grant',
          plan_id: body.plan,
          grant_source: body.source,
          actor_identity: 'disposable-admin',
          reason: body.reason,
          created_at: new Date().toISOString(),
        })
        data.manualGrant = data.manualHistory.at(-1)
        applied++
        return route.fulfill({ json: { applied: true, preview } })
      }
      return route.fulfill({
        json: { preview, confirmation: 'reviewed-fixture' },
      })
    })
    await page.goto('/capture-admin-fixture')
    await expect(
      page.getByRole('option', { name: 'Free · 1 user', exact: true }),
    ).toBeEnabled()
    await page.getByLabel('Internal tier').selectOption('cottage-mercantile')
    await page.getByLabel('Manual source').selectOption('owner_internal')
    await page
      .getByLabel('Reason', { exact: true })
      .fill('Approved disposable business review')
    await page.getByRole('button', { name: 'Preview access change' }).click()
    await expect(
      page.getByText('Manual access creates no payment or charge.'),
    ).toBeVisible()
    expect(applied).toBe(0)
    await page.getByRole('button', { name: 'Confirm access change' }).click()
    await expect(
      page.getByText(/grant · cottage-mercantile · owner_internal/),
    ).toBeVisible()
    expect(applied).toBe(1)
    await page.reload()
    await expect(page.getByLabel('Internal tier')).toHaveValue(
      'cottage-mercantile',
    )
    await expect(page.getByText(/Actor disposable-admin/)).toBeVisible()
  })
  test(`support inbox reviewed AI draft, reply, usage and reload at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 })
    await mount(page, 'mountSupportInboxFixture')
    const ticket = {
      id: '20000000-0000-4000-8000-000000000001',
      number: 33,
      subject: 'Inventory receiving issue',
      category: 'Bug',
      status: 'new',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      requesterEmail: 'disposable@example.test',
      workspaceId: 'disposable-business',
      diagnostics: {
        appVersion: 'a'.repeat(12),
        route: '/oven#Inventory',
        aiReviewConsent: 'true',
      },
    }
    const messages: any[] = [
      {
        id: 'initial',
        kind: 'customer',
        own: false,
        body: 'Reviewed receiving issue summary',
        createdAt: ticket.createdAt,
        attachments: [],
      },
    ]
    const detail = () => ({
      ticket,
      messages,
      aiConversation: {
        id: 'chat',
        messages: [
          {
            role: 'user',
            text: 'Inventory receiving fails',
            at: ticket.createdAt,
          },
          {
            role: 'assistant',
            text: 'I cannot determine the cause. Review Receive Stock.',
            at: ticket.createdAt,
            articles: ['inventory'],
          },
        ],
        diagnostics: {
          appVersion: 'a'.repeat(12),
          page: '/oven#Inventory',
          timestamp: ticket.createdAt,
          error: { message: 'Error details omitted.' },
        },
        expires_at: '2026-12-14T00:00:00Z',
      },
      notifications: [],
    })
    let replies = 0
    const policy = { ...supportAiDefaults }
    await page.route('**/api/support*', async (route) => {
      expect(route.request().headers()['x-cp-admin']).toBe('1')
      const url = new URL(route.request().url())
      if (route.request().method() === 'GET')
        return route.fulfill({
          json: url.searchParams.has('ai')
            ? {
                policy,
                usage: [
                  {
                    day: ticket.createdAt,
                    requests: 1,
                    failures: 0,
                    input_tokens: 50,
                    output_tokens: 20,
                  },
                ],
              }
            : url.searchParams.has('ticket')
              ? detail()
              : { staff: true, admin: true },
        })
      const body = route.request().postDataJSON()
      if (url.searchParams.has('ai')) {
        if (body.action === 'policy') Object.assign(policy, body.policy)
        return route.fulfill({
          json:
            body.action === 'summarize'
              ? {
                  suggestion:
                    'Reported issue: receiving fails. Suggest reviewing purchase units before retrying.',
                }
              : { policy },
        })
      }
      if (body.action === 'list')
        return route.fulfill({ json: { tickets: [ticket], hasMore: false } })
      if (body.action === 'status') ticket.status = body.data.status
      if (body.action === 'reply') {
        replies++
        messages.push({
          id: 'reply',
          kind: 'support',
          own: true,
          body: body.data.message,
          createdAt: ticket.createdAt,
          attachments: [],
        })
      }
      return route.fulfill({ json: detail() })
    })
    await page.goto('/capture-admin-fixture#ticket=' + ticket.id)
    await expect(
      page.getByRole('heading', { name: 'Support inbox' }),
    ).toBeVisible()
    await page.getByText('Attached AI conversation & diagnostics').click()
    await expect(
      page.getByText('Inventory receiving fails', { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Summarize & suggest troubleshooting' })
      .click()
    expect(replies).toBe(0)
    await page.getByRole('button', { name: 'Use as reply draft' }).click()
    await expect(
      page.getByRole('textbox', {
        name: 'Reply in Cottage Pantry',
        exact: true,
      }),
    ).toHaveValue(/Reported issue/)
    await page
      .getByRole('textbox', { name: 'Reply in Cottage Pantry', exact: true })
      .fill('Please review the purchase unit, then tell us what happens.')
    await page
      .getByRole('button', { name: 'Send customer-visible reply' })
      .click()
    await expect(
      page.getByText(
        'Please review the purchase unit, then tell us what happens.',
        { exact: true },
      ),
    ).toBeVisible()
    expect(replies).toBe(1)
    await page
      .getByRole('combobox', { name: 'Ticket status', exact: true })
      .selectOption('waiting_on_customer')
    await page.getByText('AI usage & limits', { exact: true }).click()
    await page.getByLabel('Per person / 24 hours', { exact: true }).fill('5')
    await page.getByRole('button', { name: 'Save AI limits' }).click()
    await expect(page.getByRole('status')).toContainText('AI limits saved')
    await page.reload()
    await expect(
      page.getByRole('combobox', { name: 'Ticket status', exact: true }),
    ).toHaveValue('waiting_on_customer')
    await page.getByText('AI usage & limits', { exact: true }).click()
    await expect(
      page.getByLabel('Per person / 24 hours', { exact: true }),
    ).toHaveValue('5')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: `/tmp/admin-support-${width}.png`,
      fullPage: true,
    })
  })
}
