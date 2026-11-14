import process from 'node:process'
import { getContext, type Context } from '@netlify/functions'
import { deploymentMetadata } from './deployment-metadata'

export function serverEnvironment(name: string) {
  // Resolve at invocation time; an imported `env` binding can retain the
  // pre-injection object if the runtime replaces process.env after module load.
  return globalThis.Netlify?.env?.get(name) ?? process.env[name] ?? ''
}

export function deploymentRuntime() {
  let runtime: Context | undefined
  try {
    runtime = getContext()
  } catch {
    // Tests and development may have no invocation context.
  }
  const context = runtime?.deploy?.context ?? serverEnvironment('CONTEXT')
  const matchingBuild =
    !!runtime &&
    runtime.site.id === deploymentMetadata.siteId &&
    runtime.deploy.id === deploymentMetadata.deployId &&
    context === deploymentMetadata.context
  const configuredPreview = matchingBuild
    ? deploymentMetadata.previewOrigin
    : serverEnvironment('DEPLOY_PRIME_URL')
  const previewOrigin =
    context === 'deploy-preview' &&
    /^https:\/\/(?:deploy-preview-[0-9]+|agent-[a-f0-9]{24})--mycottagepantry\.netlify\.app$/.test(
      configuredPreview,
    )
      ? configuredPreview
      : ''
  return { context, runtime, previewOrigin }
}

export function stripeCredentialRoot(value: string) {
  return /^(sk|rk)_(test|live)_[A-Za-z0-9]{20,}$/.test(value)
}

function rootState(value: string | undefined) {
  if (value === undefined) return 'missing'
  if (value === '') return 'empty'
  return /^[a-f\d]{64}$/i.test(value) || stripeCredentialRoot(value)
    ? 'valid'
    : 'invalid_format'
}

/** Fixed statuses only: no root, fragments, fingerprints, or raw errors. */
export function stripeEncryptionStatus() {
  const netlifyRoot = globalThis.Netlify?.env?.get(
    'STRIPE_BILLING_ENCRYPTION_KEY',
  )
  const nodeRoot = process.env.STRIPE_BILLING_ENCRYPTION_KEY
  const selected = netlifyRoot ?? nodeRoot
  const status = rootState(selected)
  return {
    ready: status === 'valid',
    status,
    source:
      netlifyRoot !== undefined
        ? 'netlify'
        : nodeRoot !== undefined
          ? 'node'
          : 'none',
    netlify: rootState(netlifyRoot),
    node: rootState(nodeRoot),
  }
}
