import { SessionError } from '../lib/verified-session'
import { requireLegacyAdmin } from '../lib/platform-admin-legacy'
import { AdminError } from '../lib/platform-admin-core'
import { ZodError } from 'zod'
import type { Config } from '@netlify/functions'
import { registrationReadiness } from '../../src/lib/registration'
import { publicRegistrationPolicy } from '../lib/registration-policies'
import { createFreeWorkspace } from '../lib/free-registration'
import {
  registrationActor,
  workspaceAccess,
  registrationTransaction,
  RegistrationError,
  registrationView,
  saveRegistrationDraft,
  acceptFixturePolicy,
  provisionTestWorkspace,
  saveChecklist,
} from '../lib/registration-core'

export default async (request: Request) => {
  const headers = {
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  }
  try {
    const url = new URL(request.url)
    if (
      request.method === 'GET' &&
      ['readiness', 'policies'].includes(url.searchParams.get('view') || '')
    ) {
      const policy = await publicRegistrationPolicy()
      return Response.json(
        url.searchParams.get('view') === 'policies'
          ? { policy }
          : registrationReadiness(!!policy),
        { headers },
      )
    }
    if (!['GET', 'POST'].includes(request.method))
      return Response.json(
        { error: 'Method not allowed.' },
        { status: 405, headers },
      )
    const view = url.searchParams.get('view')
    const billingViews = ['billing', 'billing-admin']
    const actor = await registrationActor(
      view !== 'free' &&
        !billingViews.includes(view || '') &&
        ((request.method === 'POST' && view !== 'access') ||
          (view !== 'access' && view !== 'operations')),
      request,
    )
    if (
      view === 'operations' ||
      view === 'billing-admin' ||
      (request.method === 'POST' &&
        view !== 'free' &&
        view !== 'access' &&
        view !== 'billing')
    )
      await requireLegacyAdmin(request, actor.id)
    if (billingViews.includes(view || ''))
      return Response.json(
        {
          code: 'BILLING_ROUTE_RETIRED',
          error: 'Use Subscription & Billing in My Oven.',
        },
        { status: 410, headers },
      )
    if (request.method === 'POST' && view === 'free') {
      if (request.headers.get('origin') !== url.origin)
        throw new RegistrationError(
          403,
          'ORIGIN_FORBIDDEN',
          'Create your oven on this site.',
        )
      const text = await request.text()
      if (text.length > 12000)
        throw new RegistrationError(
          413,
          'REQUEST_TOO_LARGE',
          'The request is too large.',
        )
      const result = await registrationTransaction(actor, (client) =>
        createFreeWorkspace(client, actor, JSON.parse(text)),
      )
      return Response.json(result, {
        headers: {
          ...headers,
          'Set-Cookie': `cp_selected_workspace=${result.workspaceId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
        },
      })
    }
    if (request.method === 'POST' && view === 'access') {
      if (request.headers.get('origin') !== url.origin)
        throw new RegistrationError(
          403,
          'ORIGIN_FORBIDDEN',
          'Please select an oven on this site.',
        )
      const text = await request.text()
      if (text.length > 200)
        throw new RegistrationError(
          400,
          'INVALID_SELECTION',
          'Invalid oven selection.',
        )
      const { workspaceId } = JSON.parse(text)
      await registrationTransaction(actor, async (client) => {
        const access = await workspaceAccess(client, actor)
        if (!access.memberships.some((row) => row.id === workspaceId))
          throw new RegistrationError(
            403,
            'WORKSPACE_FORBIDDEN',
            'You do not have access to this oven.',
          )
      })
      return Response.json(
        { selected: true },
        {
          headers: {
            ...headers,
            'Set-Cookie': `cp_selected_workspace=${workspaceId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
          },
        },
      )
    }
    if (request.method === 'GET')
      return Response.json(
        await registrationTransaction(actor, async (client) => {
          if (view === 'access') return workspaceAccess(client, actor)
          if (view === 'operations') {
            if (!actor.platformAdmin)
              throw new RegistrationError(
                403,
                'ADMIN_REQUIRED',
                'Platform administrator access is required.',
              )
            return {
              drafts: (
                await client.query(
                  'SELECT stage,count(*)::int AS count FROM registration_drafts GROUP BY stage',
                )
              ).rows,
              events: (
                await client.query(
                  'SELECT id,kind,status,attempts,error_code,received_at FROM billing_events ORDER BY received_at DESC LIMIT 30',
                )
              ).rows,
              grants: (
                await client.query(
                  'SELECT id,business_id,owner_identity,actor_identity,reason,created_at FROM complimentary_grants ORDER BY created_at DESC LIMIT 30',
                )
              ).rows,
            }
          }
          return registrationView(client, actor)
        }),
        { headers },
      )
    if (!actor.privateTest)
      throw new RegistrationError(
        403,
        'ACTIVATION_CLOSED',
        'Public activation is closed.',
      )
    if (request.headers.get('origin') !== url.origin)
      throw new RegistrationError(
        403,
        'ORIGIN_FORBIDDEN',
        'This request must come from Cottage Pantry.',
      )
    const text = await request.text()
    if (text.length > 12000)
      throw new RegistrationError(
        413,
        'REQUEST_TOO_LARGE',
        'The request is too large.',
      )
    const data = JSON.parse(text)
    const result = await registrationTransaction(actor, async (client) => {
      if (data.action === 'saveDraft')
        return saveRegistrationDraft(client, actor, data)
      if (data.action === 'acceptFixture')
        return acceptFixturePolicy(client, actor, data)
      if (data.action === 'provisionTest' && Object.keys(data).length === 1)
        return provisionTestWorkspace(client, actor)
      if (data.action === 'checklist') return saveChecklist(client, actor, data)
      throw new RegistrationError(
        409,
        'ACTION_UNAVAILABLE',
        'This action is unavailable. Public acceptance, invitations, live checkout and grants remain blocked.',
      )
    })
    return Response.json(result, { headers })
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError)
      return Response.json(
        {
          code: 'INVALID_REGISTRATION_INPUT',
          error: 'Check the highlighted business details and try again.',
          fields:
            error instanceof ZodError
              ? Object.fromEntries(
                  error.issues.map((issue) => [
                    issue.path.join('.'),
                    issue.message,
                  ]),
                )
              : undefined,
        },
        { status: 400, headers },
      )
    const known =
      error instanceof RegistrationError ||
      error instanceof SessionError ||
      error instanceof AdminError
    return Response.json(
      {
        code: known ? error.code : 'REGISTRATION_REQUEST_FAILED',
        error: known
          ? error.message
          : 'The request could not be completed. Check the form and try again.',
      },
      { status: known ? error.status : 503, headers },
    )
  }
}
export const config: Config = { path: '/api/registration' }
