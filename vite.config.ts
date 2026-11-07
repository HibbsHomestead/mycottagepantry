import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'
import { appVersionPlugin, createAppVersion } from './scripts/app-version.ts'

// A public, opaque build marker; no environment values or account metadata.
const appVersion = createAppVersion(process.cwd(), process.env.DEPLOY_ID)

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    netlify(),
    tanstackStart(),
    viteReact(),
    appVersionPlugin(appVersion),
  ],
})

export default config
