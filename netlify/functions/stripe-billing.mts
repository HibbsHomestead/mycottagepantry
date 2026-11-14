import { deploymentRuntime } from '../lib/runtime-environment'
import { adminTransaction } from '../lib/platform-admin-core'
import { launchPricing } from '../../src/lib/launch-plans'
import { stripeSettings, stripeTierPurchasable } from '../lib/stripe-provider'
import { z, ZodError } from 'zod'
import {
  registrationActor,
  registrationTransaction,
  RegistrationError,
  registrationRateLimit,
} from '../lib/registration-core'
import {
  stripeCheckout,
  stripeOwnerView,
  stripePortal,
  stripeRefresh,
} from '../lib/stripe-subscriptions'
import { AdminError } from '../lib/platform-admin-core'
import { limitedBody } from '../lib/support-core'
export default async (request: Request) => {
  const headers = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  }
  try {
    if (!['GET', 'POST'].includes(request.method))
      return new Response(null, { status: 405, headers })
    if (
      request.method === 'GET' &&
      new URL(request.url).searchParams.get('view') === 'availability'
    ) {
      const plans = await adminTransaction(async (c) => {
        const settings = await stripeSettings(c, 'live')
        if (
          deploymentRuntime().context !== 'production' ||
          !settings?.checkout_enabled ||
          !settings.validated_at ||
          settings.configuration?.apiError ||
          !settings.webhook_verified_at ||
          !settings.configuration?.policy
        )
          return []
        return launchPricing.plans
          .filter(
            (p) =>
              p.assignable &&
              stripeTierPurchasable(p.id, 'live') &&
              settings.configuration?.mappings?.[p.id]?.verifiedAt &&
              settings.configuration?.mappings?.[p.id]?.account ===
                settings.account_id &&
              settings.configuration?.mappings?.[p.id]?.purchase,
          )
          .map((p) => p.id)
      })
      return Response.json({ plans }, { headers })
    }
    const actor = await registrationActor(false, request)
    if (
      request.method === 'POST' &&
      (request.headers.get('origin') !== new URL(request.url).origin ||
        !request.headers.get('content-type')?.startsWith('application/json'))
    )
      throw new RegistrationError(
        403,
        'ORIGIN_FORBIDDEN',
        'Use billing from this site.',
      )
    const input =
      request.method === 'POST'
        ? z
            .object({
              action: z.enum(['checkout', 'refresh', 'portal']),
              environment: z.enum(['test', 'live']).optional(),
              plan: z.string().max(100).optional(),
              confirmed: z.boolean().optional(),
            })
            .strict()
            .parse(JSON.parse((await limitedBody(request, 2000)).toString()))
        : null
    await registrationTransaction(actor, async (c) => {
      await c.query("SELECT set_config('app.billing_worker','true',true)")
      await registrationRateLimit(c, actor.id, 'stripe-billing', 30)
    })
    if (input?.action === 'checkout') {
      // Commit the reservation before any provider resource is created.
      await registrationTransaction(actor, (c) =>
        stripeCheckout(
          c,
          actor,
          {
            environment: input.environment || 'test',
            plan: input.plan || '',
            confirmed: input.confirmed === true,
          },
          true,
        ),
      )
    }
    const result = await registrationTransaction(actor, async (c) => {
      await c.query("SELECT set_config('app.billing_worker','true',true)")
      if (!input) return stripeOwnerView(c, actor)
      if (input.action === 'refresh') return stripeRefresh(c, actor)
      if (input.action === 'portal') return stripePortal(c, actor)
      return stripeCheckout(c, actor, {
        environment: input.environment || 'test',
        plan: input.plan || '',
        confirmed: input.confirmed === true,
      })
    })
    return Response.json(result, { headers })
  } catch (error) {
    const known =
      error instanceof RegistrationError || error instanceof AdminError
    return Response.json(
      {
        error: known
          ? error.message
          : 'Billing is temporarily unavailable. Existing access is preserved.',
        code: known ? error.code : 'BILLING_UNAVAILABLE',
      },
      {
        status: known
          ? error.status
          : error instanceof ZodError || error instanceof SyntaxError
            ? 400
            : 503,
        headers,
      },
    )
  }
}
export const config = { path: '/api/stripe/billing' }
