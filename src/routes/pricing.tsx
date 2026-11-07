import { createFileRoute } from '@tanstack/react-router'
import { PricingPage } from '@/components/public-site'
export const Route = createFileRoute('/pricing')({
  component: PricingPage,
  head: () => ({ meta: [{ title: 'Plans & pricing | Cottage Pantry' }] }),
})
