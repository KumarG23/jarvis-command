import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
// Static preview with every API intercepted; checks that Projects and Recent chats scroll independently.
export default defineConfig({
  testDir: '.', testMatch: 'sidebar-sections.spec.ts', workers: 1, retries: 0,
  reporter: 'list', outputDir: '../test-results/sidebar-sections',
  use: { baseURL: 'http://127.0.0.1:3111', serviceWorkers: 'block', screenshot: 'only-on-failure', ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}) },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: { cwd: fileURLToPath(new URL('..', import.meta.url)), command: 'npm exec -- vite preview --config e2e/thread-status.preview.config.ts', url: 'http://127.0.0.1:3111', reuseExistingServer: false },
});
