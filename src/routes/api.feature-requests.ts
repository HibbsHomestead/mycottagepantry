import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/feature-requests')({
  server: {
    handlers: {
      GET: async ({ request }) =>
        (
          await import('../../netlify/lib/feature-board-handler')
        ).handleFeatureBoard(request),
      POST: async ({ request }) =>
        (
          await import('../../netlify/lib/feature-board-handler')
        ).handleFeatureBoard(request),
    },
  },
})
