import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'real-chain.integration.ts',
  globalSetup: './integration.setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: 'list',
  outputDir: process.env.UI7_OUTPUT_DIR ?? '../test-results/real-chain',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-real-chain', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone-real-chain', use: { ...devices['Pixel 7'] } },
  ],
});
