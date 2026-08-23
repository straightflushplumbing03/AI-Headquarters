import { defineConfig } from '@playwright/test'

const baseURL = process.env.BASE_URL || 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL,
  },
})
