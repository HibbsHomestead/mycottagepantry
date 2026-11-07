import { createFileRoute } from '@tanstack/react-router'
import { VerificationPage } from '@/components/verification-page'
export const Route = createFileRoute('/verify-email')({
  component: VerificationPage,
  head: () => ({
    meta: [
      { title: 'Verify email | Cottage Pantry' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
})
