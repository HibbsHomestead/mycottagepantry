import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { ZodError } from 'zod'
import { SessionError } from '../lib/verified-session'
import {
  registrationActor,
  registrationRateLimit,
  RegistrationError,
  type RegistrationClient,
} from '../lib/registration-core'
import {
  prepareSignupIntent,
  resumeSignupIntent,
  signupIntentCookie,
  signupIntentInput,
} from '../lib/signup-plan-intent'

export default async (request: Request, context: Context) => {
  const headers = {
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Cookie',
  }
  if (request.method !== 'POST')
    return Response.json(
      { error: 'Method not allowed.' },
      { status: 405, headers },
    )
  let client: RegistrationClient | undefined
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin)
      throw new RegistrationError(
        403,
        'ORIGIN_FORBIDDEN',
        'Choose a plan on this site.',
      )
    const text = await request.text()
    if (text.length > 300)
      throw new RegistrationError(
        413,
        'REQUEST_TOO_LARGE',
        'The request is too large.',
      )
    const input = signupIntentInput.parse(JSON.parse(text))
    const actor =
      input.action === 'resume' ? await registrationActor(false, request) : null
    client = (await getDatabase().pool.connect()) as RegistrationClient
    await client.query('BEGIN')
    await client.query(
      "SELECT set_config('app.signup_intent_worker','true',true),set_config('app.billing_worker','true',true)",
    )
    await registrationRateLimit(
      client,
      actor?.id || context.ip || 'unknown',
      'signup-plan',
      actor ? 120 : 30,
    )
    if (actor)
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        ['signup-plan:' + actor.id],
      )
    const result =
      input.action === 'prepare'
        ? await prepareSignupIntent(client, input.planId)
        : await resumeSignupIntent(
            client,
            actor!,
            input.planId,
            signupIntentCookie(request),
          )
    await client.query('COMMIT')
    return Response.json(result, {
      headers: {
        ...headers,
        ...('intentId' in result
          ? {
              'Set-Cookie': `cp_signup_intent=${result.intentId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
            }
          : {}),
      },
    })
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    const invalid = error instanceof ZodError || error instanceof SyntaxError
    const known =
      error instanceof RegistrationError || error instanceof SessionError
    return Response.json(
      {
        code: known
          ? error.code
          : invalid
            ? 'INVALID_PLAN_INPUT'
            : 'PLAN_SELECTION_UNAVAILABLE',
        error: known
          ? error.message
          : invalid
            ? 'Check the plan selection. Prices and access cannot be supplied by this form.'
            : 'Your plan choice could not be saved. Please retry; no account or subscription was created by this request.',
      },
      { status: known ? error.status : invalid ? 400 : 503, headers },
    )
  } finally {
    client?.release()
  }
}
export const config: Config = { path: '/api/signup-plan' }
