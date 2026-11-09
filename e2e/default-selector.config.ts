import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'default-selector.spec.ts', workers: 1, retries: 0,
  reporter: 'list', outputDir: '../test-results/default-selector',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3127', serviceWorkers: 'block', screenshot: 'only-on-failure' },
  webServer: { cwd: fileURLToPath(new URL('..', import.meta.url)), command: 'npm exec -- vite preview --config e2e/default-selector.preview.config.ts', url: 'http://127.0.0.1:3127', reuseExistingServer: false },
});
