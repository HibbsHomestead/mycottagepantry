import { createFileRoute } from '@tanstack/react-router'
import { OnboardingPage } from '@/components/onboarding-page'
export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
  headers: () => ({ 'Cache-Control': 'private, no-store', Vary: 'Cookie' }),
  head: () => ({
    meta: [
      { title: 'Your business | Cottage Pantry' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
})
