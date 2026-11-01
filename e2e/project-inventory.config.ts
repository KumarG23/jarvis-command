import { defineConfig, devices } from '@playwright/test';

// Exact-session inventory/recovery and accepted pane guards, with intercepted
// synthetic APIs only. Build the workspace before running this static preview.
export default defineConfig({
  testDir: '.', testMatch: ['concurrent-threads.spec.ts', 'pane-link-lifetime.spec.ts'],
  workers: 1, retries: 0, reporter: 'list', outputDir: '../test-results/project-inventory',
  use: { baseURL: 'http://127.0.0.1:3187', serviceWorkers: 'block', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'touch', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm exec -w @jarvis-command/web -- vite preview --host 127.0.0.1 --port 3187 --strictPort',
    url: 'http://127.0.0.1:3187', reuseExistingServer: false,
  },
});
