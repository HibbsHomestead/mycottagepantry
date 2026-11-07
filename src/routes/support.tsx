import { createFileRoute } from '@tanstack/react-router'
import { SupportPage } from '@/components/support-page'
export const Route = createFileRoute('/support')({
  component: SupportPage,
  headers: () => ({ 'Cache-Control': 'private, no-store', Vary: 'Cookie' }),
  head: () => ({
    meta: [
      { title: 'Get help | Cottage Pantry' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
})
