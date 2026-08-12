import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: ['e2e/play-search-download.spec.ts', 'e2e/settings-theme.spec.ts', 'web-only-ui.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: '.superpowers/sdd/2026-08-10-tuneflow-server-web/task-8-artifacts/playwright-results',
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
})
