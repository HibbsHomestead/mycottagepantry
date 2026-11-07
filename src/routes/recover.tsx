import { createFileRoute } from '@tanstack/react-router'
import { VerificationPage } from '@/components/verification-page'
export const Route = createFileRoute('/recover')({
  component: () => <VerificationPage recovery />,
  head: () => ({
    meta: [
      { title: 'Account recovery | Cottage Pantry' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
})
