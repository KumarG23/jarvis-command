import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('gate write preserves primary and cleanup errors without masking either', () => {
  const source = readFileSync('deploy/container-chain-gate.mjs', 'utf8').replace(/^import .*;$/gm, '').replace('export function', 'function');
  const primary = new Error('rename failed'), cleanup = new Error('unlink failed');
  const sandbox = {
    assert, randomUUID: () => 'synthetic', lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false, mode: 0o700, uid: 10004, gid: 10004 }),
    openSync: () => 1, closeSync() {}, writeFileSync() {}, fchownSync() {}, fchmodSync() {}, fsyncSync() {},
    renameSync() { throw primary; }, unlinkSync() { throw cleanup; },
  };
  runInNewContext(source + '; this.writeGate = writeGate;', sandbox);
  assert.throws(() => sandbox.writeGate('/synthetic', { run_id: 'run_' + 'a'.repeat(32), action: 'hold' }), error => {
    assert.deepEqual(Array.from(error.errors ?? []), [primary, cleanup]);
    return true;
  });
});

test('stalled or rejected diagnostics cannot prevent either close attempt', async () => {
  assert.ok(existsSync('deploy/container-chain-lifecycle.mjs'), 'Missing bounded browser diagnostic lifecycle');
  const { finalizeBrowser } = await import('./container-chain-lifecycle.mjs');
  for (const diagnostic of [() => new Promise(() => {}), () => Promise.reject(new Error('original diagnostic failure'))]) {
    const calls = [], records = [];
    await finalizeBrowser({ diagnostic, contextClose: () => { calls.push('context'); return new Promise(() => {}); }, browserClose: async () => { calls.push('browser'); }, record: value => records.push(value), milliseconds: 20 });
    assert.deepEqual(calls, ['context', 'browser']);
    assert.equal(records[0].stage, 'diagnostic');
    assert.equal(records[0].ok, false);
    assert.equal(records[1].stage, 'context-close');
    assert.equal(records[1].ok, false);
    assert.equal(records[2].stage, 'browser-close');
    assert.equal(records[2].ok, true);
  }
});
