import { createFileRoute } from '@tanstack/react-router'
import { BillingPage } from '@/components/billing-page'
export const Route = createFileRoute('/oven_/billing')({
  component: BillingPage,
  headers: () => ({ 'Cache-Control': 'private, no-store', Vary: 'Cookie' }),
  head: () => ({
    meta: [
      { title: 'Plan & billing | My Oven | Cottage Pantry' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
})
