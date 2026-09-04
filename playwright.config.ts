import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && NODE_ENV=development AUTH_MODE=development HERMES_READ_PROXY_KEY=local-development-read-proxy-key-for-e2e WEB_DIST_DIR=./apps/web/dist APP_VERSION=0.1.0-e2e node ./apps/server/dist/index.js',
    url: 'http://127.0.0.1:3000/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
