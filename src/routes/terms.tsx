import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '@/components/public-site'
export const Route = createFileRoute('/terms')({
  component: () => <LegalPage kind="Terms" />,
  head: () => ({
    meta: [
      { title: 'Terms review | Cottage Pantry' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
})
