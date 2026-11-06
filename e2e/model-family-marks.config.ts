import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
// The original release build is retained before editing; no live APIs are used.
const baseline = resolve('test-results/model-family-baseline');
if (!existsSync(resolve(baseline, 'index.html'))) throw Error('Prepare the isolated release baseline build before candidate browser QA');
export default defineConfig({
  testDir: '.', testMatch: 'model-family-marks.spec.ts', workers: 1, retries: 0,
  reporter: 'list', outputDir: '../test-results/model-family-final',
  use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' },
  projects: [
    { name: 'before', use: { baseURL: 'http://127.0.0.1:3198' } },
    { name: 'after', use: { baseURL: 'http://127.0.0.1:3199' } },
  ],
  webServer: [
    { command: `npm exec -w @jarvis-command/web -- vite preview --host 127.0.0.1 --port 3198 --strictPort --outDir '${baseline.replaceAll("'", "'\\''")}'`, url: 'http://127.0.0.1:3198', reuseExistingServer: false },
    { command: 'npm exec -w @jarvis-command/web -- vite preview --host 127.0.0.1 --port 3199 --strictPort', url: 'http://127.0.0.1:3199', reuseExistingServer: false },
  ],
});
