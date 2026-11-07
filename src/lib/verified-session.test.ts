// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const sdk = vi.hoisted(() => ({ refresh: vi.fn(), config: vi.fn() }))
vi.mock('@netlify/identity', () => ({
  refreshSession: sdk.refresh,
  getIdentityConfig: sdk.config,
}))
import { verifiedSession } from '../../netlify/lib/verified-session'
const transport = vi.fn()
const request = () =>
  new Request('https://example.netlify.app/workspace', {
    headers: { cookie: 'nf_jwt=test-session' },
  })
beforeEach(() => {
  vi.stubGlobal('fetch', transport)
  transport.mockReset()
  sdk.refresh.mockReset()
  sdk.refresh.mockResolvedValue(null)
  sdk.config.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
it('does not infer a session from a different origin or an absent cookie', async () => {
  expect(
    await verifiedSession(new Request('https://preview.example/workspace')),
  ).toBeNull()
  expect(transport).not.toHaveBeenCalled()
})
it('validates the session against this origin and uses only provider identity and roles', async () => {
  transport.mockResolvedValue(
    Response.json({
      id: 'verified-owner',
      confirmed_at: '2026-01-01T00:00:00Z',
      app_metadata: { roles: ['member'] },
      user_metadata: { roles: ['platform_admin'] },
    }),
  )
  expect(await verifiedSession(request())).toMatchObject({
    id: 'verified-owner',
    roles: ['member'],
  })
  expect(String(transport.mock.calls[0][0])).toBe(
    'https://example.netlify.app/.netlify/identity/user',
  )
})
it('uses refreshed sessions before provider verification', async () => {
  sdk.refresh.mockResolvedValue('rotated-session')
  transport.mockResolvedValue(Response.json({ id: 'verified-owner' }))
  await verifiedSession(request())
  expect(transport.mock.calls[0][1].headers.Authorization).toBe(
    'Bearer rotated-session',
  )
})
it('treats rejected or expired sessions as signed out', async () => {
  transport.mockResolvedValue(new Response(null, { status: 401 }))
  expect(await verifiedSession(request())).toBeNull()
})
it.each([503, 502, 429])(
  'keeps provider failure %s distinct from signed out',
  async (status) => {
    transport.mockResolvedValue(new Response(null, { status }))
    await expect(verifiedSession(request())).rejects.toMatchObject({
      code: 'IDENTITY_UNAVAILABLE',
      status: 503,
    })
  },
)
it('keeps network failure distinct from signed out', async () => {
  transport.mockRejectedValue(new Error('offline'))
  await expect(verifiedSession(request())).rejects.toMatchObject({
    code: 'IDENTITY_UNAVAILABLE',
  })
})
it('returns to login when an expired refresh session is rejected', async () => {
  sdk.refresh.mockRejectedValue(
    Object.assign(new Error('Refresh rejected'), { status: 400 }),
  )
  expect(await verifiedSession(request())).toBeNull()
  expect(transport).not.toHaveBeenCalled()
})
it.each([
  { stage: 'refresh', status: 503 },
  { stage: 'network', status: undefined },
  { stage: 'http', status: 429 },
  { stage: 'json', status: 200 },
  { stage: 'response_shape', status: 200 },
])(
  'reports only the fixed $stage failure and HTTP status',
  async ({ stage, status }) => {
    const diagnostic = vi.fn()
    const privateMessage = 'private-provider-body-and-session-details'
    if (stage === 'refresh')
      sdk.refresh.mockRejectedValue(
        Object.assign(new Error(privateMessage), { status }),
      )
    else if (stage === 'network')
      transport.mockRejectedValue(new Error(privateMessage))
    else if (stage === 'http')
      transport.mockResolvedValue(new Response(privateMessage, { status }))
    else if (stage === 'json')
      transport.mockResolvedValue(new Response(privateMessage, { status }))
    else transport.mockResolvedValue(Response.json({ email: privateMessage }))
    await expect(verifiedSession(request(), diagnostic)).rejects.toMatchObject({
      code: 'IDENTITY_UNAVAILABLE',
      status: 503,
    })
    expect(diagnostic.mock.calls).toMatchObject([
      [
        expect.objectContaining({
          stage,
          ...(status === undefined ? {} : { httpStatus: status }),
        }),
      ],
    ])
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(privateMessage)
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('test-session')
  },
)
it('reports rejected sessions without changing the signed-out decision', async () => {
  const diagnostic = vi.fn()
  transport.mockResolvedValue(new Response(null, { status: 401 }))
  expect(await verifiedSession(request(), diagnostic)).toBeNull()
  expect(diagnostic).toHaveBeenCalledWith({
    stage: 'http',
    httpStatus: 401,
    endpointHost: 'example.netlify.app',
  })
})
it('does not emit a failure for a valid provider response', async () => {
  const diagnostic = vi.fn()
  transport.mockResolvedValue(Response.json({ id: 'verified-owner' }))
  await verifiedSession(request(), diagnostic)
  expect(diagnostic).not.toHaveBeenCalled()
})

it('uses the platform Identity endpoint for a custom-domain request and never its operator token', async () => {
  sdk.config.mockReturnValue({
    url: 'https://provider.example/.netlify/identity',
    token: 'private-operator-marker',
  })
  transport.mockResolvedValue(
    Response.json({
      id: 'verified-owner',
      confirmed_at: '2026-01-01T00:00:00Z',
    }),
  )
  await verifiedSession(
    new Request('https://mycottagepantry.com/api/account-access', {
      headers: { cookie: 'nf_jwt=test-session' },
    }),
  )
  expect(String(transport.mock.calls[0][0])).toBe(
    'https://provider.example/.netlify/identity/user',
  )
  expect(transport.mock.calls[0][1].headers.Authorization).toBe(
    'Bearer test-session',
  )
  expect(JSON.stringify(transport.mock.calls)).not.toContain(
    'private-operator-marker',
  )
})

it('recovers once from a connection reset without repeating SDK refresh', async () => {
  vi.useFakeTimers()
  const diagnostic = vi.fn()
  transport
    .mockRejectedValueOnce(
      new TypeError('private URL', { cause: { code: 'ECONNRESET' } }),
    )
    .mockResolvedValueOnce(Response.json({ id: 'verified-owner' }))
  const result = verifiedSession(request(), diagnostic)
  await vi.advanceTimersByTimeAsync(200)
  expect(await result).toMatchObject({ id: 'verified-owner' })
  expect(transport).toHaveBeenCalledTimes(2)
  expect(sdk.refresh).toHaveBeenCalledOnce()
  expect(diagnostic).toHaveBeenCalledWith(
    expect.objectContaining({
      category: 'connection',
      retrying: true,
      attempt: 1,
    }),
  )
  expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private URL')
})

it('fails closed after two network failures without deleting cookies or looping', async () => {
  vi.useFakeTimers()
  transport.mockRejectedValue(
    new TypeError('private transport', { cause: { code: 'EAI_AGAIN' } }),
  )
  const result = expect(verifiedSession(request())).rejects.toMatchObject({
    code: 'IDENTITY_UNAVAILABLE',
  })
  await vi.advanceTimersByTimeAsync(200)
  await result
  expect(transport).toHaveBeenCalledTimes(2)
})

it('aborts both timed-out attempts within the ten-second verification budget', async () => {
  vi.useFakeTimers()
  const signals: AbortSignal[] = []
  transport.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        signals.push(options.signal)
        options.signal.addEventListener(
          'abort',
          () => reject(new DOMException('private timeout', 'AbortError')),
          { once: true },
        )
      }),
  )
  const diagnostic = vi.fn()
  const result = expect(
    verifiedSession(request(), diagnostic),
  ).rejects.toMatchObject({ code: 'IDENTITY_UNAVAILABLE' })
  await vi.advanceTimersByTimeAsync(9200)
  await result
  expect(signals).toHaveLength(2)
  expect(signals.every((signal) => signal.aborted)).toBe(true)
  expect(diagnostic.mock.calls[1][0]).toMatchObject({
    category: 'timeout',
    attempt: 2,
    retrying: false,
  })
  expect(diagnostic.mock.calls[1][0].elapsedMs).toBeLessThanOrEqual(10000)
})

