import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureInventoryError,
  createInventoryErrorDetails,
  fetchWorkspaceWithDiagnostics,
  inventoryErrorLocation,
  inventoryErrorMessage,
  inventoryErrorSnapshot,
  inventoryErrorStack,
  readWorkspaceJsonWithDiagnostics,
} from './inventory-error-details'

afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Inventory error privacy boundary', () => {
  it('enables only on Inventory hashes in known workspace paths', () => {
    expect(
      inventoryErrorLocation({
        pathname: '/oven',
        hash: '#Inventory/Overview?filter=private',
      }),
    ).toBe('/oven')
    for (const location of [
      { pathname: '/login', hash: '#Inventory/Overview' },
      { pathname: '/oven/private-id', hash: '#Inventory' },
      { pathname: '/oven', hash: '#Dashboard' },
      { pathname: '/oven', hash: '#Inventory-private' },
    ])
      expect(inventoryErrorLocation(location)).toBeNull()
  })

  it('keeps diagnostic causes while omitting arbitrary message content', () => {
    expect(
      inventoryErrorMessage(
        'A verified unit conversion from lb to ml is required.',
      ),
    ).toBe('A verified unit conversion from lb to ml is required.')
    expect(
      inventoryErrorMessage(
        'Choose a supported unit or define a custom count unit.',
      ),
    ).toBe('Choose a supported unit or define a custom count unit.')
    expect(
      inventoryErrorMessage(
        "Cannot read properties of undefined (reading 'map')",
      ),
    ).toContain("reading 'map'")
    expect(
      inventoryErrorMessage(
        'Minified React error #310; visit https://react.dev/?args[]=private',
      ),
    ).toBe('Minified React error #310.')
    for (const message of [
      'private-item: cost lookup failed; token=private-token',
      "Cannot read properties of null (reading 'private-item')",
      'A verified unit conversion from private-item to private-token is required.',
      'private-item.map is not a function',
      'private-token is not defined',
      'Unexpected token p, "private-item private-token" is not valid JSON',
      'Failed to fetch dynamically imported module: https://example.test/private-item?token=private-token',
    ])
      expect(inventoryErrorMessage(message)).not.toMatch(
        /private-item|private-token/,
      )
  })

  it('keeps public application file offsets and known components, strips URLs, queries and arbitrary frames', () => {
    const stack = `TypeError: private-message
    at privateItem (https://example.test/assets/oven-aBcD_123.js?token=private-token:4:56)
    at ua (https://example.test/assets/index-W-rD3cqU.js:9:32139)
    at PantryInventory (https://example.test/src/components/pantry-inventory.tsx?t=123:300:9)
    at privateItem (https://external.test/assets/oven-aBcD123.js:1:2)
    at privateItem (/customers/private-item/secret.ts:1:2)
    at WorkspaceApp (<anonymous>)`
    const result = inventoryErrorStack(stack, 'https://example.test')
    expect(result).toContain('/assets/oven-aBcD_123.js:4:56')
    expect(result).toContain('/assets/index-W-rD3cqU.js:9:32139')
    expect(result).toContain(
      'at PantryInventory (/src/components/pantry-inventory.tsx:300:9)',
    )
    expect(result).toContain('at WorkspaceApp')
    expect(result).not.toMatch(/private|https:|external|customers|token|\?t=/)
  })

  it('captures the caught exception and React component stack without enumerating arbitrary fields', () => {
    window.history.replaceState(
      {},
      '',
      '/oven?token=private-token#Inventory/Overview?search=private-item',
    )
    const error = Object.assign(new TypeError('private-item private-token'), {
      inventory: 'private-inventory',
      credentials: 'private-credentials',
    })
    error.stack =
      'TypeError: private-item\n at PantryInventory (http://localhost:3000/assets/oven-AbCdEf12.js:3:4)'
    captureInventoryError(error, {
      componentStack: '\n at PantryInventory\n at WorkspaceApp',
    })
    const details = inventoryErrorSnapshot(error)!
    expect(details.pathname).toBe('/oven')
    expect(details.error.type).toBe('TypeError')
    expect(details.error.componentStack).toContain('WorkspaceApp')
    expect(details.timestamp).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(JSON.stringify(details)).not.toMatch(/private|token=|search=/)
    const hostile = {
      get name() {
        throw new Error('private')
      },
      get message() {
        throw new Error('private')
      },
      get stack() {
        throw new Error('private')
      },
    }
    expect(() => createInventoryErrorDetails(hostile)).not.toThrow()
  })
})

describe('workspace request diagnostics', () => {
  it('records status and a validated random correlation ID, never reads response bodies for diagnostics, and clears on success', async () => {
    window.history.replaceState({}, '', '/oven#Inventory/Overview')
    const response = new Response('{"error":"private-item private-token"}', {
      status: 503,
      headers: { 'x-nf-request-id': '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    })
    const json = vi.spyOn(response, 'json')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response)
        .mockResolvedValueOnce(new Response('{}')),
    )
    expect(await fetchWorkspaceWithDiagnostics()).toBe(response)
    expect(json).not.toHaveBeenCalled()
    expect(createInventoryErrorDetails(new Error()).request).toEqual({
      path: '/api/workspace',
      status: 503,
      message: 'HTTP request failed (body omitted).',
      correlationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    })
    expect(
      JSON.stringify(createInventoryErrorDetails(new Error())),
    ).not.toMatch(/private-item|private-token/)
    await fetchWorkspaceWithDiagnostics()
    expect(createInventoryErrorDetails(new Error()).request).toBeUndefined()
  })

  it('preserves transport and parsing errors, omits unvalidated IDs, and does not attach another page failure', async () => {
    window.history.replaceState({}, '', '/oven#Inventory/Overview')
    const response = new Response('private-body', {
      status: 200,
      headers: { 'x-nf-request-id': 'private-identifier' },
    })
    await expect(
      readWorkspaceJsonWithDiagnostics(response),
    ).rejects.toBeInstanceOf(SyntaxError)
    expect(createInventoryErrorDetails(new Error()).request).toEqual({
      path: '/api/workspace',
      status: 200,
      message: 'Response was not valid JSON (body omitted).',
    })
    const networkError = new TypeError('private transport message')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError))
    await expect(fetchWorkspaceWithDiagnostics()).rejects.toBe(networkError)
    expect(createInventoryErrorDetails(new Error()).request?.status).toBeNull()
    window.history.replaceState({}, '', '/oven#Dashboard')
    // No Inventory UI is enabled here; the next successful read also clears diagnostics.
    expect(inventoryErrorLocation()).toBeNull()
    await expect(fetchWorkspaceWithDiagnostics()).rejects.toBe(networkError)
  })
})
