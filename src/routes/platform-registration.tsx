import { createFileRoute } from '@tanstack/react-router'
import { RegistrationOperations } from '@/components/registration-operations'
export const Route = createFileRoute('/platform-registration')({
  component: RegistrationOperations,
  headers: () => ({ 'Cache-Control': 'private, no-store', Vary: 'Cookie' }),
  head: () => ({
    meta: [
      { title: 'Signup operations | Cottage Pantry' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
})
