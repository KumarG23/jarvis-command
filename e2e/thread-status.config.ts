import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'thread-status.spec.ts', workers: 1, retries: 0,
  reporter: 'list', outputDir: '../test-results/thread-status',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3111', serviceWorkers: 'block' },
  webServer: { command: 'npm exec -w @jarvis-command/web -- vite preview --host 127.0.0.1 --port 3111 --strictPort', url: 'http://127.0.0.1:3111', reuseExistingServer: false },
});
