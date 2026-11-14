import { env as nodeEnvironment } from 'node:process'
import { getContext, type Context } from '@netlify/functions'
import { deploymentMetadata } from './deployment-metadata'

export function serverEnvironment(name: string) {
  return globalThis.Netlify?.env?.get(name) ?? nodeEnvironment[name] ?? ''
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
    /^https:\/\/deploy-preview-[0-9]+--mycottagepantry\.netlify\.app$/.test(
      configuredPreview,
    )
      ? configuredPreview
      : ''
  return { context, runtime, previewOrigin }
}

function rootState(value: string | undefined) {
  if (value === undefined) return 'missing'
  if (value === '') return 'empty'
  return /^[a-f\d]{64}$/i.test(value) ? 'valid' : 'invalid_format'
}

/** Fixed statuses only: no root, fragments, fingerprints, or raw errors. */
export function stripeEncryptionStatus() {
  const netlifyRoot = globalThis.Netlify?.env?.get(
    'STRIPE_BILLING_ENCRYPTION_KEY',
  )
  const nodeRoot = nodeEnvironment.STRIPE_BILLING_ENCRYPTION_KEY
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
