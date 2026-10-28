import { defineConfig, devices } from '@playwright/test';

// Visibly synthetic artifacts and intercepted APIs against the real BFF document
// policy. Desktop plus the 320–430 px phone range from MASTER_PLAN §0.3.
export default defineConfig({
  testDir: '.', testMatch: 'artifact-preview.spec.ts', workers: 1, retries: 0, timeout: 60_000,
  outputDir: '../test-results/artifact-preview', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3000', serviceWorkers: 'block' },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone-320', use: { ...devices['Pixel 7'], viewport: { width: 320, height: 800 } } },
    { name: 'phone-390', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'phone-430', use: { ...devices['Pixel 7'], viewport: { width: 430, height: 932 } } },
  ],
  webServer: {
    command: 'cd .. && npm run build && NODE_ENV=development AUTH_MODE=development HERMES_READ_PROXY_KEY=local-development-read-proxy-key-for-e2e WEB_DIST_DIR=./apps/web/dist APP_VERSION=0.1.0-e2e node ./apps/server/dist/index.js',
    url: 'http://127.0.0.1:3000/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
