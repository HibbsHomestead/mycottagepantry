// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { appVersionPlugin, createAppVersion } from '../../scripts/app-version'

let root: string | undefined
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = undefined
})

it('keeps independently evaluated configurations for one deployment identical', () => {
  const first = createAppVersion('', 'synthetic-deployment-one')
  const second = createAppVersion('', 'synthetic-deployment-one')
  expect(first).toMatch(/^[a-f0-9]{64}$/)
  expect(second).toBe(first)
  expect(first).not.toContain('synthetic-deployment-one')
  expect(createAppVersion('', 'synthetic-deployment-two')).not.toBe(first)
})

it('embeds exactly the published marker in both application environments', () => {
  const version = createAppVersion('', 'synthetic-deployment')
  const plugin = appVersionPlugin(version)
  // Exercise plugin hooks without running a build or emitting repository artifacts.
  const config = plugin.config as () => { define: { __APP_VERSION__: string } }
  const generate = plugin.generateBundle as (this: unknown) => void
  const emitFile = vi.fn()
  const bundled = JSON.parse(config().define.__APP_VERSION__)
  generate.call({ environment: { name: 'client' }, emitFile })
  expect(JSON.parse(emitFile.mock.calls[0][0].source).version).toBe(bundled)
  expect(emitFile.mock.calls[0][0].fileName).toBe('app-version.json')
  emitFile.mockClear()
  generate.call({ environment: { name: 'ssr' }, emitFile })
  expect(emitFile).not.toHaveBeenCalled()
})

it('uses a stable source fingerprint without a deployment ID and ignores generated/test files', () => {
  root = mkdtempSync(join(tmpdir(), 'cottage-version-test-'))
  for (const directory of ['src/test', 'public', 'netlify', 'db', 'scripts'])
    mkdirSync(join(root, directory), { recursive: true })
  for (const path of [
    'src/app.tsx',
    'public/logo.svg',
    'netlify/function.mts',
    'db/schema.ts',
    'vite.config.ts',
    'scripts/app-version.ts',
    'package.json',
    'pnpm-lock.yaml',
    'netlify.toml',
  ])
    writeFileSync(join(root, path), 'synthetic build input')
  const version = createAppVersion(root)
  expect(createAppVersion(root)).toBe(version)
  writeFileSync(join(root, 'src/routeTree.gen.ts'), 'generated')
  writeFileSync(join(root, 'src/example.test.tsx'), 'test')
  writeFileSync(join(root, 'src/test/fixture.ts'), 'fixture')
  expect(createAppVersion(root)).toBe(version)
  writeFileSync(join(root, 'src/app.tsx'), 'updated application')
  expect(createAppVersion(root)).not.toBe(version)
})
