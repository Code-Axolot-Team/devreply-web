import { defineConfig, devices } from '@playwright/test'

// Live tests: the SDK against the real API with a throwaway app's web key (DEVREPLY_TEST_PK).
export default defineConfig({
  testDir: 'tests',
  timeout: 150_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:4455', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node tests/serve.mjs', url: 'http://localhost:4455/', reuseExistingServer: true },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, grepInvert: /@phone/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@smoke/ },
    { name: 'phone', use: { ...devices['iPhone 15'] }, grep: /@smoke|@phone/ },
  ],
})
