import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('fixed single-user cutover success, preflight and rollback fixtures', () => {
  const result = spawnSync('/usr/bin/python3', ['deploy/single_user_release_test.py'], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
