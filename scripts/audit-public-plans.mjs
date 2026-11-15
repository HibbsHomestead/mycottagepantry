// Read-only hosted visitor audit. Never submits signup, checkout or billing changes.
/* global document, innerWidth, console, URL, process, fetch */
import { chromium } from '@playwright/test'

const target = new URL(process.argv[2] || 'https://mycottagepantry.com')
if (
  !['http:', 'https:'].includes(target.protocol) ||
  target.username ||
  target.password
)
  throw new Error('Supply a public site origin without credentials.')
const origin = target.origin
const tiers = [
  ['free', 'Free', 0, 1],
  ['mixing-bowl', 'Mixing Bowl', 10, 1],
  ['bakers-bench', 'Baker’s Bench', 20, 1],
  ['cottage-kitchen', 'Cottage Kitchen', 30, 2],
  ['cottage-mercantile', 'Cottage Mercantile', 40, 6],
]
const staleCopy =
  /not yet available for purchase|Choose your intended plan|awaits a confirmed user limit|Team user limit awaiting confirmation/i
const failures = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
}
const availabilityResponse = await fetch(
  origin + '/api/stripe/billing?view=availability&details=1',
  { cache: 'no-store' },
)
if (!availabilityResponse.ok)
  throw new Error('Public purchase availability could not be read.')
const availability = await availabilityResponse.json()
if (!Array.isArray(availability.plans))
  throw new Error('Public purchase availability response was invalid.')
const html = await fetch(origin + '/pricing', { cache: 'no-store' }).then((r) =>
  r.text(),
)
check(
  !staleCopy.test(html),
  'Pricing server-rendered HTML contains outdated availability or user-limit copy.',
)
check(
  Array.isArray(availability.tiers),
  'Published availability endpoint lacks per-tier blocker explanations.',
)

const browser = await chromium.launch({ headless: true })
const cards = []
let blockedMutations = 0
let browserErrors = 0
try {
  // A new isolated context has no owner session or saved payment information.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', () => browserErrors++)
  await page.route('**/*', (route) => {
    const request = route.request()
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()))
      return route.continue()
    const isRefresh =
      new URL(request.url()).pathname === '/api/stripe/billing' &&
      request.postDataJSON()?.action === 'refresh'
    if (isRefresh) return route.continue()
    blockedMutations++
    return route.abort()
  })
  await page.goto(origin + '/pricing', { waitUntil: 'networkidle' })
  check(
    !staleCopy.test(await page.locator('body').innerText()),
    'Hydrated pricing contains outdated availability or user-limit copy.',
  )
  for (const [id, name, dollars, users] of tiers) {
    const card = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name, exact: true }) })
    const content = await card.innerText()
    check(content.includes('$' + dollars), `${name}: incorrect monthly price.`)
    check(
      content.includes(`${users} total user`),
      `${name}: incorrect total-user allowance.`,
    )
    check(
      content.includes('including the owner'),
      `${name}: owner inclusion missing.`,
    )
    if (users > 1)
      check(
        /invitations.*Coming soon/i.test(content) &&
          /member administration/i.test(content),
        `${name}: unfinished team controls are not disclosed.`,
      )
    const action = card.locator('footer a, footer button')
    const purchasable = availability.plans.includes(id)
    check(
      id === 'free' || purchasable
        ? (await action.getAttribute('href')) !== null
        : await action.isDisabled(),
      `${name}: action disagrees with purchase availability.`,
    )
    cards.push({
      tier: name,
      monthlyUSD: dollars,
      usersIncludingOwner: users,
      purchaseAvailable: purchasable,
      action: await action.innerText(),
    })
  }
  const table = page.getByRole('table')
  const content = await table.innerText()
  check(
    content.includes('Partial'),
    'Comparison does not label partial capabilities.',
  )
  check(
    content.includes('Coming soon'),
    'Comparison does not label planned capabilities.',
  )
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    'Pricing overflows the mobile viewport.',
  )
  const region = page.locator('.plan-table-scroll')
  await region.scrollIntoViewIfNeeded()
  const label = region.locator('thead th').first()
  const before = (await label.boundingBox()).x
  await region.evaluate((node) => {
    node.scrollLeft = node.scrollWidth
  })
  check(
    Math.abs((await label.boundingBox()).x - before) < 2,
    'Comparison labels do not stay visible during horizontal scrolling.',
  )
  for (const [id, name] of tiers) {
    await page.goto(
      origin + '/signup?plan=' + id + '&returnTo=%2Foven%2Fbilling',
      { waitUntil: 'networkidle' },
    )
    const heading = page.getByRole('group', { name: 'Choose your plan' })
    check(
      (await heading.count()) === 1,
      `${name}: signup does not say Choose your plan.`,
    )
    const radio = page.locator(`input[name="plan-choice"][value="${id}"]`)
    check(await radio.isChecked(), `${name}: signup loses the selected tier.`)
    check(
      !staleCopy.test(await page.locator('body').innerText()),
      `${name}: signup contains outdated availability or user-limit copy.`,
    )
    check(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      `${name}: signup overflows the mobile viewport.`,
    )
    const login = await page
      .getByRole('link', { name: 'Already have an account? Log in.' })
      .getAttribute('href')
    check(
      new URL(login, origin).searchParams.get('plan') === id,
      `${name}: sign-in link loses the selected tier.`,
    )
  }
  check(
    browserErrors === 0,
    'Hosted pages report browser errors, including possible hydration errors.',
  )
  check(
    blockedMutations === 0,
    'Visitor navigation attempted an unexpected mutation; it was blocked.',
  )
} finally {
  await browser.close()
}
console.log(
  JSON.stringify(
    {
      origin,
      cards,
      failures,
      browserErrors,
      blockedMutations,
      realChargesOrSubscriptionChanges: 0,
    },
    null,
    2,
  ),
)
process.exitCode = failures.length ? 1 : 0
