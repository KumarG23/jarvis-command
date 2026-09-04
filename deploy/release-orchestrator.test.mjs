import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { URL } from 'node:url';

const deployDirectory = new URL('.', import.meta.url).pathname;
const pythonTests = new URL('release_orchestrator_test.py', import.meta.url).pathname;

test('release orchestrator rejects unsafe handoff and preserves cleanup status', () => {
  const result = spawnSync('python3', [pythonTests], {
    cwd: deployDirectory,
    encoding: 'utf8',
    timeout: 120_000,
  });

  assert.equal(
    result.status,
    0,
    `release orchestrator tests failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
});
