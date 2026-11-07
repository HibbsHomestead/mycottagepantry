import { createFileRoute } from '@tanstack/react-router'
import { FeaturesPage } from '@/components/public-site'
export const Route = createFileRoute('/features')({
  component: FeaturesPage,
  head: () => ({ meta: [{ title: 'Features | Cottage Pantry' }] }),
})
