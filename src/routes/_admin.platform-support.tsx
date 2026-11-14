import { createFileRoute } from '@tanstack/react-router'
import { SupportPage } from '@/components/support-page'

export const Route = createFileRoute('/_admin/platform-support')({
  component: () => <SupportPage staff />,
  headers: () => ({ 'Cache-Control': 'private, no-store', Vary: 'Cookie' }),
  head: () => ({
    meta: [
      { title: 'Platform support | Cottage Pantry' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
})
