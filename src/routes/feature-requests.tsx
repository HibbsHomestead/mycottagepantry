import { createFileRoute } from '@tanstack/react-router'
import { FeatureBoard } from '@/components/feature-board'

export const Route = createFileRoute('/feature-requests')({
  component: FeatureBoard,
  headers: () => ({
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
    'X-Frame-Options': 'DENY',
  }),
  head: () => ({
    meta: [
      { title: 'Feature requests | Cottage Pantry' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
})
