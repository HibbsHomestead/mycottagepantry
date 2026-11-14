import { reconcileSupportBilling } from '../lib/support-billing-recovery'
import { adminMembership, adminIdentityStatus } from '../lib/admin-memberships'
import {
  stripeAdminAction,
  stripeAdminView,
  stripeEndpoint,
} from '../lib/stripe-provider'
import {
  deploymentRuntime,
  serverEnvironment,
  stripeEncryptionStatus,
} from '../lib/runtime-environment'
import { handleAdminAccess } from '../lib/admin-access'
import { handleAdminCatalog } from '../lib/catalog-admin'
import { handleRegistrationPolicies } from '../lib/registration-policies'
import type { Context } from '@netlify/functions'
import { login, requestPasswordRecovery } from '@netlify/identity'
import { z, ZodError } from 'zod'
import {
  afterTotpVerification,
  totpAction,
  totpConfigured,
} from '../lib/platform-admin-totp'
import {
  afterSmsVerification,
  smsEnrollAction,
  smsLoginSend,
  smsDestinationKey,
  smsLoginVerify,
  SmsProviderError,
  smsStatus,
} from '../lib/platform-admin-sms'
import { limitedBody } from '../lib/support-core'
import {
  AdminError,
  adminTransaction,
  audit,
  clientAddress,
  createSession,
  currentIdentity,
  requestReference,
  requireAdmin,
  hasRecentAdminVerification,
  requireAdminOrigin,
  requireRate,
  sessionCookie,
  sessionToken,
} from '../lib/platform-admin-core'
import { readAdministration } from '../lib/platform-admin-read'

