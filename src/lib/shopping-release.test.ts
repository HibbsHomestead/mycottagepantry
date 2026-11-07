// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { shoppingSearchEnabled } from '../../netlify/lib/feature-flags'
import { findPrices } from '../../netlify/lib/price-search'

const dependencies = vi.hoisted(() => ({
  database: vi.fn(() => {
    throw new Error('Database must not be reached.')
  }),
  identity: vi.fn(),
}))
vi.mock('@netlify/database', () => ({ getDatabase: dependencies.database }))
vi.mock('@netlify/identity', () => ({ getUser: dependencies.identity }))
import handler from '../../netlify/functions/workspace.mts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it.each([undefined, '', 'false', 'TRUE', '1', ' true '])(
  'fails closed for an unset or unrecognized release flag (%s), even with provider configuration',
  async (flag) => {
    const get = vi.fn((name: string) =>
      name === 'SHOPPING_SEARCH_ENABLED'
        ? flag
        : 'fixture-provider-configuration',
    )
    vi.stubGlobal('Netlify', { env: { get } })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect(shoppingSearchEnabled()).toBe(false)
    await expect(
      findPrices(
        { id: 'flour', name: 'Flour' },
        {
          query: 'Flour',
          zip: '',
          preference: 'both',
          alternativeBrands: false,
        },
      ),
    ).rejects.toMatchObject({ code: 'feature_disabled' })
    expect(
      get.mock.calls.every(([name]) => name === 'SHOPPING_SEARCH_ENABLED'),
    ).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  },
)

it('defaults off without a Netlify runtime and requires an explicit server opt-in', () => {
  vi.stubGlobal('Netlify', undefined)
  expect(shoppingSearchEnabled()).toBe(false)
  vi.stubGlobal('Netlify', { env: { get: () => 'true' } })
  expect(shoppingSearchEnabled()).toBe(true)
})

it.each([null, { id: 'signed-in-owner' }])(
  'rejects direct setup, test, cached-search and quote-import requests before auth, database or provider access (identity %j)',
  async (user) => {
    dependencies.identity.mockResolvedValue(user)
    vi.stubGlobal('Netlify', {
      env: {
        get: (name: string) =>
          name === 'SERPAPI_API_KEY'
            ? 'fixture-provider-configuration'
            : undefined,
      },
    })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    for (const path of ['/api/workspace', '/.netlify/functions/workspace']) {
      for (const query of [
        'priceSearchStatus=1',
        'priceSearch=flour',
        'priceSearch=flour&assistant=1',
      ]) {
        for (const body of [
          undefined,
          { operation: 'search', refresh: true },
          { ingredientId: 'flour', confirmAllowance: true },
          { operation: 'save', offerId: 'saved-result' },
        ]) {
          const response = await handler(
            new Request(
              'https://cottage-pantry.test' + path + '?' + query,
              body ? { method: 'POST', body: JSON.stringify(body) } : undefined,
            ),
            {} as never,
          )
          expect(response.status).toBe(404)
          expect(await response.json()).toEqual({
            error: 'This operation is unavailable.',
            code: 'FEATURE_UNAVAILABLE',
          })
          expect(response.headers.get('cache-control')).toContain('no-store')
        }
      }
    }
    expect(dependencies.database).not.toHaveBeenCalled()
    expect(dependencies.identity).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  },
)
