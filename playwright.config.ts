import { defineConfig } from '@playwright/test'
// Start Netlify dev on 8889 separately. Never build or use live customer data here.
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:8889' },
})
