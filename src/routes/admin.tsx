import { createFileRoute } from '@tanstack/react-router'
import { AdminPortal } from '@/components/admin-portal'

export const Route = createFileRoute('/admin')({
  component: AdminPortal,
  headers: () => ({
    'Cache-Control': 'private, no-store',
    'Netlify-CDN-Cache-Control': 'no-store',
    Vary: 'Cookie',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    'X-Frame-Options': 'DENY',
  }),
  head: () => ({
    meta: [
      { title: 'Cottage Pantry Admin' },
      { name: 'robots', content: 'noindex, nofollow' },
      {
        name: 'description',
        content: 'Restricted platform administration for Cottage Pantry.',
      },
    ],
  }),
})
