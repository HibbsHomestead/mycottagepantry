import { demoData } from '../../src/lib/demo'
import type { Workspace } from '../../src/lib/domain'

// This account requested an empty workspace rather than the sample business.
export function workspaceSeed(email?: string): Workspace {
  const seed = demoData()
  if (email?.trim().toLowerCase() !== 'contact@hibbshomestead.com') return seed
  for (const table of Object.keys(seed)) seed[table] = []
  seed.settings = [
    {
      id: 'business',
      name: 'Hibbs Homestead',
      email: 'contact@hibbshomestead.com',
      owner: '',
      address: '',
      jurisdiction: '',
      laborRate: 0,
      targetMargin: 0,
      taxRate: 0,
      disclaimer: '',
    },
  ]
  return seed
}
