import { subscriptionExpenseRequest } from '../lib/subscription-expenses'
import { customerMessage } from '../../src/lib/customer-message'
import { deploymentRuntime } from '../lib/runtime-environment'
import { adminTransaction } from '../lib/platform-admin-core'
import { stripeSettings } from '../lib/stripe-provider'
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
import { stripePlanAvailability } from '../lib/stripe-availability'
import {
  stripeChangePreview,
  stripeConfirmChange,
  stripeCancelPending,
} from '../lib/stripe-changes'
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
      const tiers = await adminTransaction(async (c) => {
        const settings = await stripeSettings(c, 'live')
        return stripePlanAvailability(
          settings,
          'live',
          deploymentRuntime().context === 'production',
        )
      })
      return Response.json(
        {
          plans: tiers.filter((p) => p.purchasable).map((p) => p.id),
          ...(new URL(request.url).searchParams.get('details') === '1'
            ? { tiers }
            : {}),
        },
        { headers },
      )
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
              action: z.enum([
                'checkout',
                'refresh',
                'portal',
                'preview_change',
                'confirm_change',
                'cancel_pending',
                'expenses',
                'expense_record',
                'expense_skip',
                'expense_preferences',
              ]),
              environment: z.enum(['test', 'live']).optional(),
              plan: z.string().max(100).optional(),
              confirmed: z.boolean().optional(),
              changeId: z.uuid().optional(),
              paymentId: z.uuid().optional(),
              draft: z.boolean().optional(),
              enabled: z.boolean().optional(),
              category: z.string().max(200).optional(),
              account: z.string().max(200).optional(),
            })
            .strict()
            .parse(JSON.parse((await limitedBody(request, 2000)).toString()))
        : null
    await registrationTransaction(actor, async (c) => {
      await c.query("SELECT set_config('app.billing_worker','true',true)")
      const expenses =
        input &&
        [
          'expenses',
          'expense_record',
          'expense_skip',
          'expense_preferences',
        ].includes(input.action)
      await registrationRateLimit(
        c,
        actor.id,
        expenses ? 'subscription-expenses' : 'stripe-billing',
        expenses ? 120 : 30,
      )
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
    if (input?.action === 'confirm_change') {
      if (!input.confirmed || !input.changeId)
        throw new RegistrationError(
          400,
          'CONFIRMATION_REQUIRED',
          'Review the provider preview and confirm this subscription change.',
        )
      await registrationTransaction(actor, (c) =>
        stripeConfirmChange(c, actor, input.changeId!, true),
      )
    }
    const result = await registrationTransaction(actor, async (c) => {
      await c.query("SELECT set_config('app.billing_worker','true',true)")
      if (!input) return stripeOwnerView(c, actor)
      if (
        [
          'expenses',
          'expense_record',
          'expense_skip',
          'expense_preferences',
        ].includes(input.action)
      )
        return subscriptionExpenseRequest(c, actor, input)
      if (input.action === 'refresh') return stripeRefresh(c, actor)
      if (input.action === 'portal') return stripePortal(c, actor)
      if (input.action === 'preview_change') {
        await stripeRefresh(c, actor)
        return stripeChangePreview(c, actor, input.plan || '')
      }
      if (input.action === 'confirm_change') {
        await stripeConfirmChange(c, actor, input.changeId!)
        return stripeRefresh(c, actor)
      }
      if (input.action === 'cancel_pending') {
        if (!input.confirmed)
          throw new RegistrationError(
            400,
            'CONFIRMATION_REQUIRED',
            'Confirm that you want to keep the current subscription.',
          )
        await stripeCancelPending(c, actor)
        return stripeRefresh(c, actor)
      }
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
          ? customerMessage(error)
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
