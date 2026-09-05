import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
test('command proxy image uses complete locked workspace inputs and isolated runtime', () => {
  assert.ok(existsSync(root + 'Dockerfile.command-proxy'), 'Missing dedicated command-proxy image');
  const docker = readFileSync(root + 'Dockerfile.command-proxy', 'utf8');
  const lock = JSON.parse(readFileSync(root + 'package-lock.json', 'utf8'));
  const stages = docker.split(/^FROM /m).slice(1);
  assert.equal(stages.length, 3);
  for (const stage of stages) assert.match(stage, /^node:22\.22\.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752/);
  for (const stage of stages.slice(0, 2)) {
    for (const path of Object.keys(lock.packages).filter(path => /^(apps|packages)\/[^/]+$/.test(path))) {
      assert.ok(stage.includes(`COPY ${path}/package.json ${path}/package.json`), `Missing manifest ${path}`);
    }
    assert.match(stage, /COPY package.json package-lock.json/);
  }
  assert.match(stages[0], /COPY packages\/contracts\/src packages\/contracts\/src/);
  assert.match(stages[1], /npm ci --omit=dev --ignore-scripts --workspace @jarvis-command\/command-proxy --include-workspace-root=false/);
  assert.match(stages[1], /rm -rf node_modules\/@jarvis-command/);
  const runtime = stages[2];
  assert.match(runtime, /USER 10003:10003/);
  assert.match(runtime, /HOST=127\.0\.0\.1/);
  assert.match(runtime, /HEALTHCHECK/);
  assert.match(runtime, /process.env.PORT/);
  assert.match(runtime, /CMD \["node", "apps\/command-proxy\/dist\/index.js"\]/);
  const copies = runtime.split('\n').filter(line => line.startsWith('COPY '));
  assert.equal(copies.length, 2);
  assert.ok(copies.every(line => line.includes('--from=')));
  assert.match(copies.join('\n'), /\/dist\/index.js apps\/command-proxy\/dist\/index.js/);
  assert.doesNotMatch(runtime, /(?:COMMAND_PROXY_KEY|HERMES_API_KEY|COPY \.|COPY [^\n]*\.env)/);
});