it('never retries a certificate failure or follows provider redirects', async () => {
  transport.mockRejectedValue(
    new TypeError('private certificate', {
      cause: { code: 'CERT_HAS_EXPIRED' },
    }),
  )
  await expect(verifiedSession(request())).rejects.toMatchObject({
    code: 'IDENTITY_UNAVAILABLE',
  })
  expect(transport).toHaveBeenCalledOnce()
  expect(transport.mock.calls[0][1].redirect).toBe('error')
})

function customDomainRequest() {
  vi.stubGlobal('Netlify', {
    context: {
      site: { name: 'mycottagepantry', url: 'https://mycottagepantry.com' },
      deploy: { context: 'production' },
    },
  })
  sdk.config.mockReturnValue({
    url: 'https://mycottagepantry.com/.netlify/identity',
  })
  return new Request('https://mycottagepantry.com/api/account-access', {
    headers: { cookie: 'nf_jwt=test-session' },
  })
}

it.each(['ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ETIMEDOUT'])(
  'uses this site’s Netlify route on the single retry after %s',
  async (code) => {
    vi.useFakeTimers()
    const req = customDomainRequest()
    const diagnostic = vi.fn()
    transport
      .mockRejectedValueOnce(
        new TypeError('private detail', { cause: { code } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 'verified-owner',
          confirmed_at: '2026-01-01T00:00:00Z',
          app_metadata: { roles: ['member'] },
        }),
      )
    const pending = verifiedSession(req, diagnostic)
    await vi.advanceTimersByTimeAsync(200)
    expect(await pending).toMatchObject({
      id: 'verified-owner',
      roles: ['member'],
    })
    expect(transport.mock.calls.map(([url]) => String(url))).toEqual([
      'https://mycottagepantry.com/.netlify/identity/user',
      'https://mycottagepantry.netlify.app/.netlify/identity/user',
    ])
    expect(sdk.refresh).toHaveBeenCalledOnce()
    expect(transport.mock.calls[1][1]).toMatchObject({
      headers: { Authorization: 'Bearer test-session' },
      redirect: 'error',
    })
    expect(diagnostic.mock.calls[0][0].endpointHost).toBe('mycottagepantry.com')
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(
      /private detail|test-session/,
    )
  },
)

