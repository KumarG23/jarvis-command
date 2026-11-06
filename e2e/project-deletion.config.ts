import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'project-deletion.spec.ts', workers: 1, retries: 0,
  reporter: 'list', outputDir: '../test-results/project-deletion',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3196', serviceWorkers: 'block' },
  webServer: { command: 'npm exec -w @jarvis-command/web -- vite preview --host 127.0.0.1 --port 3196 --strictPort', url: 'http://127.0.0.1:3196', reuseExistingServer: false },
});
