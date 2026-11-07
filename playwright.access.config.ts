import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  testMatch: 'account-access.browser.spec.ts',
  outputDir: '/tmp/cottage-pantry-access-browser-results',
  reporter: 'list',
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://localhost:8889',
    browserName: 'webkit',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    { name: 'desktop-webkit' },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
})
