import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('image verifier refuses success before cleanup and enumerates inventory failures', () => {
  const result = spawnSync('python3', [fileURLToPath(new URL('./app_read_proxy_verifier_test.py', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
for (const [file, workspace, uid] of [['Dockerfile', 'server', 10001], ['Dockerfile.read-proxy', 'read-proxy', 10002]]) {
  test(`${file} supplies all locked workspace manifests in both install stages`, () => {
    const stages = read(file).split(/^FROM /m).slice(1);
    const workspaces = Object.keys(JSON.parse(read('package-lock.json')).packages)
      .filter(path => /^(apps|packages)\/[^/]+$/.test(path));
    for (const [index, stage] of stages.slice(0, 2).entries()) {
      const missing = workspaces.filter(path => !stage.includes(`COPY ${path}/package.json ${path}/package.json`));
      assert.deepEqual(missing, [], `stage ${index} missing manifests: ${missing.join(', ')}`);
    }
    assert.match(stages[1], new RegExp(`npm ci --omit=dev --ignore-scripts --workspace @jarvis-command/${workspace} --include-workspace-root=false`));
    assert.match(stages[1], /rm -rf node_modules\/@jarvis-command/);
  });
  test(`${file} runtime is root-owned, map-free and has bounded loopback health`, () => {
    const runtime = read(file).split(/^FROM /m).at(-1);
    assert.match(runtime, new RegExp(`USER ${uid}:${uid}`));
    assert.doesNotMatch(runtime, /--chown=/);
    assert.match(runtime, new RegExp(`/workspace/apps/${workspace}/dist/index.js apps/${workspace}/dist/index.js`));
    assert.match(runtime, /rm -rf \/usr\/local\/lib\/node_modules\/npm/);
    assert.match(runtime, /AbortSignal.timeout\(4000\)/);
    assert.match(runtime, /127\.0\.0\.1:'\+process.env.PORT/);
  });
}
