import { adminMembership, adminIdentityStatus } from '../lib/admin-memberships'
import { stripeAdminAction, stripeAdminView } from '../lib/stripe-provider'
import { handleAdminAccess } from '../lib/admin-access'
import { handleAdminCatalog } from '../lib/catalog-admin'
import { handleRegistrationPolicies } from '../lib/registration-policies'
import type { Context } from '@netlify/functions'
import { login, requestPasswordRecovery } from '@netlify/identity'
import { z, ZodError } from 'zod'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import {
  afterTotpPasskey,
  totpAction,
  totpConfigured,
} from '../lib/platform-admin-totp'
import {
  afterSmsPasskey,
  smsConfigured,
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
  requireAdminOrigin,
  requireRate,
  sessionCookie,
  sessionToken,
} from '../lib/platform-admin-core'
import { readAdministration } from '../lib/platform-admin-read'
import { withSquareConnections } from '../lib/square-credentials'
import {
  beginSquareOAuth,
  completeSquareOAuth,
  confirmSquareConnection,
  squareOAuthAdminStatus,
  squareState,
  squareStateCookie,
  requireSquareOwner,
} from '../lib/square-oauth'

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
    if (action === 'mfa-options' || action === 'mfa-verify') {
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
    if (action?.startsWith('totp-') && request.method === 'POST') {
      await requireRate(clientAddress(context), 'totp-ip', 20)
      const identity = await adminTransaction(
        async (c) => (await requireAdmin(c, request)).identity_id,
      )
      await requireRate(identity, 'totp-account', 10)
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
        const credentials = (
          await c.query(
            'SELECT transports,created_at FROM platform_credentials WHERE identity_id=$1 ORDER BY created_at',
            [actor],
          )
        ).rows
        const totp = (
          await c.query(
            'SELECT enabled_at FROM platform_totp WHERE identity_id=$1',
            [actor],
          )
        ).rows[0]
        return {
          ...(await smsStatus(c, session.identity_id)),
          mfaMethod: session.mfa_method || null,
          totpEnabled: !!totp?.enabled_at,
          totpAvailable: totpConfigured(),
          stage: 'authenticated',
          identityId: actor,
          identityEmail: session.identity_email,
          role: session.role,
          expiresAt: session.expires_at,
          enrollmentUntil: session.enrollment_until,
          credentials: credentials.map((credential) => ({
            transports: credential.transports,
            createdAt: credential.created_at,
          })),
          enrollmentAvailable:
            !credentials.length &&
            !!session.enrollment_until &&
            Date.parse(session.enrollment_until) > Date.now(),
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
        if (result.stage === 'authenticated') {
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
        if (!session.mfa_at)
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
      if (action === 'mfa-options' && request.method === 'POST') {
        const { kind, method, purpose } = z
          .object({
            kind: z.enum(['registration', 'authentication']),
            purpose: z
              .enum([
                'totp-enroll',
                'totp-remove',
                'totp-recovery',
                'sms-enroll',
                'sms-remove',
              ])
              .optional(),
            method: z
              .enum(['device', 'phone', 'security-key'])
              .default('device'),
          })
          .strict()
          .parse(JSON.parse((await limitedBody(request, 300)).toString()))
        if (purpose && (!session.mfa_at || kind !== 'authentication'))
          throw new AdminError(
            403,
            'FRESH_PASSKEY_REQUIRED',
            'Verify your existing passkey from your authenticated phone session.',
          )
        if (purpose === 'totp-enroll' && !totpConfigured())
          throw new AdminError(
            503,
            'MFA_SETUP_UNAVAILABLE',
            'Authenticator setup is unavailable; your passkey still works.',
          )
        if (purpose === 'sms-enroll' && !smsConfigured())
          throw new AdminError(
            503,
            'SMS_UNAVAILABLE',
            'Text-message verification is not switched on yet. Your passkey still works.',
          )
        const credentials = (
          await c.query(
            'SELECT id,transports FROM platform_credentials WHERE identity_id=$1',
            [actor],
          )
        ).rows
        if (
          kind === 'registration' &&
          (credentials.length ||
            !session.enrollment_until ||
            Date.parse(session.enrollment_until) <= Date.now())
        )
          throw new AdminError(
            403,
            'ENROLLMENT_CLOSED',
            'Passkey enrollment is closed. Use your registered passkey, or request audited owner-verified recovery. Existing credentials and enrollment deadlines are preserved.',
          )
        if (kind === 'authentication' && !credentials.length)
          throw new AdminError(
            403,
            'MFA_NOT_ENROLLED',
            'A platform owner must authorize passkey enrollment.',
          )
        const rpID = new URL(origin).hostname
        const options =
          kind === 'registration'
            ? await generateRegistrationOptions({
                rpName: 'Cottage Pantry Admin',
                rpID,
                userName: actor!,
                userDisplayName: session.identity_email,
                userID: new TextEncoder().encode(actor!),
                attestationType: 'none',
                authenticatorSelection: {
                  userVerification: 'required',
                  residentKey: 'preferred',
                },
                supportedAlgorithmIDs: [-7, -257],
              })
            : await generateAuthenticationOptions({
                rpID,
                userVerification: 'required',
                // Preserve account-bound credential selection. Stored transports
                // are advisory browser metadata and can hide a synced/hybrid
                // route; omit them without changing or replacing any credential.
                allowCredentials: credentials.map((r) => ({ id: r.id })),
              })
        // Hints order the chooser without restricting attachment. In particular,
        // preferredAuthenticatorType would also set authenticatorAttachment.
        options.hints =
          method === 'phone'
            ? ['hybrid', 'client-device', 'security-key']
            : method === 'security-key'
              ? ['security-key', 'client-device', 'hybrid']
              : ['client-device', 'hybrid', 'security-key']
        const challenge = await c.query(
          "UPDATE platform_sessions SET challenge=$2,challenge_kind=$3,challenge_purpose=$4,challenge_until=NOW()+INTERVAL '2 minutes' WHERE token_hash=$1 RETURNING challenge_until",
          [session.token_hash, options.challenge, kind, purpose || null],
        )
        await audit(
          c,
          actor,
          'mfa_challenge',
          null,
          'issued',
          reference,
          null,
          null,
          {
            kind,
            method,
            credentialCount: credentials.length,
            transportFilter: false,
          },
        )
        return { options, kind, expiresAt: challenge.rows[0].challenge_until }
      }
      if (action === 'mfa-verify' && request.method === 'POST') {
        const response = JSON.parse(
          (await limitedBody(request, 20000)).toString(),
        )
        if (
          !session.challenge ||
          !session.challenge_until ||
          Date.parse(session.challenge_until) <= Date.now()
        )
          throw new AdminError(
            403,
            'MFA_CHALLENGE_EXPIRED',
            'The passkey challenge expired. Prepare a new challenge and try again.',
          )
        if (
          session.challenge_purpose &&
          (!session.mfa_at || session.challenge_kind !== 'authentication')
        )
          throw new AdminError(
            403,
            'FRESH_PASSKEY_REQUIRED',
            'Use your authenticated phone session.',
          )
        // Consume even failed challenges; returning the failure commits this update.
        await c.query(
          'UPDATE platform_sessions SET challenge=NULL,challenge_kind=NULL,challenge_purpose=NULL,challenge_until=NULL WHERE token_hash=$1',
          [session.token_hash],
        )
        let valid = false
        let registered = false
        try {
          if (session.challenge_kind === 'registration') {
            const existing = (
              await c.query(
                'SELECT id FROM platform_credentials WHERE identity_id=$1',
                [actor],
              )
            ).rows
            if (
              !existing.length &&
              session.enrollment_until &&
              Date.parse(session.enrollment_until) > Date.now()
            ) {
              const verification = await verifyRegistrationResponse({
                response,
                expectedChallenge: session.challenge,
                expectedOrigin: origin,
                expectedRPID: new URL(origin).hostname,
                requireUserVerification: true,
                supportedAlgorithmIDs: [-7, -257],
              })
              if (verification.verified) {
                const credential = verification.registrationInfo.credential
                await c.query(
                  'INSERT INTO platform_credentials(id,identity_id,public_key,counter,transports) VALUES($1,$2,$3,$4,$5)',
                  [
                    credential.id,
                    actor,
                    Buffer.from(credential.publicKey).toString('base64url'),
                    credential.counter,
                    JSON.stringify(credential.transports || []),
                  ],
                )
                await c.query(
                  'UPDATE platform_admins SET enrollment_until=NULL WHERE identity_id=$1',
                  [actor],
                )
                valid = true
                registered = true
              }
            }
          } else if (session.challenge_kind === 'authentication') {
            const credential = (
              await c.query(
                'SELECT * FROM platform_credentials WHERE id=$1 AND identity_id=$2 FOR UPDATE',
                [String(response?.id || '').slice(0, 1500), actor],
              )
            ).rows[0]
            if (credential) {
              const verification = await verifyAuthenticationResponse({
                response,
                expectedChallenge: session.challenge,
                expectedOrigin: origin,
                expectedRPID: new URL(origin).hostname,
                requireUserVerification: true,
                credential: {
                  id: credential.id,
                  publicKey: new Uint8Array(
                    Buffer.from(credential.public_key, 'base64url'),
                  ),
                  counter: credential.counter,
                  transports: credential.transports,
                },
              })
              if (verification.verified) {
                await c.query(
                  'UPDATE platform_credentials SET counter=$2 WHERE id=$1',
                  [credential.id, verification.authenticationInfo.newCounter],
                )
                valid = true
              }
            }
          }
        } catch (error) {
          // Database errors must roll back; WebAuthn validation failures are safe denials.
          if (typeof (error as { code?: unknown })?.code === 'string')
            throw error
        }
        await audit(
          c,
          actor,
          registered ? 'mfa_enrolled' : 'mfa_verification',
          registered ? actor : null,
          valid ? 'success' : 'denied',
          reference,
          registered
            ? 'Controlled enrollment following administrator password verification'
            : null,
          registered ? { mfaEnrolled: false } : null,
          registered ? { mfaEnrolled: true } : null,
        )
        if (!valid)
          return {
            stage: 'verification_failed',
            error:
              'Passkey verification failed. Prepare a new challenge and try again.',
          }
        if (session.challenge_purpose?.startsWith('sms-'))
          return afterSmsPasskey(
            c,
            session,
            session.challenge_purpose,
            reference,
          )
        if (session.challenge_purpose)
          return afterTotpPasskey(
            c,
            session,
            session.challenge_purpose,
            reference,
          )
        const token = await createSession(
          c,
          actor!,
          session.epoch,
          origin,
          true,
        )
        await c.query('DELETE FROM platform_sessions WHERE token_hash=$1', [
          session.token_hash,
        ])
        headers.append('Set-Cookie', sessionCookie(token))
        return { stage: 'authenticated' }
      }
      if (
        request.method === 'POST' &&
        [
          'billing-connect',
          'billing-oauth-complete',
          'billing-confirm-connection',
        ].includes(action || '')
      ) {
        requireSquareOwner(session)
        const environment = z
          .enum(['sandbox', 'production'])
          .parse(url.searchParams.get('environment'))
        let outcome
        if (action === 'billing-connect') {
          const started = await beginSquareOAuth(c, session, environment)
          headers.append('Set-Cookie', started.cookie)
          outcome = { url: started.url }
        } else if (action === 'billing-oauth-complete') {
          outcome = await completeSquareOAuth(c, session, squareState(request))
        } else {
          const input = JSON.parse(
            (await limitedBody(request, 1000)).toString(),
          )
          outcome = await confirmSquareConnection(
            c,
            session,
            squareState(request),
            input,
          )
          headers.append('Set-Cookie', squareStateCookie('', 0))
        }
        await audit(
          c,
          actor,
          action!,
          environment,
          'ok' in outcome && outcome.ok === false
            ? 'verification_failed'
            : 'success',
          reference,
        )
        return outcome
      }
      if (
        request.method === 'POST' &&
        (action === 'billing-verify' ||
          action === 'billing-sync-plans' ||
          action === 'billing-verify-mappings')
      ) {
        requireSquareOwner(session)
        // Platform subscription billing only; separate from customer Square sync.
        const environment =
          url.searchParams.get('environment') === 'production'
            ? 'production'
            : 'sandbox'
        const billing = await import('../lib/billing-service')
        try {
          const outcome =
            action === 'billing-verify'
              ? await withSquareConnections(c, () =>
                  billing.recordConnectionCheck(c, environment),
                )
              : action === 'billing-verify-mappings'
                ? await withSquareConnections(c, () =>
                    billing.verifyPlanMappings(c, environment),
                  )
                : await withSquareConnections(c, () =>
                    billing.syncPlanMappings(c, environment),
                  )
          await audit(c, actor, action, environment, 'success', reference)
          return outcome
        } catch (error) {
          const e = error as {
            status?: number
            code?: string
            message?: string
          }
          throw new AdminError(
            e.status && e.status < 600 ? e.status : 503,
            e.code || 'BILLING_UNAVAILABLE',
            e.code
              ? String(e.message)
              : 'Square billing could not be checked. No credentials were shown.',
          )
        }
      }
      if (action === 'business-reconcile' && request.method === 'POST') {
        if (!session.mfa_at)
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
        await c.query("SELECT set_config('app.billing_worker','true',true)")
        const billing = (
          await c.query(
            'SELECT source FROM workspace_billing WHERE business_id=$1',
            [businessId],
          )
        ).rows[0]
        const attempts = (
          await c.query(
            "SELECT * FROM stripe_checkouts WHERE business_id=$1 AND session_id IS NOT NULL AND status IN ('open','complete')",
            [businessId],
          )
        ).rows
        if (billing?.source?.startsWith('stripe_') || attempts.length) {
          const { reconcileStripeCheckout } =
            await import('../lib/stripe-subscriptions')
          for (const attempt of attempts)
            await reconcileStripeCheckout(c, attempt)
        } else if (billing?.source?.startsWith('square_')) {
          const { reconcileBusiness } = await import('../lib/billing-service')
          await withSquareConnections(c, () => reconcileBusiness(c, businessId))
        } else
          throw new AdminError(
            409,
            'NO_PROVIDER_LINK',
            'No trusted provider billing relationship exists for this business.',
          )
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
        if (!session.mfa_at)
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
          ? await withSquareConnections(c, async () => ({
              ...(await readAdministration(c, url.searchParams)),
              oauth: await squareOAuthAdminStatus(c, session),
              stripe: await stripeAdminView(c),
            }))
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
