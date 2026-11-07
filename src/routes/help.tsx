import { createFileRoute } from '@tanstack/react-router'
import { HelpPage } from '@/components/public-site'
export const Route = createFileRoute('/help')({
  component: HelpPage,
  head: () => ({ meta: [{ title: 'Help & contact | Cottage Pantry' }] }),
})
