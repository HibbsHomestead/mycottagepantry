import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Plugin } from 'vite'

/** Config can be evaluated more than once for one deployment. Never use randomness. */
export function createAppVersion(root: string, deploymentId?: string) {
  const hash = createHash('sha256').update('cottage-pantry-version-v1\0')
  if (deploymentId) return hash.update(deploymentId).digest('hex')

  // Local builds/dev have no deployment ID. Fingerprint build inputs instead;
  // exclude generated routes and tests so config evaluations remain consistent.
  function include(path: string) {
    const fullPath = join(root, path)
    hash.update(path).update('\0').update(readFileSync(fullPath)).update('\0')
  }
  function visit(path: string) {
    for (const entry of readdirSync(join(root, path), {
      withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name.startsWith('.')) continue
      const next = join(path, entry.name)
      if (entry.isDirectory()) {
        if (next !== join('src', 'test')) visit(next)
      } else if (
        entry.isFile() &&
        !/\.(test|spec)\.[^.]+$/.test(entry.name) &&
        entry.name !== 'routeTree.gen.ts'
      ) {
        include(relative(root, join(root, next)))
      }
    }
  }
  for (const path of ['src', 'public', 'netlify', 'db']) visit(path)
  for (const path of [
    'vite.config.ts',
    'scripts/app-version.ts',
    'package.json',
    'pnpm-lock.yaml',
    'netlify.toml',
  ])
    include(path)
  return hash.digest('hex')
}

export function appVersionPlugin(version: string): Plugin {
  return {
    name: 'cottage-pantry-app-version',
    config: () => ({ define: { __APP_VERSION__: JSON.stringify(version) } }),
    // The define and published metadata share exactly the same marker.
    generateBundle() {
      if (this.environment.name !== 'client') return
      this.emitFile({
        type: 'asset',
        fileName: 'app-version.json',
        source: JSON.stringify({ version }),
      })
    },
  }
}
