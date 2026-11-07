import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  testMatch: 'admin-mfa.browser.spec.ts',
  outputDir: '/tmp/cottage-admin-mfa-browser-results',
  reporter: 'list',
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://localhost:8889',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    { name: 'linux-chromium', use: { browserName: 'chromium' } },
    { name: 'linux-firefox', use: { browserName: 'firefox' } },
  ],
})