export default async (request: Request, context: Context) => {
  const reference = requestReference()
  let actor: string | null = null
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Netlify-CDN-Cache-Control': 'no-store',
    Vary: 'Cookie, Origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-origin',
  })
  let trustedOrigin = false
  let smsInput: unknown = null
  try {
    const origin = requireAdminOrigin(request)
    trustedOrigin = true
    if (!['GET', 'POST'].includes(request.method))
      throw new AdminError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
    await requireRate(clientAddress(context), 'gateway', 240, 60)
    const url = new URL(request.url)
    const action = url.searchParams.get('action')
    if (
      request.method === 'GET' &&
      (action === 'stripe' || url.searchParams.get('section') === 'billing') &&
      ['production', 'deploy-preview'].includes(deploymentRuntime().context)
    ) {
      // Private hosting logs let operators verify injection without an admin
      // session on the affected deployment, including production. Fixed
      // presence/status fields only; never log environment values or errors.
      // The public response still passes every existing auth check.
      console.info(
        'stripe_runtime_status_v2',
        JSON.stringify({
          deployment: context.deploy?.id,
          encryption: stripeEncryptionStatus(),
          liveCredentialPresent: !!serverEnvironment('STRIPE_LIVE_SECRET_KEY'),
          previewWebhookReady: !!stripeEndpoint('test'),
        }),
      )
    }
    if (request.method === 'POST' && action === 'password-recovery') {
      const { email } = z
        .object({ email: z.email().max(254) })
        .strict()
        .parse(JSON.parse((await limitedBody(request, 1000)).toString()))
      await requireRate(clientAddress(context), 'recovery-ip', 5)
      await requireRate(email.trim().toLowerCase(), 'recovery-account', 3)
      try {
        await requestPasswordRecovery(email.trim().toLowerCase())
      } catch (error) {
        // Account existence is never exposed by the recovery endpoint.
        if ((error as { status?: number }).status !== 404)
          throw new AdminError(
            503,
            'RECOVERY_UNAVAILABLE',
            'Password recovery is temporarily unavailable. Please try again later.',
          )
      }
      return Response.json(
        {
          message:
            'If this address has an account, a password reset link has been sent. Follow the email to choose a new password, then return here to sign in with your email and password.',
        },
        { headers },
      )
    }
    if (request.method === 'POST' && action === 'login') {
      const input = z
        .object({
          email: z.email().max(254),
          password: z.string().min(1).max(256),
        })
        .strict()
        .parse(JSON.parse((await limitedBody(request, 4000)).toString()))
      await requireRate(clientAddress(context), 'login-ip', 10)
      await requireRate(input.email.trim().toLowerCase(), 'login-account', 5)
      let identity
      try {
        identity = await login(input.email, input.password)
      } catch {
        throw new AdminError(
          401,
          'LOGIN_FAILED',
          'Sign-in failed. Check your email, password, and administrator access.',
        )
      } finally {
        // The SDK establishes Identity cookies. Admin uses an opaque, host-only
        // HttpOnly session instead; neither provider token reaches frontend code.
        context.cookies.delete('nf_jwt')
        context.cookies.delete('nf_refresh')
      }
      const result = await adminTransaction(async (c) => {
        await currentIdentity(identity.id)
        const grant = (
          await c.query(
            'SELECT identity_id,epoch,role FROM platform_admins WHERE identity_id=$1 AND enabled=true FOR UPDATE',
            [identity.id],
          )
        ).rows[0]
        if (!grant) {
          await audit(c, null, 'login', null, 'denied', reference)
          return null
        }
        actor = identity.id
        const token = await createSession(c, identity.id, grant.epoch, origin)
        await audit(c, actor, 'login', null, 'password_verified', reference)
        return token
      })
      // Same response as a wrong password: never reveal whether an email is an admin.
      if (!result)
        throw new AdminError(
          401,
          'LOGIN_FAILED',
          'Sign-in failed. Check your email, password, and administrator access.',
        )
      headers.append('Set-Cookie', sessionCookie(result))
      return Response.json({ stage: 'authenticated' }, { headers })
    }
    if (action === 'password-verify') {
      await requireRate(clientAddress(context), 'mfa-ip', 20)
      await requireRate(
        sessionToken(request) || 'no-session',
        'mfa-session',
        10,
      )
    }
    if (action === 'sms-verify') {
      await requireRate(clientAddress(context), 'mfa-ip', 20)
      await requireRate(
        sessionToken(request) || 'no-session',
        'mfa-session',
        10,
      )
    }
    if (
      (action === 'sms-send' || action === 'sms-enroll-send') &&
      request.method === 'POST'
    ) {
      // Cost-exhaustion guards by request source and account; the destination
      // and per-session limits are applied once the number is known.
      await requireRate(clientAddress(context), 'sms-ip', 8, 3600)
      smsInput = JSON.parse((await limitedBody(request, 300)).toString())
      const { identity, destination } = await adminTransaction(async (c) => {
        const identity = (await requireAdmin(c, request)).identity_id
        return {
          identity,
          destination: await smsDestinationKey(c, identity, action, smsInput),
        }
      })
      await requireRate(identity, 'sms-account', 8, 3600)
      if (destination)
        await requireRate(destination, 'sms-destination', 6, 3600)
    }
    if (
      (action?.startsWith('totp-') || action === 'password-verify') &&
      request.method === 'POST'
    ) {
      await requireRate(clientAddress(context), 'totp-ip', 20)
      const identity = await adminTransaction(
        async (c) => (await requireAdmin(c, request)).identity_id,
      )
      await requireRate(
        identity,
        action === 'password-verify'
          ? 'password-verification-account'
          : 'totp-account',
        action === 'password-verify' ? 5 : 10,
      )
    }
    if (action === 'stripe' && request.method === 'POST') {
      const identity = await adminTransaction(
        async (c) => (await requireAdmin(c, request)).identity_id,
      )
      await requireRate(identity, 'stripe-settings', 30, 60)
    }
    const result = await adminTransaction(async (c) => {
      const session = await requireAdmin(c, request)
      actor = session.identity_id
      if (action === 'session' && request.method === 'GET') {
        const totp = (
          await c.query(
            'SELECT enabled_at FROM platform_totp WHERE identity_id=$1',
            [actor],
          )
        ).rows[0]
        return {
          ...(await smsStatus(c, session.identity_id)),
          verificationMethod: session.verification_method || null,
          verificationCurrent: hasRecentAdminVerification(session),
          totpEnabled: !!totp?.enabled_at,
          totpAvailable: totpConfigured(),
          stage: 'authenticated',
          identityId: actor,
          identityEmail: session.identity_email,
          role: session.role,
          expiresAt: session.expires_at,
        }
      }
      if (
        ['totp-confirm', 'totp-verify', 'totp-recover', 'totp-cancel'].includes(
          action || '',
        ) &&
        request.method === 'POST'
      ) {
        const input = JSON.parse((await limitedBody(request, 500)).toString())
        const result = await totpAction(c, session, action!, input, reference)
        if (
          result.stage === 'authenticated' ||
          (action === 'totp-confirm' && result.stage === 'recovery_codes')
        ) {
          const token = await createSession(
            c,
            actor!,
            session.epoch,
            origin,
            true,
            action === 'totp-recover' ? 'recovery' : 'totp',
          )
          await c.query('DELETE FROM platform_sessions WHERE token_hash=$1', [
            session.token_hash,
          ])
          headers.append('Set-Cookie', sessionCookie(token))
        }
        return result
      }
      if (action === 'sms-send' && request.method === 'POST')
        return smsLoginSend(c, session, reference)
      if (action === 'sms-verify' && request.method === 'POST') {
        const input = JSON.parse((await limitedBody(request, 200)).toString())
        // Both factors are required: this pending session exists only after
        // password + enabled grant verification, and no session upgrade
        // happens until the provider approves this session's verification.
        const result = await smsLoginVerify(c, session, input, reference)
        if (result.stage === 'authenticated') {
          const token = await createSession(
            c,
            actor!,
            session.epoch,
            origin,
            true,
            'sms',
          )
          await c.query('DELETE FROM platform_sessions WHERE token_hash=$1', [
            session.token_hash,
          ])
          headers.append('Set-Cookie', sessionCookie(token))
        }
        return result
      }
      if (
        ['sms-enroll-send', 'sms-enroll-confirm', 'sms-enroll-cancel'].includes(
          action || '',
        ) &&
        request.method === 'POST'
      ) {
        if (!hasRecentAdminVerification(session))
          throw new AdminError(
            403,
            'MFA_REQUIRED',
            'Phone enrollment is available only inside an authenticated admin session.',
          )
        const input =
          action === 'sms-enroll-send'
            ? smsInput
            : JSON.parse((await limitedBody(request, 300)).toString())
        return smsEnrollAction(c, session, action!, input, reference)
      }
      if (action === 'logout' && request.method === 'POST') {
        await c.query('DELETE FROM platform_sessions WHERE token_hash=$1', [
          session.token_hash,
        ])
        await audit(c, actor, 'logout', null, 'success', reference)
        headers.append('Set-Cookie', sessionCookie('', 0))
        return { stage: 'signed_out' }
      }
      if (action === 'password-verify' && request.method === 'POST') {
        const { password } = z
          .object({ password: z.string().min(1).max(256) })
          .strict()
          .parse(JSON.parse((await limitedBody(request, 1500)).toString()))
        // An enrolled authenticator cannot be bypassed with a password fallback.
        if (session.totp_enabled)
          throw new AdminError(
            403,
            'CODE_REQUIRED',
            'Use your enrolled authenticator or a single-use recovery code.',
          )
        let identity
        try {
          identity = await login(session.identity_email, password)
        } catch {
          throw new AdminError(
            401,
            'VERIFICATION_FAILED',
            'Password verification failed. Try again.',
          )
        } finally {
          context.cookies.delete('nf_jwt')
          context.cookies.delete('nf_refresh')
        }
        if (identity.id !== actor || !identity.confirmedAt)
          throw new AdminError(
            403,
            'VERIFICATION_FAILED',
            'Administrator verification failed.',
          )
        const token = await createSession(
          c,
          actor!,
          session.epoch,
          origin,
          true,
          'password',
        )
        await c.query('DELETE FROM platform_sessions WHERE token_hash=$1', [
          session.token_hash,
        ])
        await audit(
          c,
          actor,
          'admin_reverification',
          actor,
          'success',
          reference,
          null,
          null,
          { method: 'password' },
        )
        headers.append('Set-Cookie', sessionCookie(token))
        return { stage: 'authenticated' }
      }
      if (
        ['totp-enroll', 'totp-remove', 'totp-recovery'].includes(
          action || '',
        ) &&
        request.method === 'POST'
      )
        return afterTotpVerification(c, session, action!, reference)
      if (
        ['sms-enroll', 'sms-remove'].includes(action || '') &&
        request.method === 'POST'
      )
        return afterSmsVerification(c, session, action!, reference)
      if (action === 'business-reconcile' && request.method === 'POST') {
        if (!hasRecentAdminVerification(session))
          throw new AdminError(
            403,
            'MFA_REQUIRED',
            'Verify administrator authentication first.',
          )
        const { businessId } = z
          .object({ businessId: z.uuid() })
          .strict()
          .parse(JSON.parse((await limitedBody(request, 300)).toString()))
        await requireRate(session.identity_id, 'admin-reconciliation', 15, 60)
        await reconcileSupportBilling(c, businessId)
        await audit(
          c,
          actor,
          'billing:reconcile',
          businessId,
          'success',
          reference,
        )
        return { reconciled: true }
      }
      if (action === 'membership')
        return adminMembership(c, request, session, reference)
      if (action === 'identity-status' && request.method === 'GET') {
        if (!hasRecentAdminVerification(session))
          throw new AdminError(
            403,
            'ADMIN_REQUIRED',
            'Verified admin access is required.',
          )
        await c.query("SELECT set_config('app.platform_read','true',true)")
        const identityId = z
          .string()
          .min(1)
          .max(100)
          .parse(url.searchParams.get('identity'))
        return adminIdentityStatus(c, identityId)
      }
      if (action === 'stripe')
        return stripeAdminAction(c, request, session, reference)
      if (action === 'business-access')
        return handleAdminAccess(c, request, session, reference)
      if (action === 'catalog')
        return handleAdminCatalog(c, request, session, reference)
      if (action === 'registration-policies')
        return handleRegistrationPolicies(c, request, session, reference)
      if (action)
        throw new AdminError(
          404,
          'ACTION_UNAVAILABLE',
          'This administration action is unavailable.',
        )
      if (request.method !== 'GET')
        throw new AdminError(
          405,
          'READ_ONLY',
          'This release provides read-only administration views.',
        )
      const data =
        url.searchParams.get('section') === 'billing'
          ? {
              ...(await readAdministration(c, url.searchParams)),
              stripe: await stripeAdminView(c),
            }
          : await readAdministration(c, url.searchParams)
      await audit(
        c,
        actor,
        'read:' + (url.searchParams.get('section') || 'overview'),
        url.searchParams.get('id'),
        'success',
        reference,
      )
      return data
    })
    return Response.json(result, {
      headers,
      status:
        'stage' in result && result.stage === 'verification_failed' ? 403 : 200,
    })
  } catch (error) {
    const known = error instanceof AdminError
    const status = known
      ? error.status
      : error instanceof ZodError || error instanceof SyntaxError
        ? 400
        : 503
    if (trustedOrigin && status !== 429) {
      try {
        await adminTransaction((c) =>
          error instanceof SmsProviderError
            ? audit(
                c,
                error.identity,
                error.smsAction,
                error.identity,
                'provider_rejected',
                reference,
                null,
                null,
                { code: error.code, providerCode: error.providerCode },
              )
            : audit(
                c,
                actor,
                'request',
                null,
                status === 503 ? 'unavailable' : 'denied',
                reference,
              ),
        )
      } catch {
        /* fail closed; never print provider/database errors */
      }
    }
    if (status === 429)
      headers.set(
        'Retry-After',
        known && error.code === 'SMS_COOLDOWN' ? '30' : '600',
      )
    return Response.json(
      {
        code: known
          ? error.code
          : status === 400
            ? 'INVALID_REQUEST'
            : 'ADMIN_UNAVAILABLE',
        error: known
          ? error.message
          : status === 400
            ? 'Invalid administration request.'
            : 'Administration is unavailable. No customer data was loaded.',
        reference,
      },
      { status, headers },
    )
  }
}
export const config = { path: '/api/admin' }
