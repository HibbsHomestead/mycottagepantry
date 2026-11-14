import { createFileRoute } from '@tanstack/react-router'
import { AdminPortal } from '@/components/admin-portal'

// Both URLs share one mounted shell and the same verified administrator session.
export const Route = createFileRoute('/_admin')({
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
})
