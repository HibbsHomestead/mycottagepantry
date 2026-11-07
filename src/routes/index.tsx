import { createFileRoute } from '@tanstack/react-router'
import { HomePage } from '@/components/public-site'
export const Route = createFileRoute('/')({
  component: HomePage,
  head: () => ({
    meta: [{ title: 'Cottage Pantry | Know your costs. Build your business.' }],
  }),
})