it.each([401, 403, 429, 503])(
  'never changes routes after provider HTTP %s',
  async (status) => {
    const req = customDomainRequest()
    transport.mockResolvedValue(new Response(null, { status }))
    if (status === 401 || status === 403)
      expect(await verifiedSession(req)).toBeNull()
    else
      await expect(verifiedSession(req)).rejects.toMatchObject({
        code: 'IDENTITY_UNAVAILABLE',
      })
    expect(transport).toHaveBeenCalledOnce()
  },
)

it.each(['certificate', 'invalid_json', 'invalid_user'])(
  'never changes routes for %s',
  async (failure) => {
    const req = customDomainRequest()
    if (failure === 'certificate')
      transport.mockRejectedValue(
        new TypeError('private', {
          cause: { code: 'CERT_HAS_EXPIRED' },
        }),
      )
    else if (failure === 'invalid_json')
      transport.mockResolvedValue(new Response('private'))
    else transport.mockResolvedValue(Response.json({ email: 'private' }))
    await expect(verifiedSession(req)).rejects.toMatchObject({
      code: 'IDENTITY_UNAVAILABLE',
    })
    expect(transport).toHaveBeenCalledOnce()
  },
)

it('keeps both-route failure recoverable, bounded, and credential-free in diagnostics', async () => {
  vi.useFakeTimers()
  const req = customDomainRequest()
  const diagnostic = vi.fn()
  transport.mockRejectedValue(
    new TypeError('private', { cause: { code: 'ECONNRESET' } }),
  )
  const pending = expect(
    verifiedSession(req, diagnostic),
  ).rejects.toMatchObject({
    code: 'IDENTITY_UNAVAILABLE',
  })
  await vi.advanceTimersByTimeAsync(200)
  await pending
  expect(transport).toHaveBeenCalledTimes(2)
  expect(diagnostic.mock.calls[1][0]).toMatchObject({
    endpointHost: 'mycottagepantry.netlify.app',
    attempt: 2,
    retrying: false,
  })
  expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(
    /private|test-session/,
  )
})

