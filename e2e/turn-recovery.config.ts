import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// Isolated synthetic APIs; this preview never reaches Hermes or production.
export default defineConfig({
  testDir: '.', testMatch: ['project-threads.spec.ts', 'project-workspace.spec.ts', 'turn-recovery.spec.ts', 'inference-controls.spec.ts', 'run-inspector.spec.ts', 'chat-completeness.spec.ts', 'responsive-shell.spec.ts', 'notifications.spec.ts'], workers: 1, retries: 0,
  outputDir: '../test-results/turn-recovery', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3114', viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' },
  webServer: { cwd: fileURLToPath(new URL('..', import.meta.url)),
    command: 'npm exec -- vite preview --config e2e/thread-status.preview.config.ts --port 3114',
    url: 'http://127.0.0.1:3114', reuseExistingServer: false,
  },
});
