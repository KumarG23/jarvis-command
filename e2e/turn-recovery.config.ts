import { defineConfig } from '@playwright/test';

// Isolated synthetic APIs; this preview never reaches Hermes or production.
export default defineConfig({
  testDir: '.', testMatch: 'turn-recovery.spec.ts', workers: 1, retries: 0,
  outputDir: '../test-results/turn-recovery', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3114', viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' },
  webServer: {
    command: 'npm exec -w @jarvis-command/web -- vite preview --host 127.0.0.1 --port 3114 --strictPort',
    url: 'http://127.0.0.1:3114', reuseExistingServer: false,
  },
});