it.each(['preview', 'different_provider', 'untrusted_name', 'http'])(
  'does not send the session to an alternate site for %s',
  async (scenario) => {
    vi.useFakeTimers()
    let req = customDomainRequest()
    if (scenario === 'preview') {
      req = new Request(
        'https://agent-123--mycottagepantry.netlify.app/api/account-access',
        {
          headers: { cookie: 'nf_jwt=test-session' },
        },
      )
      sdk.config.mockReturnValue({
        url: 'https://agent-123--mycottagepantry.netlify.app/.netlify/identity',
      })
    } else if (scenario === 'different_provider') {
      sdk.config.mockReturnValue({
        url: 'https://identity.example/user-service',
      })
    } else if (scenario === 'untrusted_name') {
      vi.stubGlobal('Netlify', {
        context: {
          site: {
            name: 'attacker.example/path',
            url: 'https://mycottagepantry.com',
          },
          deploy: { context: 'production' },
        },
      })
    } else {
      sdk.config.mockReturnValue({ url: 'http://localhost/.netlify/identity' })
    }
    transport.mockRejectedValue(
      new TypeError('private', { cause: { code: 'ECONNRESET' } }),
    )
    const pending = expect(verifiedSession(req)).rejects.toMatchObject({
      code: 'IDENTITY_UNAVAILABLE',
    })
    await vi.advanceTimersByTimeAsync(200)
    await pending
    expect(transport).toHaveBeenCalledTimes(2)
    expect(String(transport.mock.calls[1][0])).toBe(
      String(transport.mock.calls[0][0]),
    )
  },
)

it('does not enable the production alternate in a preview or unknown runtime context', async () => {
  vi.useFakeTimers()
  const req = customDomainRequest()
  vi.stubGlobal('Netlify', {
    context: {
      site: { name: 'mycottagepantry', url: 'https://mycottagepantry.com' },
      deploy: { context: 'deploy-preview' },
    },
  })
  transport.mockRejectedValue(
    new TypeError('private', { cause: { code: 'ECONNRESET' } }),
  )
  const pending = expect(verifiedSession(req)).rejects.toMatchObject({
    code: 'IDENTITY_UNAVAILABLE',
  })
  await vi.advanceTimersByTimeAsync(200)
  await pending
  expect(transport.mock.calls.map(([url]) => String(url))).toEqual([
    'https://mycottagepantry.com/.netlify/identity/user',
    'https://mycottagepantry.com/.netlify/identity/user',
  ])
})

it('requires provider verification on the alternate route and honors its rejection', async () => {
  vi.useFakeTimers()
  const req = customDomainRequest()
  transport
    .mockRejectedValueOnce(
      new TypeError('private', { cause: { code: 'ECONNRESET' } }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
  const pending = verifiedSession(req)
  await vi.advanceTimersByTimeAsync(200)
  expect(await pending).toBeNull()
  expect(transport).toHaveBeenCalledTimes(2)
})
