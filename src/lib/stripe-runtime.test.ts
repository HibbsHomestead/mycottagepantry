// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import type { Context } from '@netlify/functions'
import { publicDeploymentMetadata } from '../../scripts/deployment-metadata'

const fixtures = vi.hoisted(() => ({
  context: undefined as Context | undefined,
  metadata: { siteId: '', deployId: '', context: '', previewOrigin: '' },
}))
vi.mock('@netlify/functions', () => ({
  getContext: () => fixtures.context,
}))
vi.mock('../../netlify/lib/deployment-metadata', () => ({
  deploymentMetadata: fixtures.metadata,
}))
import {
  deploymentRuntime,
  stripeEncryptionStatus,
} from '../../netlify/lib/runtime-environment'
import {
  stripeEndpoint,
  stripeEncryptionReady,
  sealStripe,
  openStripe,
} from '../../netlify/lib/stripe-provider'

const siteId = '299e7942-6246-467a-bef5-fa3f6817b210'
const deployId = '0123456789abcdef01234567'
const preview = 'https://deploy-preview-42--mycottagepantry.netlify.app'
afterEach(() => {
  fixtures.context = undefined
  Object.assign(fixtures.metadata, {
    siteId: '',
    deployId: '',
    context: '',
    previewOrigin: '',
  })
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('bundles only allowlisted public metadata and binds it to the serving deployment', () => {
  const secret = randomBytes(32).toString('hex')
  const metadata = publicDeploymentMetadata({
    SITE_ID: siteId,
    DEPLOY_ID: deployId,
    CONTEXT: 'deploy-preview',
    DEPLOY_PRIME_URL: preview,
    STRIPE_BILLING_ENCRYPTION_KEY: secret,
  })!
  expect(JSON.stringify(metadata)).not.toContain(secret)
  expect(Object.keys(metadata).sort()).toEqual([
    'context',
    'deployId',
    'previewOrigin',
    'siteId',
  ])
  Object.assign(fixtures.metadata, metadata)
  fixtures.context = {
    site: { id: siteId },
    deploy: { id: deployId, context: 'deploy-preview' },
  } as Context
  vi.stubGlobal('Netlify', { env: { get: () => undefined } })
  vi.stubEnv('CONTEXT', '')
  vi.stubEnv('DEPLOY_PRIME_URL', '')
  expect(stripeEndpoint('test')).toBe(preview + '/api/stripe/test/webhook')
  expect(stripeEndpoint('live')).toBe('')
  fixtures.context.deploy.id = '1123456789abcdef01234567'
  expect(stripeEndpoint('test')).toBe('')
  fixtures.context.deploy.id = deployId
  fixtures.context.site.id = 'different-site'
  expect(stripeEndpoint('test')).toBe('')
})

it('never substitutes production for an unknown or incomplete preview endpoint', () => {
  vi.stubGlobal('Netlify', { env: { get: () => undefined } })
  vi.stubEnv('CONTEXT', '')
  vi.stubEnv('DEPLOY_PRIME_URL', '')
  expect(stripeEndpoint('test')).toBe('')
  fixtures.context = {
    site: { id: siteId },
    deploy: { id: deployId, context: 'deploy-preview' },
  } as Context
  expect(stripeEndpoint('test')).toBe('')
  vi.stubEnv(
    'DEPLOY_PRIME_URL',
    'https://deploy-preview-42--foreign-site.netlify.app',
  )
  expect(stripeEndpoint('test')).toBe('')
  fixtures.context.deploy.context = 'production'
  expect(stripeEndpoint('test')).toBe(
    'https://mycottagepantry.com/api/stripe/test/webhook',
  )
  expect(stripeEndpoint('live')).toBe(
    'https://mycottagepantry.com/api/stripe/live/webhook',
  )
  expect(deploymentRuntime().previewOrigin).toBe('')
})

it('rejects untrusted build identifiers and nonstable URLs', () => {
  const env = {
    SITE_ID: siteId,
    DEPLOY_ID: deployId,
    CONTEXT: 'deploy-preview',
    DEPLOY_PRIME_URL: preview,
  }
  expect(publicDeploymentMetadata({ ...env, SITE_ID: 'foreign' })).toBeNull()
  expect(publicDeploymentMetadata({ ...env, DEPLOY_ID: 'invalid' })).toBeNull()
  expect(
    publicDeploymentMetadata({
      ...env,
      DEPLOY_PRIME_URL: preview + '.attacker.invalid',
    })?.previewOrigin,
  ).toBe('')
  expect(
    publicDeploymentMetadata({ ...env, CONTEXT: 'production' })?.previewOrigin,
  ).toBe('')
})

it('reports source presence and validation without serializing the root and preserves existing ciphertext', () => {
  const root = randomBytes(32).toString('hex')
  vi.stubGlobal('Netlify', undefined)
  vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', root)
  const encrypted = sealStripe({ fixture: true }, 'test')
  const status = stripeEncryptionStatus()
  expect(status).toEqual({
    ready: true,
    status: 'valid',
    source: 'node',
    netlify: 'missing',
    node: 'valid',
  })
  expect(stripeEncryptionReady()).toBe(status.ready)
  expect(JSON.stringify(status)).not.toContain(root)
  expect(openStripe(encrypted, 'test')).toEqual({ fixture: true })
  vi.stubGlobal('Netlify', { env: { get: () => '' } })
  expect(stripeEncryptionStatus()).toMatchObject({
    ready: false,
    status: 'empty',
    source: 'netlify',
    node: 'valid',
  })
  expect(() => sealStripe({}, 'test')).toThrow(/hosting setup/)
  vi.stubGlobal('Netlify', undefined)
  vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', undefined)
  expect(stripeEncryptionStatus()).toMatchObject({
    ready: false,
    status: 'missing',
  })
  vi.stubEnv('STRIPE_BILLING_ENCRYPTION_KEY', 'malformed')
  expect(stripeEncryptionStatus()).toMatchObject({
    ready: false,
    status: 'invalid_format',
  })
})
