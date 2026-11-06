import { defineConfig, devices } from '@playwright/test';

// Candidate-only static preview. Every API is intercepted by the labelled fixture.
export default defineConfig({
  testDir: '.', testMatch: 'project-threads-entry.spec.ts', workers: 1, retries: 0,
  reporter: 'list', outputDir: '../test-results/project-threads-entry',
  use: { ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:3194', serviceWorkers: 'block' },
  webServer: {
    command: 'npm exec -w @jarvis-command/web -- vite preview --host 127.0.0.1 --port 3194 --strictPort',
    url: 'http://127.0.0.1:3194', reuseExistingServer: false,
  },
});
