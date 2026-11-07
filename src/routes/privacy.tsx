import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '@/components/public-site'
export const Route = createFileRoute('/privacy')({
  component: () => <LegalPage kind="Privacy" />,
  head: () => ({
    meta: [
      { title: 'Privacy review | Cottage Pantry' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
})
