import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  testMatch: 'mobile-session-journey.browser.spec.ts',
  timeout: 60000,
  workers: 1,
  outputDir: '/tmp/cottage-session-results',
  use: {
    baseURL: 'https://mycottagepantry.com',
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    video: { mode: 'on', size: { width: 390, height: 844 } },
  },
})
