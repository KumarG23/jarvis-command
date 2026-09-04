import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { URL } from 'node:url';

const deployDirectory = new URL('.', import.meta.url).pathname;
const pythonTests = new URL('release_stage_lifecycle_test.py', import.meta.url).pathname;

test('release stage lifecycle preserves errors, signals, privacy, and cleanup', () => {
  const result = spawnSync('python3', [pythonTests], {
    cwd: deployDirectory,
    encoding: 'utf8',
    timeout: 60_000,
  });

  assert.equal(
    result.status,
    0,
    `release stage lifecycle tests failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
});
