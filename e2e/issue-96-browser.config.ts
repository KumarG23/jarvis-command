import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'issue-96-browser.spec.ts', workers: 1, retries: 0,
  reporter: 'list', outputDir: '../test-results/issue-96-browser',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3197', serviceWorkers: 'block' },
  webServer: { cwd: fileURLToPath(new URL('..', import.meta.url)), command: 'npm exec -- vite preview --config e2e/issue-96-browser.preview.config.ts', url: 'http://127.0.0.1:3197', reuseExistingServer: false },
});
