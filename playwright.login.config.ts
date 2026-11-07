import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: 'existing-account-login.browser.spec.ts',
  outputDir: '/tmp/cottage-pantry-login-browser-results',
  reporter: 'list',
  workers: 1,
  timeout: 45000,
  use: {
    // Tests intercept this origin and serve edited pages from local Netlify dev.
    // Provider and business responses are synthetic; production is never mutated.
    baseURL: 'https://mycottagepantry.com',
    browserName: 'chromium',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
})
