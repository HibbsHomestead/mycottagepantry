import { BackToTop } from '@/components/back-to-top'
import {
  appearanceBootScript,
  appearanceVariables,
  defaultAppearance,
} from '@/lib/appearance'
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { adminHeadBootScript } from '@/lib/document-hydration'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NotFoundPage } from '@/components/error-pages'

import '../styles.css'
import '../components/mobile-usability.css'
import '../workspace.css'
import '../surface-layout.css'
import '../interface-typography.css'

const siteName = 'Cottage Pantry | Your kitchen, in good order'
const siteDescription =
  'A connected oven for cottage food makers and small food businesses. Organize ingredient costs, recipes, products, production, and business records.'

export const Route = createRootRoute({
  head: () => ({
    links: [
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/favicon-32.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '48x48',
        href: '/favicon-48.png',
      },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon.png',
      },
    ],
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: siteName,
      },
      {
        name: 'description',
        content: siteDescription,
      },
      {
        property: 'og:title',
        content: siteName,
      },
      {
        property: 'og:description',
        content: siteDescription,
      },
      {
        property: 'og:type',
        content: 'website',
      },
      {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFoundPage,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-mode="light"
      style={{
        ...appearanceVariables(defaultAppearance),
        colorScheme: 'light',
      }}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceBootScript() }} />
        <HeadContent />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: adminHeadBootScript }} />
        <TooltipProvider>{children}</TooltipProvider>
        <BackToTop />
        <Toaster />
        <Scripts />
      </body>
    </html>
  )
}
