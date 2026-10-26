import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';

// A static loopback preview with all APIs intercepted; no BFF or Hermes needed.
// HEADER_CSS=release runs the exact same tests and assertions, expected to exit 1.
export default defineConfig(await (async () => {
  const release = process.env.HEADER_CSS === 'release';
  let cssSha256: string | null = null;
  if (release) {
    const directory = mkdtempSync(join(tmpdir(), 'issue7-release-css-'));
    symlinkSync(join(process.cwd(), 'node_modules'), join(directory, 'node_modules'));
    const source = execFileSync('git', ['show', 'dd102c5:apps/web/src/styles.css']);
    const entry = join(directory, 'release.css');
    writeFileSync(entry, source);
    // Vite resolves the unchanged font imports too, matching candidate bundling.
    const output = await build({ configFile: false, root: directory, logLevel: 'error',
      build: { write: false, rollupOptions: { input: entry } } });
    const bundle = Array.isArray(output) ? output[0] : output;
    if (!('output' in bundle)) throw Error('Expected CSS build output');
    const css = bundle.output.find(asset => asset.type === 'asset' && asset.fileName.endsWith('.css'));
    if (!css || css.type !== 'asset') throw Error('Release stylesheet missing');
    process.env.HEADER_RELEASE_CSS = join(directory, 'bundled.css');
    writeFileSync(process.env.HEADER_RELEASE_CSS, css.source);
    cssSha256 = createHash('sha256').update(css.source).digest('hex');
  } else delete process.env.HEADER_RELEASE_CSS;
  return {
    testDir: '.', testMatch: 'header-layout.spec.ts', workers: 1, retries: 0,
    outputDir: `../test-results/header-${release ? 'release' : 'candidate'}`,
    reporter: [['list'], ['json', { outputFile: `test-results/header-${release ? 'release' : 'candidate'}.json` }]],
    metadata: { cssVariant: release ? 'dd102c5' : 'candidate build', cssSha256,
      sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() },
    use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:3107', serviceWorkers: 'block' },
    webServer: { command: 'npm exec -w @jarvis-command/web -- vite preview --host 127.0.0.1 --port 3107 --strictPort',
      url: 'http://127.0.0.1:3107', reuseExistingServer: false },
  };
})());
