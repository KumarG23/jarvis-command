import { defineConfig, devices } from '@playwright/test';
// Candidate fixtures only: the isolated harness served by the Vite dev server (not a build input). Run through the Studio browser QA wrapper.
export default defineConfig({
  testDir: '.', testMatch: 'studio-projection.spec.ts', workers: 1, retries: 0,
  reporter: 'list', outputDir: '../test-results/studio-projection',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3198', serviceWorkers: 'block' },
  webServer: { command: 'npm exec -w @jarvis-command/web -- vite --host 127.0.0.1 --port 3198 --strictPort', url: 'http://127.0.0.1:3198/studio-projection-candidate.html', reuseExistingServer: false },
});
