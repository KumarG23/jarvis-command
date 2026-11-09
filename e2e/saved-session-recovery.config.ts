import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'saved-session-recovery.spec.ts', workers: 1, retries: 0,
  reporter: 'list', outputDir: '../test-results/saved-session-recovery',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3111', serviceWorkers: 'block', screenshot: 'only-on-failure' },
  webServer: { cwd: fileURLToPath(new URL('..', import.meta.url)), command: 'npm exec -- vite preview --config e2e/thread-status.preview.config.ts', url: 'http://127.0.0.1:3111', reuseExistingServer: false },
});
