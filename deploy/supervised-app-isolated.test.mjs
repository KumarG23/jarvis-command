import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('isolated supervised app verifier defaults to read-only instructions', () => {
  const r = spawnSync('/usr/bin/python3', ['deploy/verify-supervised-app-isolated.py'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Read-only default/);
  assert.match(r.stdout, /--execute/);
});
