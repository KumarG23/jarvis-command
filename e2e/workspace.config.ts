import { defineConfig, devices } from '@playwright/test';

// Build web/server explicitly before this bounded app-only batch; unchanged proxies
// run from the approved source fixture and are not rebuilt.
export default defineConfig({
  testDir: '.', testMatch: 'workspace.integration.ts', fullyParallel: false,
  workers: 1, retries: 0, timeout: 60_000, reporter: 'list',
  outputDir: process.env.WORKSPACE_OUTPUT_DIR ?? '../test-results/workspace',
  use: { trace: 'retain-on-failure', serviceWorkers: 'block' },
  projects: [
    { name: 'desktop-workspace', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone-workspace', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
});
