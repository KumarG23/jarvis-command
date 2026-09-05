import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('fixed parent recovery handshake and failure lifecycle', () => {
  const result = spawnSync('/usr/bin/python3', ['deploy/container_recovery_test.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
